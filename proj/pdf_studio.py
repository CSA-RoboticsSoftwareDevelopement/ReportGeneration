"""PDF Studio backend: a local, document-centric PDF workspace.

The module implements the practical PDFgear-style tool set the report studio
needs: open/read, text and image editing, markup, page organisation, forms,
OCR, conversion, compression, protection, sharing, comparison and a local
document assistant.  It intentionally uses only local libraries (PyMuPDF,
Pillow, python-docx, openpyxl, python-pptx and the installed Tesseract) and
never uploads a document to a third party.

Sessions are stored below ``uploads/pdf-studio`` and are scoped to the signed-in
user.  Each mutating action takes an undo snapshot first.
"""
from __future__ import annotations

import base64
import csv
import difflib
import io
import json
import math
import os
import re
import secrets
import shutil
import statistics
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid
import zipfile
from pathlib import Path
from typing import Any, Iterable

import pymupdf
from PIL import Image
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse

try:  # optional, but installed in the report environment
    from docx import Document as DocxDocument
    from docx.shared import Pt
except Exception:  # pragma: no cover - exposed as a friendly 503
    DocxDocument = None
    Pt = None

try:
    import openpyxl
except Exception:  # pragma: no cover
    openpyxl = None

try:
    from pptx import Presentation
    from pptx.util import Inches
except Exception:  # pragma: no cover
    Presentation = None
    Inches = None


ROOT = Path(__file__).with_name("uploads") / "pdf-studio"
ROOT.mkdir(parents=True, exist_ok=True)
QUARANTINE_ROOT = ROOT.parent / "pdf-studio-quarantine"
SESSION_TTL = 10 * 24 * 60 * 60
PREVIEW_SESSION_TTL = 60 * 60
QUARANTINE_TTL = 7 * 24 * 60 * 60
MAX_UPLOAD = 120 * 1024 * 1024
LOCK = threading.RLock()
DOC_ID_RE = re.compile(r"^[a-f0-9]{32}$")

SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------


def _now() -> float:
    return time.time()


def _session_dir(doc_id: str) -> Path:
    if not DOC_ID_RE.match(str(doc_id or "")):
        raise HTTPException(status_code=404, detail="PDF workspace not found.")
    return ROOT / doc_id


def _meta_file(doc_id: str) -> Path:
    return _session_dir(doc_id) / "meta.json"


def _doc_file(doc_id: str) -> Path:
    return _session_dir(doc_id) / "doc.pdf"


def _protected_file(doc_id: str) -> Path:
    return _session_dir(doc_id) / "protected.pdf"


def _load_meta(doc_id: str, user: dict) -> dict:
    path = _meta_file(doc_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="PDF workspace not found or expired.")
    try:
        meta = json.loads(path.read_text("utf-8"))
    except Exception:
        raise HTTPException(status_code=500, detail="The PDF workspace metadata is unreadable.")
    if str(meta.get("owner_id")) != str(user.get("id")):
        raise HTTPException(status_code=403, detail="This PDF belongs to another user.")
    return meta


def _save_meta(doc_id: str, meta: dict) -> None:
    meta["updated"] = _now()
    _meta_file(doc_id).write_text(json.dumps(meta, indent=2), "utf-8")


def _clean_name(name: str, fallback: str = "document.pdf") -> str:
    name = Path(str(name or fallback)).name
    name = SAFE_NAME.sub("_", name).strip(" .") or fallback
    return name[:120]


def _cleanup_old_sessions() -> None:
    now = _now()
    for entry in ROOT.iterdir():
        try:
            if not entry.is_dir() or not DOC_ID_RE.match(entry.name):
                continue
            updated = entry.stat().st_mtime
            kind = "studio"
            meta_path = entry / "meta.json"
            if meta_path.is_file():
                try:
                    meta = json.loads(meta_path.read_text("utf-8"))
                    updated = float(meta.get("updated") or updated)
                    kind = str(meta.get("kind") or kind)
                except (OSError, TypeError, ValueError, json.JSONDecodeError):
                    pass
            ttl = PREVIEW_SESSION_TTL if kind == "section-preview" else SESSION_TTL
            if updated < now - ttl:
                shutil.rmtree(entry, ignore_errors=True)
        except OSError:
            continue
    if QUARANTINE_ROOT.is_dir():
        for entry in QUARANTINE_ROOT.iterdir():
            try:
                if entry.is_dir() and entry.stat().st_mtime < now - QUARANTINE_TTL:
                    shutil.rmtree(entry, ignore_errors=True)
            except OSError:
                continue


def _open_working(doc_id: str) -> pymupdf.Document:
    path = _doc_file(doc_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="The working PDF is missing.")
    try:
        doc = pymupdf.open(path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"The working PDF could not be opened: {exc}")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=423, detail="The working PDF is password protected.")
    return doc


def _save_working(doc: pymupdf.Document, doc_id: str) -> None:
    target = _doc_file(doc_id)
    tmp = _session_dir(doc_id) / f"save-{uuid.uuid4().hex}.pdf"
    try:
        doc.save(
            str(tmp),
            garbage=3,
            deflate=True,
            deflate_images=True,
            deflate_fonts=True,
            clean=True,
        )
        doc.close()
        os.replace(tmp, target)
    except Exception:
        try:
            doc.close()
        except Exception:
            pass
        tmp.unlink(missing_ok=True)
        raise


def _snapshot(doc_id: str, meta: dict) -> None:
    undo_dir = _session_dir(doc_id) / "undo"
    redo_dir = _session_dir(doc_id) / "redo"
    undo_dir.mkdir(exist_ok=True)
    redo_dir.mkdir(exist_ok=True)
    name = f"u{int(_now() * 1000)}-{secrets.token_hex(3)}.pdf"
    shutil.copyfile(_doc_file(doc_id), undo_dir / name)
    meta.setdefault("undo", []).append(name)
    while len(meta["undo"]) > 25:
        old = meta["undo"].pop(0)
        (undo_dir / old).unlink(missing_ok=True)
    for old in meta.get("redo", []):
        (redo_dir / old).unlink(missing_ok=True)
    meta["redo"] = []


def _new_session(
    owner_id: Any,
    name: str,
    data: bytes,
    *,
    was_protected: bool = False,
    kind: str = "studio",
    revision: int = 0,
) -> dict:
    _cleanup_old_sessions()
    doc_id = uuid.uuid4().hex
    directory = ROOT / doc_id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "undo").mkdir(exist_ok=True)
    (directory / "redo").mkdir(exist_ok=True)
    path = directory / "doc.pdf"
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(status_code=400, detail="That file isn't a valid PDF document.")
    if doc.needs_pass:
        doc.close()
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(
            status_code=401,
            detail="This PDF is password protected. Enter its password to open it.",
        )
    if doc.page_count == 0:
        doc.close()
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(status_code=400, detail="The PDF has no pages.")
    try:
        doc.save(str(path), garbage=3, deflate=True)
    except Exception as exc:
        doc.close()
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"The PDF could not be prepared for editing: {exc}")
    doc.close()
    meta = {
        "id": doc_id,
        "owner_id": str(owner_id),
        "name": _clean_name(name),
        "created": _now(),
        "updated": _now(),
        "was_protected": was_protected,
        "protected": False,
        "kind": kind,
        "revision": max(0, int(revision)),
        "undo": [],
        "redo": [],
        "shares": [],
    }
    _save_meta(doc_id, meta)
    return meta


def _replace_preview(doc_id: str, user: dict, data: bytes, revision: int) -> tuple[dict, bool]:
    """Atomically replace a generated section preview without adding undo history."""
    with LOCK:
        meta = _load_meta(doc_id, user)
        if meta.get("kind") != "section-preview":
            raise HTTPException(status_code=409, detail="Only a Section Editor preview can be replaced.")
        current_revision = int(meta.get("revision") or 0)
        if revision <= current_revision:
            return meta, False

        try:
            doc = pymupdf.open(stream=data, filetype="pdf")
        except Exception:
            raise HTTPException(status_code=400, detail="That file isn't a valid PDF document.")
        if doc.needs_pass or doc.page_count == 0:
            doc.close()
            raise HTTPException(status_code=400, detail="The preview PDF is not editable.")

        directory = _session_dir(doc_id)
        tmp = directory / f"preview-{uuid.uuid4().hex}.pdf"
        try:
            doc.save(str(tmp), garbage=3, deflate=True)
            doc.close()
            os.replace(tmp, _doc_file(doc_id))
        except Exception as exc:
            try:
                doc.close()
            except Exception:
                pass
            tmp.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=f"The preview PDF could not be prepared: {exc}")

        for folder_name in ("undo", "redo"):
            folder = directory / folder_name
            if folder.is_dir():
                for old in folder.iterdir():
                    if old.is_file():
                        old.unlink(missing_ok=True)
        meta["undo"] = []
        meta["redo"] = []
        meta["protected"] = False
        meta["revision"] = revision
        _protected_file(doc_id).unlink(missing_ok=True)
        _save_meta(doc_id, meta)
        return meta, True


def _mutate(doc_id: str, user: dict, fn) -> tuple[dict, Any]:
    """Run fn(doc) against the working PDF, then persist and return fresh info."""
    with LOCK:
        meta = _load_meta(doc_id, user)
        doc = _open_working(doc_id)
        result = None
        try:
            _snapshot(doc_id, meta)
            result = fn(doc)
            if doc.page_count < 1:
                raise HTTPException(status_code=400, detail="A PDF must contain at least one page.")
            _save_working(doc, doc_id)
        except HTTPException:
            try:
                doc.close()
            except Exception:
                pass
            # Drop the snapshot taken for the failed operation so Undo does not
            # offer an empty step.
            if meta.get("undo"):
                failed = meta["undo"].pop()
                (_session_dir(doc_id) / "undo" / failed).unlink(missing_ok=True)
            raise
        except Exception as exc:
            try:
                doc.close()
            except Exception:
                pass
            if meta.get("undo"):
                failed = meta["undo"].pop()
                (_session_dir(doc_id) / "undo" / failed).unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail=f"The PDF operation failed: {exc}")
    meta["protected"] = False
    _protected_file(doc_id).unlink(missing_ok=True)
    _save_meta(doc_id, meta)
    return meta, result


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def _rgb(value: str | None, fallback=(0, 0, 0)) -> tuple[float, float, float]:
    if not value:
        return fallback
    value = str(value).strip()
    if value.startswith("#"):
        value = value[1:]
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6:
        return fallback
    try:
        return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return fallback


def _hex_color(color) -> str:
    if color is None:
        return "#000000"
    if isinstance(color, (tuple, list)) and len(color) >= 3:
        return "#" + "".join(f"{max(0, min(255, round(float(c) * 255))):02x}" for c in color[:3])
    if isinstance(color, int):
        return f"#{color & 0xFFFFFF:06x}"
    return "#000000"


def _display_rect(page: pymupdf.Page, rect) -> dict:
    r = pymupdf.Rect(rect)
    if page.rotation:
        r = r * page.rotation_matrix
    pw, ph = page.rect.width or 1, page.rect.height or 1
    return {
        "x": max(0.0, min(1.0, r.x0 / pw)),
        "y": max(0.0, min(1.0, r.y0 / ph)),
        "w": max(0.0, min(1.0, (r.x1 - r.x0) / pw)),
        "h": max(0.0, min(1.0, (r.y1 - r.y0) / ph)),
    }


def _norm_rect(page: pymupdf.Page, item: dict) -> pymupdf.Rect:
    pw, ph = page.rect.width, page.rect.height
    try:
        x = float(item.get("x", 0))
        y = float(item.get("y", 0))
        w = float(item.get("w", 0))
        h = float(item.get("h", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid rectangle coordinates.")
    r = pymupdf.Rect(x * pw, y * ph, (x + w) * pw, (y + h) * ph)
    r.normalize()
    if page.rotation:
        r = r * page.derotation_matrix
    return r


def _norm_point(page: pymupdf.Page, item: dict) -> pymupdf.Point:
    pw, ph = page.rect.width, page.rect.height
    try:
        p = pymupdf.Point(float(item.get("x", 0)) * pw, float(item.get("y", 0)) * ph)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid point coordinates.")
    if page.rotation:
        p = p * page.derotation_matrix
    return p


def _page_index(doc: pymupdf.Document, number: Any) -> int:
    try:
        index = int(number) - 1
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid page number.")
    if index < 0 or index >= doc.page_count:
        raise HTTPException(status_code=400, detail="That page does not exist.")
    return index


def _font_for(page: pymupdf.Page, font_name: str, bold: bool, italic: bool) -> tuple[str, str | None]:
    """Return a base-14 font name and, where possible, an embedded font file."""
    name = (font_name or "").lower()
    mono = "courier" in name or "mono" in name or "consol" in name
    serif = any(token in name for token in ("times", "serif", "georgia", "garamond", "cambria"))
    if mono:
        base = "cobo" if bold else "cour"
    elif serif:
        base = "tibo" if bold else "tiro"
    else:
        base = "hebo" if bold else "helv"
    return base, None     
    # Use an embedded font when it is a usable TrueType/OpenType subset.
    try:
        for entry in page.get_fonts(full=True):
            xref, ext, _kind, basefont, _resname, _encoding = entry[:6]
            if not basefont:
                continue
            if font_name and font_name.lower() not in str(basefont).lower() and str(basefont).lower() not in font_name.lower():
                continue
            if str(ext).lower() not in ("ttf", "otf"):
                continue
            extracted = page.parent.extract_font(xref)
            if not extracted or len(extracted) < 4 or not extracted[3]:
                continue
            target = page.parent.name and Path(page.parent.name).parent
            # Write next to the working document so the font survives this call.
            directory = ROOT / "_fonts"
            directory.mkdir(exist_ok=True)
            suffix = ".otf" if str(ext).lower() == "otf" else ".ttf"
            font_path = directory / f"{xref}-{secrets.token_hex(4)}{suffix}"
            font_path.write_bytes(extracted[3])
            return base, str(font_path)
    except Exception:
        pass
    return base, None


def _text_span_hit(page: pymupdf.Page, x: float, y: float) -> dict | None:
    """Find the text line nearest a normalized click, returning editable metadata."""
    pw, ph = page.rect.width, page.rect.height
    point = pymupdf.Point(x * pw, y * ph)
    if page.rotation:
        point = point * page.derotation_matrix
    best = None
    best_distance = 1e9
    data = page.get_text("dict")
    for block in data.get("blocks", []):
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            rect = pymupdf.Rect(line.get("bbox"))
            if page.rotation:
                display = rect * page.rotation_matrix
            else:
                display = rect
            text = "".join(span.get("text", "") for span in spans).strip()
            if not text:
                continue
            # Keep the closest individual PDF span as well as the full line.
            # A report line can contain more than one grey placeholder (for
            # example Mesh nodes and Mesh elements); returning only the line
            # made every click resolve to the first placeholder.
            span_text = ""
            span_distance = 1e9
            span_style = spans[0]
            for span in spans:
                candidate = str(span.get("text", "")).strip()
                if not candidate:
                    continue
                span_rect = pymupdf.Rect(span.get("bbox"))
                distance_to_span = 0.0 if span_rect.contains(point) else min(
                    abs(point.x - span_rect.x0), abs(point.x - span_rect.x1),
                    abs(point.y - span_rect.y0), abs(point.y - span_rect.y1),
                )
                if distance_to_span < span_distance:
                    span_distance = distance_to_span
                    span_text = candidate
                    span_style = span
            contains = rect.contains(point)
            distance = 0.0 if contains else min(
                abs(point.x - rect.x0),
                abs(point.x - rect.x1),
                abs(point.y - rect.y0),
                abs(point.y - rect.y1),
            )
            if distance < best_distance:
                best_distance = distance
                block_lines = [pymupdf.Rect(item.get("bbox")) for item in block.get("lines", []) if item.get("bbox")]
                align = _infer_text_alignment(block_lines, pw)
                line_gaps = [b.y0 - a.y0 for a, b in zip(block_lines, block_lines[1:]) if 3 <= b.y0 - a.y0 <= 40]
                best = {
                    "text": text,
                    "placeholder_text": span_text,
                    "rect": _display_rect(page, display),
                    "font": span_style.get("font", "Helvetica"),
                    "family": _text_font_family(span_style.get("font", "Helvetica"), int(span_style.get("flags", 0) or 0)),
                    "size": round(float(span_style.get("size", 11)), 2),
                    "color": _hex_color(span_style.get("color")),
                    "flags": int(span_style.get("flags", 0) or 0),
                    "bold": bool(int(span_style.get("flags", 0) or 0) & 16),
                    "italic": bool(int(span_style.get("flags", 0) or 0) & 2),
                    "align": align,
                    "lead": round(statistics.median(line_gaps), 2) if line_gaps else None,
                    "page": page.number + 1,
                }
    if best and best_distance <= (18 if best_distance else 0):
        return best
    return None


def _text_font_family(font: str, flags: int) -> str:
    name = str(font or "").lower()
    if "courier" in name or "mono" in name or flags & 8:
        return "co"
    if "times" in name or ("serif" in name and "sans" not in name):
        return "ti"
    return "he"


def _infer_text_alignment(lines: list[pymupdf.Rect], page_width: float) -> str:
    """Infer paragraph alignment from the rendered line edges in a PDF block."""
    if not lines:
        return "justify"
    lefts = [rect.x0 for rect in lines]
    rights = [rect.x1 for rect in lines]
    centers = [(rect.x0 + rect.x1) / 2 for rect in lines]
    if len(lines) == 1:
        if abs(centers[0] - page_width / 2) <= 3:
            return "center"
        if abs(rights[0] - (page_width - 42)) <= 3 and lefts[0] > page_width * 0.1:
            return "right"
        return "justify"
    if max(centers) - min(centers) <= 2 and max(rights) - min(rights) > 3:
        return "center"
    if max(rights) - min(rights) <= 2 and max(lefts) - min(lefts) > 2:
        return "right"
    if max(lefts) - min(lefts) <= 2:
        if len(rights) >= 2 and abs(rights[0] - (page_width - 42)) <= 4 and rights[-1] < rights[0] - 3:
            return "justify"
        if len(rights) >= 3 and max(rights[:-1]) - min(rights[:-1]) <= 2 and rights[-1] < statistics.median(rights[:-1]) - 3:
            return "justify"
        return "left"
    return "justify"


def _insert_editable_text(
    doc: pymupdf.Document,
    page: pymupdf.Page,
    rect: pymupdf.Rect,
    text: str,
    *,
    font_size: float = 11,
    color: str = "#000000",
    font_name: str = "Helvetica",
    bold: bool = False,
    italic: bool = False,
    align: int = 0,
    background: str = "#ffffff",
) -> None:
    page.add_redact_annot(rect, fill=_rgb(background, (1, 1, 1)))
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )
    if not text:
        return
    base, font_file = _font_for(page, font_name, bold, italic)
    size = max(5.0, min(144.0, float(font_size or 11)))
    height = rect.height
    lines = max(1, str(text).count("\n") + 1)
    target = pymupdf.Rect(rect.x0, rect.y0, rect.x1, max(rect.y1, rect.y0 + size * 1.35 * lines))
    for _ in range(5):
        rc = page.insert_textbox(
            target,
            text,
            fontsize=size,
            fontname=base,
            fontfile=font_file,
            color=_rgb(color),
            align=align,
            lineheight=1.25,
            overlay=True,
        )
        if rc >= 0:
            return
        target.y1 += max(4.0, size * 1.4)
    # Last resort: place one unwrapped line at the original position.
    page.insert_text(
        (rect.x0 + 1, rect.y0 + size),
        str(text).splitlines()[0][:500],
        fontsize=size,
        fontname=base,
        fontfile=font_file,
        color=_rgb(color),
        overlay=True,
    )


def _line_height_for_text(text: str, size: float) -> float:
    return max(size * 1.35, size * 1.35 * (str(text).count("\n") + 1))


def _doc_info(doc_id: str, meta: dict, doc: pymupdf.Document) -> dict:
    pages = []
    for i, page in enumerate(doc):
        pages.append(
            {
                "number": i + 1,
                "width": round(page.rect.width, 2),
                "height": round(page.rect.height, 2),
                "rotation": int(page.rotation),
            }
        )
    annotations = []
    forms = []
    for i, page in enumerate(doc):
        try:
            for annot in page.annots() or []:
                try:
                    info = annot.info or {}
                    colors = annot.colors or {}
                    annotations.append(
                        {
                            "id": annot.xref,
                            "page": i + 1,
                            "type": str(annot.type[1]) if isinstance(annot.type, (tuple, list)) and len(annot.type) > 1 else str(annot.type),
                            "content": (info.get("content") or "").strip(),
                            "title": (info.get("title") or "").strip(),
                            "rect": _display_rect(page, annot.rect),
                            "color": _hex_color(colors.get("stroke")),
                            "opacity": round(float(annot.opacity if annot.opacity is not None else 1), 3),
                        }
                    )
                except Exception:
                    continue
        except Exception:
            pass
        try:
            for widget in page.widgets() or []:
                forms.append(
                    {
                        "name": widget.field_name or "",
                        "label": widget.field_label or widget.field_name or "",
                        "type": getattr(widget, "field_type_string", "Field"),
                        "value": widget.field_value if widget.field_value is not None else "",
                        "page": i + 1,
                        "rect": _display_rect(page, widget.rect),
                    }
                )
        except Exception:
            pass
    metadata = dict(doc.metadata or {})
    toc = []
    try:
        toc = [{"level": item[0], "title": item[1], "page": item[2]} for item in doc.get_toc(simple=True)]
    except Exception:
        toc = []
    return {
        "doc_id": doc_id,
        "name": meta.get("name", "document.pdf"),
        "page_count": doc.page_count,
        "pages": pages,
        "metadata": metadata,
        "toc": toc,
        "annotations": annotations,
        "forms": forms,
        "is_form": bool(doc.is_form_pdf),
        "is_encrypted": bool(doc.is_encrypted),
        "was_protected": bool(meta.get("was_protected")),
        "protected": bool(meta.get("protected")),
        "kind": meta.get("kind", "studio"),
        "revision": int(meta.get("revision") or 0),
        "has_protection_copy": _protected_file(doc_id).is_file(),
        "file_size": _doc_file(doc_id).stat().st_size if _doc_file(doc_id).is_file() else 0,
        "can_undo": bool(meta.get("undo")),
        "can_redo": bool(meta.get("redo")),
        "updated": meta.get("updated"),
    }


def _info(doc_id: str, meta: dict) -> dict:
    doc = _open_working(doc_id)
    try:
        return _doc_info(doc_id, meta, doc)
    finally:
        doc.close()


def _read_upload(upload: UploadFile) -> bytes:
    data = upload.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="Files larger than 120 MB are not supported.")
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    return data


def _safe_filename(name: str) -> str:
    clean = _clean_name(name, "document.pdf")
    return urllib.parse.quote(clean)


def _attachment(data: bytes, name: str, media_type: str) -> Response:
    clean = _clean_name(name, "download")
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": f"attachment; filename=\"{clean}\"; filename*=UTF-8''{_safe_filename(clean)}",
            "Content-Length": str(len(data)),
        },
    )


def _input_text(value: Any) -> str:
    return "" if value is None else str(value)


def _json_body(request: Request) -> dict:
    # Request.json() is async; endpoints using this helper must await it.
    raise RuntimeError("Use await request.json() directly")


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def create_router(require_user, require_csrf) -> APIRouter:
    router = APIRouter(prefix="/api/pdf", tags=["PDF Studio"])

    @router.post("/create")
    async def create_pdf(request: Request, files: list[UploadFile] = File(...)):
        user = require_user(request)
        require_csrf(request)
        payload = [(item.filename or "file", _read_upload(item)) for item in files]
        return JSONResponse({"info": create_pdf_from_files(user.get("id"), payload)})

    @router.post("/open")
    async def open_pdf(
        request: Request,
        file: UploadFile = File(...),
        password: str = Form(""),
        name: str = Form(""),
    ):
        user = require_user(request)
        require_csrf(request)
        data = _read_upload(file)
        display_name = name or file.filename or "document.pdf"
        # Unlock encrypted uploads before creating the working session so every
        # later operation works on a plain, editable copy.
        try:
            probe = pymupdf.open(stream=data, filetype="pdf")
        except Exception:
            raise HTTPException(status_code=400, detail="That file isn't a valid PDF document.")
        was_protected = bool(probe.needs_pass)
        if was_protected:
            if not password or not probe.authenticate(password):
                probe.close()
                raise HTTPException(
                    status_code=401,
                    detail="This PDF is password protected. Enter its password to open it.",
                )
            data = probe.tobytes(garbage=3, deflate=True)
        try:
            page_count = probe.page_count
        except Exception:
            page_count = 0
        probe.close()
        if page_count == 0:
            raise HTTPException(status_code=400, detail="The PDF has no pages.")
        meta = _new_session(user.get("id"), display_name, data, was_protected=was_protected)
        return JSONResponse({"info": _info(meta["id"], meta)})

    @router.post("/preview")
    async def open_or_replace_preview(
        request: Request,
        file: UploadFile = File(...),
        doc_id: str = Form(""),
        revision: int = Form(1),
    ):
        """Create one transient Section Editor session, then replace it in place."""
        user = require_user(request)
        require_csrf(request)
        data = _read_upload(file)
        revision = max(1, int(revision))
        if doc_id:
            meta, applied = _replace_preview(doc_id, user, data, revision)
        else:
            with LOCK:
                meta = _new_session(
                    user.get("id"),
                    "Report.pdf",
                    data,
                    kind="section-preview",
                    revision=revision,
                )
            applied = True
        return JSONResponse({"info": _info(meta["id"], meta), "applied": applied})

    @router.delete("/preview/{doc_id}", status_code=204)
    def delete_preview(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        with LOCK:
            meta = _load_meta(doc_id, user)
            if meta.get("kind") != "section-preview":
                raise HTTPException(status_code=409, detail="Only a Section Editor preview can be deleted here.")
            shutil.rmtree(_session_dir(doc_id))
        return Response(status_code=204)

    @router.get("/{doc_id}/info")
    def info(doc_id: str, request: Request):
        user = require_user(request)
        meta = _load_meta(doc_id, user)
        return JSONResponse(_info(doc_id, meta))

    @router.get("/{doc_id}/file")
    def file(doc_id: str, request: Request):
        user = require_user(request)
        _load_meta(doc_id, user)
        path = _doc_file(doc_id)
        if not path.is_file():
            raise HTTPException(status_code=404, detail="The working PDF is missing.")
        return Response(
            path.read_bytes(),
            media_type="application/pdf",
            headers={"Content-Disposition": f"inline; filename=\"{_safe_filename(path.name)}\""},
        )

    @router.get("/{doc_id}/download")
    def download(doc_id: str, request: Request):
        user = require_user(request)
        meta = _load_meta(doc_id, user)
        path = _protected_file(doc_id) if _protected_file(doc_id).is_file() else _doc_file(doc_id)
        if not path.is_file():
            raise HTTPException(status_code=404, detail="The PDF is missing.")
        name = meta.get("name") or "document.pdf"
        return _attachment(path.read_bytes(), name if name.lower().endswith(".pdf") else name + ".pdf", "application/pdf")

    @router.post("/{doc_id}/undo")
    def undo(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        with LOCK:
            meta = _load_meta(doc_id, user)
            if not meta.get("undo"):
                raise HTTPException(status_code=400, detail="There is nothing to undo.")
            name = meta["undo"].pop()
            redo_name = f"r{int(_now() * 1000)}-{secrets.token_hex(3)}.pdf"
            redo_dir = _session_dir(doc_id) / "redo"
            redo_dir.mkdir(exist_ok=True)
            shutil.copyfile(_doc_file(doc_id), redo_dir / redo_name)
            meta.setdefault("redo", []).append(redo_name)
            shutil.copyfile(_session_dir(doc_id) / "undo" / name, _doc_file(doc_id))
            (_session_dir(doc_id) / "undo" / name).unlink(missing_ok=True)
            meta["protected"] = False
            _protected_file(doc_id).unlink(missing_ok=True)
            _save_meta(doc_id, meta)
            return JSONResponse({"info": _info(doc_id, meta)})

    @router.post("/{doc_id}/redo")
    def redo(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        with LOCK:
            meta = _load_meta(doc_id, user)
            if not meta.get("redo"):
                raise HTTPException(status_code=400, detail="There is nothing to redo.")
            name = meta["redo"].pop()
            undo_name = f"u{int(_now() * 1000)}-{secrets.token_hex(3)}.pdf"
            undo_dir = _session_dir(doc_id) / "undo"
            undo_dir.mkdir(exist_ok=True)
            shutil.copyfile(_doc_file(doc_id), undo_dir / undo_name)
            meta.setdefault("undo", []).append(undo_name)
            shutil.copyfile(_session_dir(doc_id) / "redo" / name, _doc_file(doc_id))
            (_session_dir(doc_id) / "redo" / name).unlink(missing_ok=True)
            meta["protected"] = False
            _protected_file(doc_id).unlink(missing_ok=True)
            _save_meta(doc_id, meta)
            return JSONResponse({"info": _info(doc_id, meta)})

    @router.post("/{doc_id}/text/hit")
    async def text_hit(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        _load_meta(doc_id, user)
        payload = await request.json()
        doc = _open_working(doc_id)
        try:
            page = doc[_page_index(doc, payload.get("page"))]
            hit = _text_span_hit(page, float(payload.get("x", 0)), float(payload.get("y", 0)))
            return JSONResponse({"hit": hit})
        finally:
            doc.close()

    @router.post("/{doc_id}/text/edit")
    async def text_edit(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()

        def apply(doc: pymupdf.Document):
            page = doc[_page_index(doc, payload.get("page"))]
            rect = _norm_rect(page, payload.get("rect") or {})
            _insert_editable_text(
                doc,
                page,
                rect,
                _input_text(payload.get("text")),
                font_size=float(payload.get("font_size", 11) or 11),
                color=_input_text(payload.get("color") or "#000000"),
                font_name=_input_text(payload.get("font") or "Helvetica"),
                bold=bool(payload.get("bold")),
                italic=bool(payload.get("italic")),
                align=int(payload.get("align", 0) or 0),
                background=_input_text(payload.get("background") or "#ffffff"),
            )
            return {"page": page.number + 1}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/text/add")
    async def text_add(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()

        def apply(doc: pymupdf.Document):
            page = doc[_page_index(doc, payload.get("page"))]
            rect = _norm_rect(page, payload.get("rect") or {})
            if rect.width < 8 or rect.height < 6:
                rect = pymupdf.Rect(rect.x0, rect.y0, rect.x0 + 220, rect.y0 + 60)
            _insert_editable_text(
                doc,
                page,
                rect,
                _input_text(payload.get("text")),
                font_size=float(payload.get("font_size", 14) or 14),
                color=_input_text(payload.get("color") or "#111111"),
                font_name=_input_text(payload.get("font") or "Helvetica"),
                bold=bool(payload.get("bold")),
                italic=bool(payload.get("italic")),
                align=int(payload.get("align", 0) or 0),
            )
            return {"page": page.number + 1}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/annotations")
    async def add_annotation(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        kind = _input_text(payload.get("kind") or "highlight").lower()
        color = _rgb(_input_text(payload.get("color") or "#ffd54a"), (1.0, 0.83, 0.29))
        opacity = max(0.05, min(1.0, float(payload.get("opacity", 0.45) or 0.45)))
        rects = payload.get("rects") or ([payload["rect"]] if payload.get("rect") else [])
        points = payload.get("points") or []

        def apply(doc: pymupdf.Document):
            page = doc[_page_index(doc, payload.get("page"))]
            created = []
            if kind in ("highlight", "underline", "strikeout", "squiggly"):
                for item in rects:
                    rect = _norm_rect(page, item)
                    if rect.width < 1 or rect.height < 1:
                        continue
                    if kind == "highlight":
                        annot = page.add_highlight_annot(rect)
                    elif kind == "underline":
                        annot = page.add_underline_annot(rect)
                    elif kind == "strikeout":
                        annot = page.add_strikeout_annot(rect)
                    else:
                        annot = page.add_squiggly_annot(rect)
                    annot.set_colors(stroke=color)
                    annot.set_opacity(opacity)
                    annot.update()
                    created.append(annot.xref)
            elif kind == "note":
                point = _norm_point(page, rects[0] if rects else {"x": 0.5, "y": 0.5})
                annot = page.add_text_annot(point, _input_text(payload.get("text") or "Comment"), icon="Note")
                annot.set_colors(stroke=color)
                annot.update()
                created.append(annot.xref)
            elif kind == "freetext":
                rect = _norm_rect(page, rects[0] if rects else {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.08})
                annot = page.add_freetext_annot(
                    rect,
                    _input_text(payload.get("text") or "Text"),
                    fontsize=float(payload.get("fontSize", 12) or 12),
                    fontname="helv",
                    text_color=_rgb(_input_text(payload.get("color") or "#111111")),
                    fill_color=_rgb(_input_text(payload.get("fill") or "#ffffff")),
                    border_width=float(payload.get("lineWidth", 1) or 1),
                    align=int(payload.get("align", 0) or 0),
                )
                annot.set_opacity(opacity)
                annot.update()
                created.append(annot.xref)
            elif kind == "ink":
                strokes = []
                for stroke in payload.get("strokes") or []:
                    if isinstance(stroke, list) and len(stroke) > 1:
                        strokes.append([
                            (point.x, point.y) for point in (_norm_point(page, pt) for pt in stroke)
                        ])
                if not strokes and points:
                    strokes = [[
                        (point.x, point.y) for point in (_norm_point(page, pt) for pt in points)
                    ]]
                if strokes:
                    annot = page.add_ink_annot(strokes)
                    annot.set_colors(stroke=color)
                    annot.set_opacity(opacity)
                    annot.update()
                    created.append(annot.xref)
            elif kind in ("rect", "square", "ellipse", "circle"):
                for item in rects:
                    rect = _norm_rect(page, item)
                    if rect.width < 1 or rect.height < 1:
                        continue
                    annot = page.add_rect_annot(rect) if kind in ("rect", "square") else page.add_circle_annot(rect)
                    annot.set_colors(stroke=color, fill=_rgb(_input_text(payload.get("fill") or "#ffffff")) if payload.get("filled") else None)
                    annot.set_opacity(opacity)
                    annot.update()
                    created.append(annot.xref)
            elif kind in ("line", "arrow"):
                if len(points) >= 2:
                    p1, p2 = _norm_point(page, points[0]), _norm_point(page, points[-1])
                    annot = page.add_line_annot(p1, p2)
                    annot.set_colors(stroke=color)
                    annot.set_opacity(opacity)
                    annot.set_border(width=float(payload.get("lineWidth", 2) or 2))
                    if kind == "arrow":
                        annot.set_line_ends(pymupdf.PDF_ANNOT_LE_NONE, pymupdf.PDF_ANNOT_LE_CLOSED_ARROW)
                    annot.update()
                    created.append(annot.xref)
            elif kind == "stamp":
                rect = _norm_rect(page, rects[0] if rects else {"x": 0.3, "y": 0.4, "w": 0.4, "h": 0.1})
                text = _input_text(payload.get("text") or "APPROVED").upper()
                page.draw_rect(rect, color=color, width=2.5, radius=0.02, overlay=True)
                page.insert_textbox(
                    pymupdf.Rect(rect.x0 + 4, rect.y0 + 2, rect.x1 - 4, rect.y1 - 2),
                    text,
                    fontsize=min(28, max(10, rect.height * 0.55)),
                    fontname="hebo",
                    color=color,
                    align=1,
                    overlay=True,
                )
            elif kind == "redact":
                for item in rects:
                    rect = _norm_rect(page, item)
                    page.add_redact_annot(rect, fill=(0.06, 0.08, 0.12))
                page.apply_redactions(
                    images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
                    graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                    text=pymupdf.PDF_REDACT_TEXT_REMOVE,
                )
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported annotation type: {kind}")
            return {"created": created, "page": page.number + 1}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.delete("/{doc_id}/annotations/{xref}")
    def delete_annotation(doc_id: str, xref: int, request: Request):
        user = require_user(request)
        require_csrf(request)

        def apply(doc: pymupdf.Document):
            for page in doc:
                for annot in page.annots() or []:
                    if annot.xref == xref:
                        page.delete_annot(annot)
                        return {"deleted": xref}
            raise HTTPException(status_code=404, detail="Annotation not found.")

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/image")
    async def add_image(
        doc_id: str,
        request: Request,
        page: int = Form(...),
        x: float = Form(0.1),
        y: float = Form(0.1),
        w: float = Form(0.3),
        h: float = Form(0.2),
        opacity: float = Form(1.0),
        file: UploadFile = File(...),
    ):
        user = require_user(request)
        require_csrf(request)
        data = _read_upload(file)

        def apply(doc: pymupdf.Document):
            pg = doc[_page_index(doc, page)]
            rect = _norm_rect(pg, {"x": x, "y": y, "w": w, "h": h})
            try:
                pg.insert_image(rect, stream=data, keep_proportion=True, overlay=True)
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"That image could not be placed: {exc}")
            return {"page": pg.number + 1}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.get("/{doc_id}/images")
    def images(doc_id: str, request: Request):
        user = require_user(request)
        _load_meta(doc_id, user)
        doc = _open_working(doc_id)
        result = []
        try:
            seen = set()
            for i, page in enumerate(doc):
                for info in page.get_image_info(xrefs=True):
                    xref = info.get("xref", 0)
                    if not xref or xref in seen:
                        continue
                    seen.add(xref)
                    result.append(
                        {
                            "xref": xref,
                            "page": i + 1,
                            "rect": _display_rect(page, info.get("bbox")),
                            "width": info.get("width"),
                            "height": info.get("height"),
                            "ext": info.get("ext"),
                        }
                    )
        finally:
            doc.close()
        return JSONResponse({"images": result})

    @router.get("/{doc_id}/images/{xref}")
    def image_bytes(doc_id: str, xref: int, request: Request):
        user = require_user(request)
        _load_meta(doc_id, user)
        doc = _open_working(doc_id)
        try:
            data = doc.extract_image(xref)
            if not data or not data.get("image"):
                raise HTTPException(status_code=404, detail="Image not found.")
            media = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}.get(
                str(data.get("ext", "")).lower(), "application/octet-stream"
            )
            return Response(content=data["image"], media_type=media)
        finally:
            doc.close()

    @router.post("/{doc_id}/image/replace")
    async def replace_image(
        doc_id: str,
        request: Request,
        page: int = Form(...),
        xref: int = Form(...),
        file: UploadFile = File(...),
    ):
        user = require_user(request)
        require_csrf(request)
        data = _read_upload(file)

        def apply(doc: pymupdf.Document):
            pg = doc[_page_index(doc, page)]
            target = None
            for info in pg.get_image_info(xrefs=True):
                if info.get("xref") == xref:
                    target = info
                    break
            if not target:
                raise HTTPException(status_code=404, detail="The image was not found on that page.")
            rect = pymupdf.Rect(target.get("bbox"))
            pg.add_redact_annot(rect, fill=(1, 1, 1))
            pg.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
                graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                text=pymupdf.PDF_REDACT_TEXT_NONE,
            )
            pg.insert_image(rect, stream=data, keep_proportion=True, overlay=True)
            return {"page": pg.number + 1}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/image/delete")
    async def delete_image(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()

        def apply(doc: pymupdf.Document):
            pg = doc[_page_index(doc, payload.get("page"))]
            xref = int(payload.get("xref") or 0)
            target = None
            for info in pg.get_image_info(xrefs=True):
                if info.get("xref") == xref:
                    target = info
                    break
            if not target:
                raise HTTPException(status_code=404, detail="The image was not found on that page.")
            rect = pymupdf.Rect(target.get("bbox"))
            pg.add_redact_annot(rect, fill=(1, 1, 1))
            pg.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
                graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                text=pymupdf.PDF_REDACT_TEXT_NONE,
            )
            return {"deleted": xref}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    # ------------------------------------------------------------------
    # Page organisation
    # ------------------------------------------------------------------

    @router.post("/{doc_id}/page/rotate")
    async def rotate_pages(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        angle = int(payload.get("angle", 90) or 90)

        def apply(doc: pymupdf.Document):
            for number in payload.get("pages") or []:
                page = doc[_page_index(doc, number)]
                page.set_rotation((page.rotation + angle) % 360)
            return {"angle": angle}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/page/delete")
    async def delete_pages(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()

        def apply(doc: pymupdf.Document):
            pages = sorted({_page_index(doc, n) for n in payload.get("pages") or []}, reverse=True)
            if len(pages) >= doc.page_count:
                raise HTTPException(status_code=400, detail="A PDF needs at least one page.")
            for index in pages:
                doc.delete_page(index)
            return {"deleted": len(pages)}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/page/move")
    async def move_page(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()

        def apply(doc: pymupdf.Document):
            source = _page_index(doc, payload.get("from"))
            target = max(0, min(doc.page_count - 1, int(payload.get("to", source + 1)) - 1))
            doc.move_page(source, target)
            return {"from": source + 1, "to": target + 1}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/page/duplicate")
    async def duplicate_page(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()

        def apply(doc: pymupdf.Document):
            index = _page_index(doc, payload.get("page"))
            doc.copy_page(index, index + 1)
            return {"page": index + 2}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/page/insert")
    async def insert_blank(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()

        def apply(doc: pymupdf.Document):
            after = int(payload.get("after", 0) or 0)
            after = max(0, min(doc.page_count, after))
            width = float(payload.get("width", 595) or 595)
            height = float(payload.get("height", 842) or 842)
            doc.new_page(after, width=width, height=height)
            return {"after": after}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/page/crop")
    async def crop_page(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()

        def apply(doc: pymupdf.Document):
            pages = payload.get("pages")
            if pages == "all":
                pages = list(range(1, doc.page_count + 1))
            else:
                pages = pages or [payload.get("page")]
            rect = payload.get("rect") or {"x": 0.05, "y": 0.05, "w": 0.9, "h": 0.9}
            count = 0
            for number in pages:
                page = doc[_page_index(doc, number)]
                page.set_cropbox(_norm_rect(page, rect))
                count += 1
            return {"cropped": count}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/page/extract")
    async def extract_pages(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        meta = _load_meta(doc_id, user)
        payload = await request.json()
        source = _open_working(doc_id)
        indexes = sorted({_page_index(source, n) for n in payload.get("pages") or []})
        try:
            out = pymupdf.open()
            for index in indexes:
                out.insert_pdf(source, from_page=index, to_page=index)
            if out.page_count == 0:
                out.close()
                raise HTTPException(status_code=400, detail="Select at least one page to extract.")
            data = out.tobytes(garbage=3, deflate=True)
            out.close()
        finally:
            source.close()
        new_meta = _new_session(user.get("id"), f"{Path(meta['name']).stem}-extract.pdf", data)
        return JSONResponse({"info": _info(new_meta["id"], new_meta)})

    @router.post("/{doc_id}/split")
    async def split(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        spec = _input_text(payload.get("ranges") or "1")
        source = _open_working(doc_id)
        meta = _load_meta(doc_id, user)
        try:
            ranges: list[tuple[int, int]] = []
            for chunk in re.split(r"[,\s]+", spec):
                if not chunk:
                    continue
                if "-" in chunk:
                    a, b = chunk.split("-", 1)
                    start, end = int(a), int(b)
                else:
                    start = end = int(chunk)
                start = max(1, start)
                end = min(source.page_count, end)
                if start > end:
                    continue
                ranges.append((start, end))
            if not ranges:
                raise HTTPException(status_code=400, detail="Enter a page range such as 1-3,5.")
            created = []
            for i, (start, end) in enumerate(ranges, 1):
                out = pymupdf.open()
                out.insert_pdf(source, from_page=start - 1, to_page=end - 1)
                data = out.tobytes(garbage=3, deflate=True)
                out.close()
                new_meta = _new_session(
                    user.get("id"),
                    f"{Path(meta['name']).stem}-part-{i}.pdf",
                    data,
                )
                created.append(_info(new_meta["id"], new_meta))
            return JSONResponse({"documents": created})
        finally:
            source.close()

    @router.post("/{doc_id}/merge")
    async def merge(doc_id: str, request: Request, files: list[UploadFile] = File(...)):
        user = require_user(request)
        require_csrf(request)
        payloads = [_read_upload(item) for item in files]

        def apply(doc: pymupdf.Document):
            added = 0
            for data in payloads:
                try:
                    other = pymupdf.open(stream=data, filetype="pdf")
                    if other.needs_pass:
                        other.close()
                        raise HTTPException(status_code=400, detail="One of the PDFs is password protected.")
                    doc.insert_pdf(other)
                    added += other.page_count
                    other.close()
                except HTTPException:
                    raise
                except Exception:
                    raise HTTPException(status_code=400, detail="One of the uploaded files isn't a valid PDF.")
            return {"pages_added": added}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    # ------------------------------------------------------------------
    # Document tools
    # ------------------------------------------------------------------

    @router.post("/{doc_id}/compress")
    async def compress(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        level = _input_text(payload.get("level") or "balanced")
        before = _doc_file(doc_id).stat().st_size

        def apply(doc: pymupdf.Document):
            try:
                if level == "strong":
                    doc.rewrite_images(dpi_threshold=120, dpi_target=96, quality=45)
                elif level == "light":
                    doc.rewrite_images(dpi_threshold=300, dpi_target=200, quality=82)
                else:
                    doc.rewrite_images(dpi_threshold=200, dpi_target=140, quality=68)
            except Exception:
                pass
            return {}

        meta, _ = _mutate(doc_id, user, apply)
        after = _doc_file(doc_id).stat().st_size
        return JSONResponse(
            {
                "info": _info(doc_id, meta),
                "result": {
                    "before": before,
                    "after": after,
                    "saved": max(0, before - after),
                    "percent": round(max(0, (before - after) / before * 100), 1) if before else 0,
                },
            }
        )

    @router.post("/{doc_id}/protect")
    async def protect(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        password = _input_text(payload.get("password"))
        if len(password) < 4:
            raise HTTPException(status_code=400, detail="Use a password with at least four characters.")
        meta = _load_meta(doc_id, user)
        doc = _open_working(doc_id)
        permissions = pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_ACCESSIBILITY
        if payload.get("allow_copy", True):
            permissions |= pymupdf.PDF_PERM_COPY
        if payload.get("allow_modify", False):
            permissions |= pymupdf.PDF_PERM_MODIFY
        if payload.get("allow_annotate", True):
            permissions |= pymupdf.PDF_PERM_ANNOTATE
        if payload.get("allow_forms", True):
            permissions |= pymupdf.PDF_PERM_FORM
        if payload.get("allow_assemble", False):
            permissions |= pymupdf.PDF_PERM_ASSEMBLE
        owner = _input_text(payload.get("owner_password")) or secrets.token_urlsafe(24)
        target = _protected_file(doc_id)
        try:
            doc.save(
                str(target),
                encryption=pymupdf.PDF_ENCRYPT_AES_256,
                owner_pw=owner,
                user_pw=password,
                permissions=permissions,
            )
            doc.close()
        except Exception as exc:
            try:
                doc.close()
            except Exception:
                pass
            target.unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail=f"Protection failed: {exc}")
        meta["protected"] = True
        _save_meta(doc_id, meta)
        return JSONResponse({"info": _info(doc_id, meta), "result": {"protected": True}})

    @router.post("/{doc_id}/unlock")
    def unlock(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        meta = _load_meta(doc_id, user)
        _protected_file(doc_id).unlink(missing_ok=True)
        meta["protected"] = False
        _save_meta(doc_id, meta)
        return JSONResponse({"info": _info(doc_id, meta), "result": {"protected": False}})

    @router.post("/{doc_id}/watermark")
    async def watermark(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        text = _input_text(payload.get("text") or "DRAFT")
        size = float(payload.get("size", 54) or 54)
        angle = float(payload.get("angle", 45) or 0)
        opacity = max(0.02, min(1.0, float(payload.get("opacity", 0.16) or 0.16)))
        color = _rgb(_input_text(payload.get("color") or "#f84f63"), (0.97, 0.31, 0.39))
        tiled = bool(payload.get("tiled"))
        pages = payload.get("pages") or "all"

        def apply(doc: pymupdf.Document):
            targets = range(doc.page_count) if pages == "all" else [_page_index(doc, n) for n in pages]
            for index in targets:
                page = doc[index]
                width, height = page.rect.width, page.rect.height
                positions = []
                if tiled:
                    for px in range(0, int(width) + 200, 260):
                        for py in range(0, int(height) + 120, 160):
                            positions.append((px, py))
                else:
                    positions = [((width - pymupdf.get_text_length(text, fontname="hebo", fontsize=size)) / 2, height / 2)]
                for px, py in positions:
                    anchor = pymupdf.Point(width / 2, height / 2) if not tiled else pymupdf.Point(px, py)
                    morph = (anchor, pymupdf.Matrix(angle)) if angle % 360 else None
                    page.insert_text(
                        (px, py),
                        text,
                        fontsize=size,
                        fontname="hebo",
                        color=color,
                        morph=morph,
                        fill_opacity=opacity,
                        overlay=True,
                    )
            return {"pages": doc.page_count}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/page-numbers")
    async def page_numbers(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        template = _input_text(payload.get("format") or "Page {page} of {total}")
        position = _input_text(payload.get("position") or "bottom-center")
        size = float(payload.get("size", 9) or 9)
        margin = float(payload.get("margin", 24) or 24)
        color = _rgb(_input_text(payload.get("color") or "#4b5563"), (0.29, 0.33, 0.39))
        start = int(payload.get("start", 1) or 1)

        def apply(doc: pymupdf.Document):
            total = doc.page_count
            for i, page in enumerate(doc):
                number = start + i
                text = template.replace("{page}", str(number)).replace("{total}", str(total + start - 1))
                width, height = page.rect.width, page.rect.height
                text_width = pymupdf.get_text_length(text, fontname="helv", fontsize=size)
                if position.endswith("left"):
                    x = margin
                elif position.endswith("right"):
                    x = width - margin - text_width
                else:
                    x = (width - text_width) / 2
                if position.startswith("top"):
                    y = margin + size
                else:
                    y = height - margin
                page.insert_text((x, y), text, fontsize=size, fontname="helv", color=color, overlay=True)
            return {"pages": total}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/header-footer")
    async def header_footer(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        header = _input_text(payload.get("header"))
        footer = _input_text(payload.get("footer"))
        size = float(payload.get("size", 8.5) or 8.5)
        margin = float(payload.get("margin", 26) or 26)
        color = _rgb(_input_text(payload.get("color") or "#4b5563"), (0.29, 0.33, 0.39))

        def apply(doc: pymupdf.Document):
            total = doc.page_count
            for i, page in enumerate(doc):
                width, height = page.rect.width, page.rect.height
                values = {
                    "{page}": str(i + 1),
                    "{total}": str(total),
                }
                for source, y, top in ((header, margin, True), (footer, height - margin, False)):
                    if not source:
                        continue
                    text = source
                    for key, value in values.items():
                        text = text.replace(key, value)
                    page.insert_textbox(
                        pymupdf.Rect(margin, y - size if top else y, width - margin, y + size * 2 if top else y + size * 2),
                        text,
                        fontsize=size,
                        fontname="helv",
                        color=color,
                        align=1,
                        overlay=True,
                    )
            return {"pages": total}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/redact")
    async def redact(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        query = _input_text(payload.get("query"))

        def apply(doc: pymupdf.Document):
            count = 0
            raw_pages = payload.get("pages")
            if raw_pages == "all":
                targets = list(range(1, doc.page_count + 1))
            else:
                targets = raw_pages or [payload.get("page")]
            for number in targets:
                page = doc[_page_index(doc, number)]
                if query:
                    hits = page.search_for(query)
                    for rect in hits:
                        page.add_redact_annot(rect, fill=(0.06, 0.08, 0.12))
                        count += 1
                for item in payload.get("rects") or []:
                    page.add_redact_annot(_norm_rect(page, item), fill=(0.06, 0.08, 0.12))
                    count += 1
                page.apply_redactions(
                    images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
                    graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                    text=pymupdf.PDF_REDACT_TEXT_REMOVE,
                )
            return {"redactions": count}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/metadata")
    async def set_metadata(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        allowed = ("title", "author", "subject", "keywords", "creator", "producer")

        def apply(doc: pymupdf.Document):
            values = {key: _input_text(payload.get(key)) for key in allowed}
            doc.set_metadata(values)
            return {"metadata": values}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/forms/fill")
    async def fill_forms(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        values = payload.get("values") or {}

        def apply(doc: pymupdf.Document):
            filled = 0
            for page in doc:
                for widget in page.widgets() or []:
                    name = widget.field_name or ""
                    if name not in values:
                        continue
                    value = values[name]
                    try:
                        kind = int(getattr(widget, "field_type", 0) or 0)
                        if kind in (pymupdf.PDF_WIDGET_TYPE_CHECKBOX, pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON):
                            widget.field_value = bool(value) if not isinstance(value, str) else value.lower() in ("1", "true", "yes", "on", "checked")
                        else:
                            widget.field_value = _input_text(value)
                        widget.update()
                        filled += 1
                    except Exception:
                        continue
            return {"filled": filled}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    @router.post("/{doc_id}/forms/flatten")
    def flatten(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)

        def apply(doc: pymupdf.Document):
            doc.bake(annots=True, widgets=True)
            return {"flattened": True}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse({"info": _info(doc_id, meta), "result": result})

    # ------------------------------------------------------------------
    # OCR, search and analysis
    # ------------------------------------------------------------------

    @router.get("/{doc_id}/ocr/languages")
    def ocr_languages(doc_id: str, request: Request):
        user = require_user(request)
        _load_meta(doc_id, user)
        candidates = [
            Path(os.getenv("TESSDATA_PREFIX", "")),
            Path(os.getenv("LOCALAPPDATA", "")) / "Tesseract-OCR" / "tessdata",
            Path(r"C:\Program Files\Tesseract-OCR\tessdata"),
        ]
        languages = []
        for directory in candidates:
            if directory and directory.is_dir():
                languages = sorted([item.stem for item in directory.glob("*.traineddata")])
                if languages:
                    break
        if not languages:
            languages = ["eng"]
        return JSONResponse({"languages": languages, "available": _tesseract_command() is not None})

    @router.post("/{doc_id}/ocr")
    async def ocr(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        language = _input_text(payload.get("language") or "eng")
        pages = payload.get("pages") or "all"
        command = _tesseract_command()
        if not command:
            raise HTTPException(
                status_code=503,
                detail="Tesseract OCR is not installed. Install Tesseract or add its folder to PATH.",
            )
        text_out = []

        def apply(doc: pymupdf.Document):
            targets = range(doc.page_count) if pages == "all" else [_page_index(doc, n) for n in pages]
            for index in targets:
                page = doc[index]
                if page.get_text("text").strip() and not payload.get("force"):
                    text_out.append({"page": index + 1, "text": page.get_text("text"), "skipped": True})
                    continue
                pix = page.get_pixmap(dpi=220, alpha=False)
                image = Image.open(io.BytesIO(pix.tobytes("png")))
                try:
                    import pytesseract

                    pytesseract.pytesseract.tesseract_cmd = command
                    data = pytesseract.image_to_data(
                        image, lang=language, output_type=pytesseract.Output.DICT
                    )
                except Exception as exc:
                    raise HTTPException(status_code=500, detail=f"OCR failed on page {index + 1}: {exc}")
                page_text = []
                sx = page.rect.width / max(1, pix.width)
                sy = page.rect.height / max(1, pix.height)
                for i, word in enumerate(data.get("text", [])):
                    word = (word or "").strip()
                    if not word:
                        continue
                    try:
                        confidence = float(data["conf"][i])
                    except Exception:
                        confidence = 0
                    if confidence < 25:
                        continue
                    left, top = data["left"][i], data["top"][i]
                    width, height = data["width"][i], data["height"][i]
                    x = left * sx
                    y = top * sy
                    w = max(2, width * sx)
                    h = max(2, height * sy)
                    font_size = max(4, min(72, h * 0.82))
                    point = pymupdf.Point(x, y + h * 0.82)
                    if page.rotation:
                        point = point * page.derotation_matrix
                    page.insert_text(
                        point,
                        word,
                        fontsize=font_size,
                        fontname="helv",
                        render_mode=3,
                        color=(0, 0, 0),
                        overlay=True,
                    )
                    page_text.append(word)
                text_out.append({"page": index + 1, "text": " ".join(page_text), "skipped": False})
            return {"pages": len(text_out)}

        meta, result = _mutate(doc_id, user, apply)
        return JSONResponse(
            {
                "info": _info(doc_id, meta),
                "result": {"pages": result.get("pages", 0), "language": language, "text": text_out},
            }
        )

    @router.get("/{doc_id}/search")
    def search(doc_id: str, request: Request, q: str = ""):
        user = require_user(request)
        _load_meta(doc_id, user)
        query = str(q or "").strip()
        if len(query) < 2:
            return JSONResponse({"results": []})
        doc = _open_working(doc_id)
        results = []
        try:
            for i, page in enumerate(doc):
                try:
                    hits = page.search_for(query)[:40]
                except Exception:
                    hits = []
                for rect in hits:
                    results.append(
                        {
                            "page": i + 1,
                            "rect": _display_rect(page, rect),
                            "snippet": page.get_textbox(rect).strip()[:180] or query,
                        }
                    )
                if len(results) >= 250:
                    break
        finally:
            doc.close()
        return JSONResponse({"results": results})

    @router.get("/{doc_id}/text")
    def full_text(doc_id: str, request: Request):
        user = require_user(request)
        _load_meta(doc_id, user)
        doc = _open_working(doc_id)
        try:
            pages = [{"page": i + 1, "text": page.get_text("text")} for i, page in enumerate(doc)]
        finally:
            doc.close()
        return JSONResponse({"pages": pages})

    @router.post("/{doc_id}/assistant")
    async def assistant(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        _load_meta(doc_id, user)
        payload = await request.json()
        question = _input_text(payload.get("question")).strip()
        if not question:
            raise HTTPException(status_code=400, detail="Ask a question about the document.")
        doc = _open_working(doc_id)
        try:
            sentences = []
            for i, page in enumerate(doc):
                text = re.sub(r"\s+", " ", page.get_text("text") or "").strip()
                for sentence in re.split(r"(?<=[.!?])\s+", text):
                    sentence = sentence.strip()
                    if len(sentence) >= 20:
                        sentences.append((i + 1, sentence))
            if not sentences:
                return JSONResponse(
                    {
                        "answer": "This document has no selectable text. Run OCR from Tools first, then ask again.",
                        "citations": [],
                    }
                )
            q = _tokens(question)
            if not q:
                raise HTTPException(status_code=400, detail="Use a more specific question.")
            scored = []
            for page, sentence in sentences:
                s = _tokens(sentence)
                overlap = len(q & s) / max(1, len(q))
                phrase = 0.6 if question.lower() in sentence.lower() else 0.0
                scored.append((overlap + phrase, page, sentence))
            scored.sort(key=lambda item: item[0], reverse=True)
            top = [item for item in scored[:5] if item[0] > 0]
            if not top:
                answer = (
                    "I couldn't find a matching passage in the extracted text. Try different words, "
                    "or run OCR if this is a scanned document."
                )
                citations = []
            else:
                citations = [{"page": page, "snippet": sentence} for _, page, sentence in top[:4]]
                answer = (
                    "Here is what the document says, based on the closest matching passages:\n\n"
                    + "\n\n".join(f"p.{page}: {sentence}" for _, page, sentence in top[:3])
                )
            return JSONResponse({"answer": answer, "citations": citations})
        finally:
            doc.close()

    @router.post("/{doc_id}/compare")
    async def compare(doc_id: str, request: Request, file: UploadFile = File(...)):
        user = require_user(request)
        require_csrf(request)
        _load_meta(doc_id, user)
        data = _read_upload(file)
        left = _open_working(doc_id)
        try:
            right = pymupdf.open(stream=data, filetype="pdf")
            if right.needs_pass:
                right.close()
                raise HTTPException(status_code=400, detail="The comparison PDF is password protected.")
            changes = []
            added = removed = changed = 0
            for index in range(min(left.page_count, right.page_count)):
                a = [line.strip() for line in left[index].get_text("text").splitlines() if line.strip()]
                b = [line.strip() for line in right[index].get_text("text").splitlines() if line.strip()]
                matcher = difflib.SequenceMatcher(a=a, b=b)
                for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                    if tag == "equal":
                        continue
                    if tag in ("replace", "delete"):
                        for line in a[i1:i2]:
                            removed += 1
                            if len(changes) < 150:
                                changes.append({"page": index + 1, "type": "removed", "text": line[:500]})
                    if tag in ("replace", "insert"):
                        for line in b[j1:j2]:
                            added += 1
                            if len(changes) < 150:
                                changes.append({"page": index + 1, "type": "added", "text": line[:500]})
                    if tag == "replace":
                        changed += 1
            page_delta = right.page_count - left.page_count
            right_pages = right.page_count
            left_pages = left.page_count
            right.close()
            return JSONResponse(
                {
                    "summary": {
                        "added_lines": added,
                        "removed_lines": removed,
                        "changed_blocks": changed,
                        "page_delta": page_delta,
                        "left_pages": left_pages,
                        "right_pages": right_pages,
                    },
                    "changes": changes,
                }
            )
        finally:
            left.close()

    # ------------------------------------------------------------------
    # Export and sharing
    # ------------------------------------------------------------------

    @router.get("/{doc_id}/export")
    def export(doc_id: str, request: Request, format: str = "txt"):
        user = require_user(request)
        meta = _load_meta(doc_id, user)
        fmt = (format or "txt").lower()
        stem = Path(meta.get("name") or "document").stem
        path = _protected_file(doc_id) if _protected_file(doc_id).is_file() else _doc_file(doc_id)
        if fmt == "pdf":
            return _attachment(path.read_bytes(), stem + ".pdf", "application/pdf")

        doc = _open_working(doc_id)
        try:
            if fmt in ("png", "jpeg", "jpg"):
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
                    for i, page in enumerate(doc):
                        pix = page.get_pixmap(dpi=150, alpha=False)
                        ext = "jpg" if fmt in ("jpg", "jpeg") else "png"
                        data = pix.tobytes(ext)
                        archive.writestr(f"{stem}-page-{i + 1:03d}.{ext}", data)
                return _attachment(buffer.getvalue(), f"{stem}-images.zip", "application/zip")
            if fmt == "txt":
                text = "\n\n".join(
                    f"--- Page {i + 1} ---\n{page.get_text('text')}" for i, page in enumerate(doc)
                )
                return _attachment(text.encode("utf-8"), stem + ".txt", "text/plain; charset=utf-8")
            if fmt == "html":
                fragments = []
                for i, page in enumerate(doc):
                    fragments.append(f"<section class=\"pdf-page\" id=\"page-{i + 1}\">{page.get_text('html')}</section>")
                html = (
                    "<!doctype html><html><head><meta charset=\"utf-8\"><title>"
                    + _escape_html(stem)
                    + "</title><style>body{background:#e9edf2;font-family:Arial,sans-serif;margin:0}"
                    ".pdf-page{background:#fff;max-width:820px;margin:24px auto;padding:24px;box-shadow:0 4px 20px #0002;position:relative}"
                    ".pdf-page p{position:absolute;margin:0;white-space:pre-wrap}</style></head><body>"
                    + "".join(fragments)
                    + "</body></html>"
                )
                return _attachment(html.encode("utf-8"), stem + ".html", "text/html; charset=utf-8")
            if fmt == "docx":
                if DocxDocument is None:
                    raise HTTPException(status_code=503, detail="Word export is unavailable.")
                document = DocxDocument()
                for i, page in enumerate(doc):
                    if i:
                        document.add_page_break()
                    for block in page.get_text("blocks"):
                        text = str(block[4] or "").strip()
                        if not text:
                            continue
                        paragraph = document.add_paragraph(text)
                        for run in paragraph.runs:
                            run.font.size = Pt(10)
                buffer = io.BytesIO()
                document.save(buffer)
                return _attachment(
                    buffer.getvalue(),
                    stem + ".docx",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            if fmt in ("xlsx", "excel"):
                if openpyxl is None:
                    raise HTTPException(status_code=503, detail="Excel export is unavailable.")
                workbook = openpyxl.Workbook()
                workbook.remove(workbook.active)
                for i, page in enumerate(doc):
                    sheet = workbook.create_sheet(f"Page {i + 1}")
                    row = 1
                    found = False
                    try:
                        for table in page.find_tables().tables:
                            found = True
                            for values in table.extract():
                                for col, value in enumerate(values, 1):
                                    sheet.cell(row=row, column=col, value=value)
                                row += 1
                            row += 1
                    except Exception:
                        pass
                    if not found:
                        for line in page.get_text("text").splitlines():
                            sheet.cell(row=row, column=1, value=line)
                            row += 1
                buffer = io.BytesIO()
                workbook.save(buffer)
                return _attachment(
                    buffer.getvalue(),
                    stem + ".xlsx",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            if fmt in ("pptx", "powerpoint"):
                if Presentation is None or Inches is None:
                    raise HTTPException(status_code=503, detail="PowerPoint export is unavailable.")
                prs = Presentation()
                first = doc[0]
                prs.slide_width = Inches(first.rect.width / 72)
                prs.slide_height = Inches(first.rect.height / 72)
                blank = prs.slide_layouts[6]
                for page in doc:
                    slide = prs.slides.add_slide(blank)
                    pix = page.get_pixmap(dpi=144, alpha=False)
                    image = Image.open(io.BytesIO(pix.tobytes("png")))
                    buffer = io.BytesIO()
                    image.save(buffer, format="PNG")
                    slide.shapes.add_picture(
                        io.BytesIO(buffer.getvalue()),
                        0,
                        0,
                        width=prs.slide_width,
                        height=prs.slide_height,
                    )
                buffer = io.BytesIO()
                prs.save(buffer)
                return _attachment(
                    buffer.getvalue(),
                    stem + ".pptx",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                )
        finally:
            doc.close()
        raise HTTPException(status_code=400, detail="Choose txt, docx, xlsx, pptx, png, jpeg, html or pdf.")

    @router.post("/{doc_id}/share")
    async def share(doc_id: str, request: Request):
        user = require_user(request)
        require_csrf(request)
        payload = await request.json()
        meta = _load_meta(doc_id, user)
        token = secrets.token_urlsafe(24)
        expires = _now() + max(1, min(30, int(payload.get("days", 7) or 7))) * 86400
        meta.setdefault("shares", []).append({"token": token, "expires": expires, "created": _now()})
        _save_meta(doc_id, meta)
        return JSONResponse(
            {
                "token": token,
                "expires": expires,
                "url": f"/api/pdf/shared/{token}",
            }
        )

    @router.get("/shared/{token}")
    def shared(token: str):
        if not token or len(token) < 16:
            raise HTTPException(status_code=404, detail="Share link not found.")
        for entry in ROOT.iterdir():
            if not entry.is_dir():
                continue
            meta_path = entry / "meta.json"
            if not meta_path.is_file():
                continue
            try:
                meta = json.loads(meta_path.read_text("utf-8"))
            except Exception:
                continue
            for share_entry in meta.get("shares", []):
                if secrets.compare_digest(str(share_entry.get("token")), token):
                    if float(share_entry.get("expires", 0)) < _now():
                        raise HTTPException(status_code=410, detail="This share link has expired.")
                    path = entry / ("protected.pdf" if (entry / "protected.pdf").is_file() else "doc.pdf")
                    if not path.is_file():
                        raise HTTPException(status_code=404, detail="The shared PDF is missing.")
                    return _attachment(path.read_bytes(), meta.get("name", "document.pdf"), "application/pdf")
        raise HTTPException(status_code=404, detail="Share link not found.")

    return router


# ---------------------------------------------------------------------------
# OCR / office conversion helpers used by create and OCR routes
# ---------------------------------------------------------------------------


def _tesseract_command() -> str | None:
    configured = os.getenv("TESSERACT_CMD", "").strip()
    candidates = [
        configured,
        shutil.which("tesseract") or "",
        str(Path(os.getenv("LOCALAPPDATA", "")) / "Tesseract-OCR" / "tesseract.exe"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def _escape_html(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _tokens(value: str) -> set[str]:
    stop = {
        "the", "and", "for", "with", "that", "this", "from", "what", "when", "where", "which",
        "have", "has", "are", "was", "were", "will", "would", "can", "could", "should", "into",
        "document", "pdf", "page", "about", "does", "did", "how", "why", "who", "its", "their",
    }
    return {word for word in re.findall(r"[a-z0-9]{3,}", str(value).lower()) if word not in stop}


def create_pdf_from_files(owner_id, files: list[tuple[str, bytes]], password: str = "") -> dict:
    """Create a PDF from images, text/markdown, PDFs or Office documents."""
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one file.")

    pdf_payloads: list[bytes] = []
    images: list[tuple[str, bytes]] = []
    office_files: list[tuple[str, bytes]] = []
    text_files: list[tuple[str, bytes]] = []

    for name, data in files:
        suffix = Path(name).suffix.lower()
        if suffix == ".pdf":
            try:
                test = pymupdf.open(stream=data, filetype="pdf")
                if test.needs_pass:
                    test.close()
                    raise HTTPException(status_code=400, detail=f"{name} is password protected.")
                test.close()
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=400, detail=f"{name} isn't a valid PDF.")
            pdf_payloads.append(data)
        elif suffix in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"):
            images.append((name, data))
        elif suffix in (".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"):
            office_files.append((name, data))
        elif suffix in (".txt", ".md", ".csv", ".log"):
            text_files.append((name, data))
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {suffix or 'unknown'}. Use PDF, images, Word, Excel, PowerPoint, TXT or Markdown.",
            )

    for name, data in office_files:
        converted = _office_to_pdf(name, data)
        pdf_payloads.append(converted)

    out = pymupdf.open()
    for data in pdf_payloads:
        source = pymupdf.open(stream=data, filetype="pdf")
        out.insert_pdf(source)
        source.close()

    for name, data in images:
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            page = out.new_page(width=595, height=842)
            max_w, max_h = 511, 758
            scale = min(max_w / image.width, max_h / image.height, 1.0)
            width, height = image.width * scale, image.height * scale
            rect = pymupdf.Rect(
                (595 - width) / 2,
                (842 - height) / 2,
                (595 + width) / 2,
                (842 + height) / 2,
            )
            page.insert_image(rect, stream=data, keep_proportion=True)
        except Exception:
            raise HTTPException(status_code=400, detail=f"{name} could not be read as an image.")

    for name, data in text_files:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("latin-1", errors="replace")
        _add_text_pages(out, text, name)

    if out.page_count == 0:
        out.close()
        raise HTTPException(status_code=400, detail="The selected files produced no PDF pages.")
    payload = out.tobytes(garbage=3, deflate=True)
    out.close()
    meta = _new_session(owner_id, "Created document.pdf", payload)
    return _info(meta["id"], meta)


def _add_text_pages(doc: pymupdf.Document, text: str, name: str) -> None:
    import textwrap

    lines: list[str] = []
    for raw in text.splitlines() or [""]:
        wrapped = textwrap.wrap(raw, width=94, break_long_words=True, replace_whitespace=False) or [""]
        lines.extend(wrapped)
    per_page = 48
    for start in range(0, max(1, len(lines)), per_page):
        page = doc.new_page(width=595, height=842)
        chunk = lines[start : start + per_page]
        y = 58
        for line in chunk:
            page.insert_text((56, y), line, fontsize=10.5, fontname="helv", color=(0.08, 0.12, 0.16))
            y += 15
        if start == 0:
            page.insert_text((56, 34), Path(name).name, fontsize=8, fontname="helv", color=(0.55, 0.58, 0.62))


def _office_to_pdf(name: str, data: bytes) -> bytes:
    suffix = Path(name).suffix.lower()
    if shutil.which("libreoffice") or shutil.which("soffice"):
        executable = shutil.which("libreoffice") or shutil.which("soffice")
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / _clean_name(name)
            source.write_bytes(data)
            subprocess.run(
                [executable, "--headless", "--convert-to", "pdf", "--outdir", work, str(source)],
                check=True,
                capture_output=True,
                timeout=120,
            )
            target = source.with_suffix(".pdf")
            if target.is_file():
                return target.read_bytes()
    if os.name != "nt":
        raise HTTPException(status_code=503, detail="Office conversion needs Microsoft Office or LibreOffice.")
    # Use the installed Microsoft Office automation as a local converter.
    work = Path(tempfile.mkdtemp(prefix="rg-office-"))
    source = work / _clean_name(name)
    source.write_bytes(data)
    target = source.with_suffix(".pdf")
    try:
        if suffix in (".docx", ".doc"):
            app, method = "Word.Application", "word"
        elif suffix in (".xlsx", ".xls"):
            app, method = "Excel.Application", "excel"
        else:
            app, method = "PowerPoint.Application", "powerpoint"
        script = work / "convert.ps1"
        if method == "word":
            body = (
                f"$app = New-Object -ComObject {app}; $app.Visible = $false; $app.DisplayAlerts = 0; "
                f"$doc = $app.Documents.Open('{_ps_quote(source)}', $false, $true); "
                f"$doc.ExportAsFixedFormat('{_ps_quote(target)}', 17); "
                f"$doc.Close($false); $app.Quit()"
            )
        elif method == "excel":
            body = (
                f"$app = New-Object -ComObject {app}; $app.Visible = $false; $app.DisplayAlerts = $false; "
                f"$wb = $app.Workbooks.Open('{_ps_quote(source)}', 0, $true); "
                f"$wb.ExportAsFixedFormat(0, '{_ps_quote(target)}'); "
                f"$wb.Close($false); $app.Quit()"
            )
        else:
            body = (
                f"$app = New-Object -ComObject {app}; $app.Visible = $true; "
                f"$pres = $app.Presentations.Open('{_ps_quote(source)}', $true, $false, $false); "
                f"$pres.SaveAs('{_ps_quote(target)}', 32); $pres.Close(); $app.Quit()"
            )
        script.write_text(body, encoding="utf-8-sig")
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if not target.is_file() or target.stat().st_size == 0:
            detail = (result.stderr or result.stdout or "Office conversion failed.").strip()[:400]
            raise HTTPException(status_code=503, detail=f"Office conversion failed: {detail}")
        return target.read_bytes()
    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Office conversion timed out.")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Office conversion is unavailable: {exc}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _ps_quote(path: Path) -> str:
    return str(path).replace("'", "''")
