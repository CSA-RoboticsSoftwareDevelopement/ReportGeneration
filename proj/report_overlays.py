"""Editor overlays applied on top of the PDF that engine.build() produces.

The report engine lays every page out from scratch on each rebuild, so anything
the user does by hand in the section editor has to be re-applied afterwards.
This module does that with PyMuPDF, driven only by keys in the report `data`:

  img_dx__<id>, img_dy__<id>   image offset from its flowed position (points, +right / +down)
  img_scale__<id>              image size multiplier (aspect ratio kept, top-left corner stays put)
  txt__<id>                    JSON string for one added text box:
                               {sec, rel, page, top, x, w, text, align, size, bold, italic}

Added text copies the report's own body text: font family, size, colour, line
spacing and the left/right margins are measured from the generated PDF itself.

Added tables are stored as ``tbl__<id>`` JSON strings:
    {sec, rel, page, top, x, w, h, rows, cols, headerRow, cellText: [[...]]}
They are drawn as plain white grids with thin black borders and centred text (see TABLE_LOOK).

apply_editor_overlays() returns (pdf_bytes, section_pages). section_pages gets
the real image boxes in "__images" (bottom-origin points, same format the engine
uses), "__texts" for added text boxes and "__tables" for added tables.

Safety rule: if anything goes wrong, or a moved image cannot be verified in the
output, the untouched engine PDF is returned, so an image can never vanish.
"""
import json
import logging
import os
from collections import Counter

log = logging.getLogger(__name__)

ALIGNS = ("left", "center", "right", "justify")

# (family, bold, italic) -> PyMuPDF base-14 font name
_BASE14 = {
    ("he", 0, 0): "helv", ("he", 1, 0): "hebo", ("he", 0, 1): "heit", ("he", 1, 1): "hebi",
    ("ti", 0, 0): "tiro", ("ti", 1, 0): "tibo", ("ti", 0, 1): "tiit", ("ti", 1, 1): "tibi",
    ("co", 0, 0): "cour", ("co", 1, 0): "cobo", ("co", 0, 1): "coit", ("co", 1, 1): "cobi",
}

# base-14 fonts only cover Latin-1, so swap the usual typographic characters
_TYPO = str.maketrans({
    "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u2018": "'", "\u2019": "'",
    "\u201c": '"', "\u201d": '"', "\u2022": "\u00b7", "\u2026": "...", "\u00a0": " ",
})


def _f(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _family(font_name, flags):
    n = (font_name or "").lower()
    if "cour" in n or "mono" in n or flags & 8:
        return "co"
    if "times" in n or ("serif" in n and "sans" not in n):
        return "ti"
    return "he"


def _rgb(c):
    c = int(c or 0)
    return (((c >> 16) & 255) / 255.0, ((c >> 8) & 255) / 255.0, (c & 255) / 255.0)


def _parse_text_color(value, fallback):
    if isinstance(value, str):
        raw = value.strip().lstrip("#")
        if len(raw) == 6:
            try:
                number = int(raw, 16)
                return _rgb(number)
            except ValueError:
                pass
    return fallback


# --------------------------------------------------------------------------
# measuring the report's own body text
# --------------------------------------------------------------------------
def _text_lines(page):
    """Horizontal text lines of a page as (size, nchars, x0, y0, x1, y1, block_no, spans)."""
    out = []
    try:
        d = page.get_text("dict")
    except Exception:
        return out
    for bi, b in enumerate(d.get("blocks", [])):
        if b.get("type") != 0:
            continue
        for ln in b.get("lines", []):
            if abs(ln.get("dir", (1, 0))[1]) > 0.01:  # rotated label in the side bar
                continue
            spans = [s for s in ln.get("spans", []) if s.get("text", "").strip()]
            if not spans:
                continue
            x0, y0, x1, y1 = ln["bbox"]
            n = sum(len(s["text"].strip()) for s in spans)
            out.append((round(spans[0].get("size", 0), 1), n, x0, y0, x1, y1, bi, spans))
    return out


def body_style(doc):
    """Most common text style in the PDF (= the body paragraphs), plus its margins and line spacing."""
    chars = Counter()
    lines = []
    page_w = 595.0
    for pno in range(min(len(doc), 14)):
        page = doc[pno]
        page_w = page.rect.width
        for ln in _text_lines(page):
            if ln[0] < 5.5 or ln[0] > 14:
                continue
            for s in ln[7]:
                chars[(s.get("font", ""), round(s.get("size", 0), 1), s.get("color", 0), s.get("flags", 0))] += len(s["text"].strip())
            lines.append(ln[:7] + (pno,))

    style = {"family": "he", "bold": 0, "italic": 0, "size": 9.0, "color": (0, 0, 0),
             "lead": 11.5, "left": page_w * 0.157, "right": page_w - 42.0}
    if not chars:
        return style
    (font, size, color, flags), _ = chars.most_common(1)[0]
    style.update(family=_family(font, flags), bold=1 if flags & 16 else 0, italic=1 if flags & 2 else 0,
                 size=size, color=_rgb(color))
    body = [l for l in lines if abs(l[0] - size) < 0.6 and l[2] > page_w * 0.1]
    if body:
        style["left"] = Counter(round(l[2]) for l in body).most_common(1)[0][0]
        full = [l for l in body if l[1] >= 45]
        if full:
            style["right"] = Counter(round(l[4]) for l in full).most_common(1)[0][0]
    gaps = []
    for a, b in zip(body, body[1:]):
        if a[6] == b[6] and a[7] == b[7]:
            g = b[3] - a[3]
            if size * 0.9 <= g <= size * 2.2:
                gaps.append(g)
    if gaps:
        gaps.sort()
        style["lead"] = gaps[len(gaps) // 2]
    else:
        style["lead"] = size * 1.25
    return style


def page_margins(page, style):
    """Left / right edge of the body paragraphs on this particular page (falls back to the document-wide ones)."""
    left, right = style["left"], style["right"]
    pw = page.rect.width
    lefts, rights = Counter(), Counter()
    for ln in _text_lines(page):
        if abs(ln[0] - style["size"]) > 0.6 or ln[2] <= pw * 0.1:
            continue
        lefts[round(ln[2])] += 1
        if ln[1] >= 45:
            rights[round(ln[4])] += 1
    if lefts:
        left = lefts.most_common(1)[0][0]
    if rights:
        right = rights.most_common(1)[0][0]
    return left, right


# --------------------------------------------------------------------------
# images
# --------------------------------------------------------------------------
def _find_image(page, b):
    """Locate the picture the engine says it drew at box `b` by looking at the PDF itself.

    The engine's y may be measured from the bottom (PDF/reportlab) or from the top, so both are tried.
    Returns (pdf_bbox_top_origin, xref) or (None, 0).
    """
    try:
        infos = [i for i in page.get_image_info(xrefs=True) if i.get("bbox") and i.get("xref")]
    except Exception:
        return None, 0
    ph = page.rect.height
    x, y, w, h = _f(b.get("x")), _f(b.get("y")), _f(b.get("w")), _f(b.get("h"))
    guesses = [(x, ph - (y + h), x + w, ph - y), (x, y, x + w, y + h)]
    best, best_iou = None, 0.0
    for g in guesses:
        for i in infos:
            v = _iou(g, tuple(i["bbox"]))
            if v > best_iou:
                best, best_iou = i, v
    if best is None or best_iou < 0.6:
        return None, 0
    return tuple(best["bbox"]), best["xref"]


# Look of every added table (same values as TABLE_STYLE in SectionPdfEditor.jsx): plain white cells,
# thin black borders, centred regular-weight text, like a table pasted from Excel.
# The editor and the PDF both use this one look, so tables created earlier follow it as well.
TABLE_LOOK = {"fill": (1, 1, 1), "border": (0, 0, 0), "border_w": 0.5, "text": (0, 0, 0), "size": 10.0, "lead": 1.25}
_CALIBRI_FILES = (
    "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf",
    "/usr/share/fonts/truetype/carlito/Carlito-Regular.ttf",
    "/usr/share/fonts/opentype/crosextra/Carlito-Regular.ttf",
    "C:/Windows/Fonts/calibri.ttf",
    "/Library/Fonts/Calibri.ttf",
    "/System/Library/Fonts/Supplemental/Calibri.ttf",
)


def _table_font_file():
    for path in _CALIBRI_FILES:
        if os.path.exists(path):
            return path
    return None


def _apply_tables(fitz, doc, sp, data):
    items = []
    for k, v in data.items():
        if not k.startswith("tbl__"):
            continue
        try:
            t = json.loads(v) if isinstance(v, str) else v
        except ValueError:
            continue
        if isinstance(t, dict) and int(_f(t.get("rows"), 0)) > 0 and int(_f(t.get("cols"), 0)) > 0:
            items.append((k[5:], t))
    if not items:
        return {}
    style = body_style(doc)
    base14 = _BASE14[(style["family"], 0, 0)]
    font_file = _table_font_file()  # Calibri / Carlito when the server has it, otherwise the report's body font
    look = TABLE_LOOK
    size = look["size"]
    lead = size * look["lead"]
    out = {}
    for tid, t in items:
        pno = int(_clamp(int(_f(t.get("page", 1))) - 1, 0, len(doc) - 1))
        page = doc[pno]
        pw, ph = page.rect.width, page.rect.height
        x = _clamp(_f(t.get("x"), 0), 0, pw)
        top = _clamp(_f(t.get("top", 0)), 0, ph)
        w = _clamp(_f(t.get("w", 100)), 10, pw - x)
        h = _clamp(_f(t.get("h", 100)), 10, ph - top)
        rows = int(_clamp(_f(t.get("rows", 1)), 1, 50))
        cols = int(_clamp(_f(t.get("cols", 1)), 1, 20))
        headerRow = bool(t.get("headerRow"))
        cellText = t.get("cellText", [])
        if not isinstance(cellText, list) or len(cellText) == 0:
            cellText = [["" for _ in range(cols)] for _ in range(rows)]
        row_h = h / rows
        col_w = w / cols

        fontname, font, clean = base14, None, True
        if font_file:
            try:
                fontname = "TblFont"
                page.insert_font(fontname=fontname, fontfile=font_file)
                font = fitz.Font(fontfile=font_file)
                clean = False  # a real font file covers more characters than the base-14 set
            except Exception:
                log.warning("table font %s could not be loaded; using %s", font_file, base14)
                fontname, font, clean = base14, None, True
        if font is None:
            font = fitz.Font(base14)
        asc = getattr(font, "ascender", 0.9) or 0.9
        desc = getattr(font, "descender", -0.2)
        desc = desc if desc is not None else -0.2

        # 1) cell backgrounds and borders (one rectangle per cell, so the grid lines are uniform)
        for r in range(rows):
            for c in range(cols):
                page.draw_rect(fitz.Rect(x + c * col_w, top + r * row_h, x + (c + 1) * col_w, top + (r + 1) * row_h),
                               color=look["border"], fill=look["fill"], width=look["border_w"], overlay=True)
        # 2) centred text, vertically centred in each cell
        for r in range(rows):
            for c in range(cols):
                val = ""
                if r < len(cellText) and isinstance(cellText[r], list) and c < len(cellText[r]):
                    val = str(cellText[r][c])
                if not val.strip():
                    continue
                if clean:
                    val = val.translate(_TYPO)
                cx, ct = x + c * col_w, top + r * row_h
                lines = [ln for ln, _ in wrap_text(font, val, size, max(1.0, col_w - 6))]
                fit = max(1, int((row_h - 2) // lead))  # only draw the lines that fit inside the cell
                lines = lines[:fit]
                block_top = ct + (row_h - len(lines) * lead) / 2
                pad = (lead - (asc - desc) * size) / 2
                for i, line in enumerate(lines):
                    if not line:
                        continue
                    lw = font.text_length(line, size)
                    page.insert_text(fitz.Point(cx + (col_w - lw) / 2, block_top + i * lead + pad + asc * size), line,
                                     fontname=fontname, fontsize=size, color=look["text"])
        out[tid] = {
            "page": pno + 1, "x": x, "top": top, "w": w, "h": h,
            "rows": rows, "cols": cols, "headerRow": headerRow,
            "cellText": cellText,
        }
    return out


def _apply_images(fitz, doc, sp, data):
    """Snap every image box to its real PDF position (bottom-origin) and apply moves / resizes.

    Returns True when the document was modified.
    """
    boxes = sp.get("__images")
    if not isinstance(boxes, dict):
        return False
    changed = False
    jobs = {}
    for iid, b in list(boxes.items()):
        if not isinstance(b, dict) or not b.get("filled"):
            continue
        pno = int(_f(b.get("page"), 0)) - 1
        if not 0 <= pno < len(doc):
            continue
        page = doc[pno]
        pw, ph = page.rect.width, page.rect.height
        bbox, xref = _find_image(page, b)
        if bbox is None:
            log.warning("image %s: no matching picture on page %s, left untouched", iid, pno + 1)
            continue
        x0, t0, x1, t1 = bbox
        boxes[iid] = {**b, "x": x0, "y": ph - t1, "w": x1 - x0, "h": t1 - t0}
        dx, dy = _f(data.get(f"img_dx__{iid}")), _f(data.get(f"img_dy__{iid}"))
        sc = _f(data.get(f"img_scale__{iid}"), 1.0) or 1.0
        if abs(dx) < 0.05 and abs(dy) < 0.05 and abs(sc - 1) < 0.001:
            continue
        w, h = x1 - x0, t1 - t0
        if w <= 0 or h <= 0:
            continue
        sc = min(_clamp(sc, 0.1, 8.0), pw / w, ph / h)
        nw, nh = w * sc, h * sc
        nx = _clamp(x0 + dx, 0, pw - nw)
        nt = _clamp(t0 + dy, 0, ph - nh)
        jobs.setdefault(pno, []).append({"id": iid, "xref": xref, "ph": ph, "base": bbox, "new": (nx, nt, nx + nw, nt + nh)})

    for pno, plist in jobs.items():
        page = doc[pno]
        # 1) hide every original first, so a new spot that overlaps an old one still shows the picture
        for j in plist:
            x0, t0, x1, t1 = j["base"]
            page.draw_rect(fitz.Rect(x0 - 0.75, t0 - 0.75, x1 + 0.75, t1 + 0.75), color=None, fill=(1, 1, 1), overlay=True)
        # 2) draw the same image object at its new rectangle (no re-encoding: alpha and colours are untouched)
        for j in plist:
            page.insert_image(fitz.Rect(*j["new"]), xref=j["xref"], keep_proportion=False, overlay=True)
        # 3) verify: the picture must really be present at the new place, otherwise give up on all edits
        infos = [i for i in page.get_image_info(xrefs=True) if i.get("bbox")]
        for j in plist:
            if not any(i.get("xref") == j["xref"] and _iou(j["new"], tuple(i["bbox"])) > 0.5 for i in infos):
                raise RuntimeError(f"image {j['id']} could not be verified at its new position")
            nx0, nt0, nx1, nt1 = j["new"]
            boxes[j["id"]] = {**boxes[j["id"]], "x": nx0, "y": j["ph"] - nt1, "w": nx1 - nx0, "h": nt1 - nt0}
        changed = True
    return changed


# --------------------------------------------------------------------------
# added text boxes
# --------------------------------------------------------------------------
def wrap_text(font, text, size, width):
    """Greedy word wrap. Returns [(line, last_line_of_paragraph)]."""
    out = []
    space = font.text_length(" ", size)
    for para in text.replace("\r", "").split("\n"):
        words = para.split()
        if not words:
            out.append(("", True))
            continue
        cur, cur_w = [], 0.0
        for wd in words:
            ww = font.text_length(wd, size)
            add = ww if not cur else space + ww
            if cur and cur_w + add > width:
                out.append((" ".join(cur), False))
                cur, cur_w = [wd], ww
            else:
                cur.append(wd)
                cur_w += add
        out.append((" ".join(cur), True))
    return out


def line_x_positions(font, line, size, x, width, align, last):
    """Return [(word, x)] for one line, honouring alignment (justify spreads the gaps)."""
    words = line.split(" ")
    lw = font.text_length(line, size)
    if align == "justify" and not last and len(words) > 1:
        total = sum(font.text_length(w, size) for w in words)
        gap = (width - total) / (len(words) - 1)
        pos, cx = [], x
        for w in words:
            pos.append((w, cx))
            cx += font.text_length(w, size) + gap
        return pos
    if align == "center":
        return [(line, x + (width - lw) / 2)]
    if align == "right":
        return [(line, x + width - lw)]
    return [(line, x)]


def _apply_texts(fitz, doc, sp, data, layout):
    items = []
    for k, v in data.items():
        if not k.startswith("txt__"):
            continue
        try:
            t = json.loads(v) if isinstance(v, str) else v
        except ValueError:
            continue
        if isinstance(t, dict) and str(t.get("text", "")).strip():
            items.append((k[5:], t))
    if not items:
        return {}
    style = body_style(doc)
    default_align = (layout or {}).get("text_align")
    default_align = default_align if default_align in ALIGNS else "justify"
    out = {}
    for tid, t in items:
        start = sp.get(t.get("sec")) if t.get("sec") else None
        if isinstance(start, (int, float)) and t.get("rel") is not None:
            pno = int(start) - 1 + int(_f(t.get("rel")))
        else:
            pno = int(_f(t.get("page"), 1)) - 1
        pno = int(_clamp(pno, 0, len(doc) - 1))
        page = doc[pno]
        pw, ph = page.rect.width, page.rect.height

        # same margins as the body text on this page unless the user dragged the box somewhere else
        left, right = page_margins(page, style)
        x = t.get("x")
        w = t.get("w")
        x = _f(x) if x is not None else left
        w = _f(w) if w is not None else right - left
        w = _clamp(w, 30, pw)
        x = _clamp(x, 0, pw - w)

        size = _clamp(_f(t.get("size")) or style["size"], 4, 72)
        lead = _clamp(_f(t.get("lead")) or style["lead"] * size / style["size"], 4, 144)
        bold = (1 if t.get("bold") else 0) if "bold" in t else style["bold"]
        italic = (1 if t.get("italic") else 0) if "italic" in t else style["italic"]
        family = t.get("family") if t.get("family") in ("he", "ti", "co") else style["family"]
        color = _parse_text_color(t.get("color"), style["color"])
        fontname = _BASE14[(family, bold, italic)]
        font = fitz.Font(fontname)
        align = t.get("align") if t.get("align") in ALIGNS else default_align
        text = str(t["text"]).translate(_TYPO)
        wrapped = wrap_text(font, text, size, w)
        h = max(1, len(wrapped)) * lead
        top = _clamp(_f(t.get("top")), 0, max(0.0, ph - h))
        asc = getattr(font, "ascender", 0.9) or 0.9
        for i, (line, last) in enumerate(wrapped):
            if not line:
                continue
            base_y = top + asc * size + i * lead
            for word, wx in line_x_positions(font, line, size, x, w, align, last):
                page.insert_text(fitz.Point(wx, base_y), word, fontname=fontname, fontsize=size, color=color)
        r, g, b = color
        out[tid] = {"page": pno + 1, "x": x, "top": top, "w": w, "h": h, "align": align, "size": size, "lead": lead,
                    "family": family, "bold": bold, "italic": italic,
                    "color": f"rgb({round(r * 255)},{round(g * 255)},{round(b * 255)})"}
    return out


# --------------------------------------------------------------------------
def apply_editor_overlays(content, section_pages, data, images=None, layout=None):
    sp_in = section_pages if isinstance(section_pages, dict) else {}
    keys = list(data.keys()) if isinstance(data, dict) else []
    has_img = any(k.startswith(("img_dx__", "img_dy__", "img_scale__")) for k in keys)
    has_txt = any(k.startswith("txt__") for k in keys)
    has_tbl = any(k.startswith("tbl__") for k in keys)
    has_boxes = isinstance(sp_in.get("__images"), dict) and bool(sp_in.get("__images"))
    if not (has_img or has_txt or has_tbl or has_boxes):
        return content, sp_in
    try:
        import fitz  # PyMuPDF
    except Exception:
        return content, sp_in
    try:
        sp = json.loads(json.dumps(sp_in))
        doc = fitz.open(stream=content, filetype="pdf")
        changed = _apply_images(fitz, doc, sp, data)
        texts = _apply_texts(fitz, doc, sp, data, layout)
        tables = _apply_tables(fitz, doc, sp, data)
        sp["__texts"] = texts
        sp["__tables"] = tables
        out = doc.tobytes(garbage=3, deflate=True) if (changed or texts or tables) else content
        doc.close()
        return out, sp
    except Exception:
        log.exception("editor overlays failed; returning the plain report")
        return content, sp_in