"""CSA trailer certification report engine - reproduces the v2 template layout (US Letter)."""
import io, os, re, json, functools
from xml.sax.saxutils import escape
import qrcode
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, Flowable, KeepTogether)
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, "assets", "logo.png")
FATIGUE = os.path.join(HERE, "assets", "fatigue.png")
AUSTRALIA_WATERMARK = os.path.join(HERE, "assets", "australia_silhouette.png")
NAVY, BLUE, HEAD = colors.HexColor("#00205B"), colors.HexColor("#4F81BD"), colors.HexColor("#95B3D7")
G = 9.81
W, H = letter
BAR = 54
FX, FW = 90, 468
FRAME_TOP, FRAME_BOT = H - 138, 70
CALC = {"a1", "a2", "a3", "a4", "a5", "a6", "a7"}


# ----------------------------------------------------------------- fonts (template uses Carlito = Calibri metrics)
def _register_fonts():
    dirs = [os.path.join(HERE, "assets", "fonts"), r"C:\Windows\Fonts", "/usr/share/fonts/truetype/crosextra",
            "/usr/share/fonts/truetype/carlito", "/Library/Fonts", "/System/Library/Fonts/Supplemental"]
    sets = [("Carlito-Regular.ttf", "Carlito-Bold.ttf", "Carlito-Italic.ttf", "Carlito-BoldItalic.ttf"),
            ("calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf")]
    for files in sets:
        paths = [next((os.path.join(d, f) for d in dirs if os.path.isfile(os.path.join(d, f))), None) for f in files]
        if all(paths):
            for name, p in zip(("Body", "Body-Bold", "Body-Italic", "Body-BoldItalic"), paths):
                pdfmetrics.registerFont(TTFont(name, p))
            pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body-Italic", boldItalic="Body-BoldItalic")
            return True
    return False

if _register_fonts():
    FONT, FONT_B, FONT_I, FONT_BI = "Body", "Body-Bold", "Body-Italic", "Body-BoldItalic"
else:
    FONT, FONT_B, FONT_I, FONT_BI = "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"


def _register_cover_title_font():
    dirs = [os.path.join(HERE, "assets", "fonts"), r"C:\Windows\Fonts",
            "/usr/share/fonts/truetype/msttcorefonts", "/Library/Fonts"]
    names = ("verdanab.ttf", "Verdana_Bold.ttf", "Verdana Bold.ttf")
    path = next((os.path.join(directory, name) for directory in dirs for name in names
                 if os.path.isfile(os.path.join(directory, name))), None)
    if not path:
        return FONT_B
    pdfmetrics.registerFont(TTFont("CoverTitle-Bold", path))
    return "CoverTitle-Bold"


COVER_TITLE_FONT = _register_cover_title_font()


# ----------------------------------------------------------------- schema
def F(id, label, type="text", default="", opts=None, unit=""):
    return dict(id=id, label=label, type=type, default=default, opts=opts or [], unit=unit)

def I(id, label, h):
    return dict(id=id, label=label, h=h)

GENERAL = [
    F("rae_no", "RAE No."),
    F("applicant", "Applicant", default="All Trades Trailer"),
    F("client", "Client (short name)", default="ATT"),
    F("project_name", "Project name"),
    F("cert_no", "Certification No."),
    F("report_title", "Report title"),
    F("date", "Report date", "date"),
    F("atm", "ATM", "number", unit="kg"),
    F("axle_type", "Axle type", "select", "Dual Axle", ["Dual Axle", "Single Axle", "Tri Axle"]),
    F("trailer_type", "Trailer description", default="trailer"),
    F("rev", "Revision", default="R0"),
    F("rev_date", "Revision date", "date"),
    F("rev_details", "Revision details", default="Initial Release"),
    F("prepared_by", "Prepared by (initials)"),
    F("checked_by", "Checked by (initials)"),
    F("material", "Material"),
    F("fu", "Tensile strength", "number", unit="MPa"),
    F("fy", "Yield strength", "number", unit="MPa"),
    F("young", "Young's modulus", "number", unit="GPa"),
    F("nu", "Poisson's ratio", "number"),
    F("rho", "Density", "number", unit="kg/m3"),
]

def analysis_fields(n, loc="Drawbar"):
    return [F(f"a{n}_stress", "Max stress (neglecting local)", "number", unit="MPa"),
            F(f"a{n}_loc", "Location of max stress", default=loc),
            F(f"a{n}_def", "Max deformation", "number", unit="mm"),
            F(f"a{n}_note", "Extra note / local-stress justification (optional)", "textarea")]

def analysis_images(n):
    return [I(f"a{n}_load", "Load & constraints applied on the trailer", 100),
            I(f"a{n}_stress_img", f"Stress Distribution Plot for Analysis {n}", 56),
            I(f"a{n}_probe", "Stress Distribution Plot with the probe", 56),
            I(f"a{n}_disp", f"Displacement Plot for Analysis {n}", 99)]

SECTIONS = [
    dict(id="cert", title="Certificate of Conformity", fields=[], images=[]),
    dict(id="index", title="Report Index", fields=[], images=[]),
    dict(id="background", title="Background & Scope of Work",
         fields=[F("background_scope", "Project scope of work", "textarea"), F("background_objectives", "Analysis objectives", "textarea")],
         images=[I("bg_front", "3D Isometric Model in Autodesk Inventor - Front", 85), I("bg_back", "3D Isometric Model in Autodesk Inventor - Back", 85)]),
    dict(id="summary", title="Summary of Compliance", fields=[], images=[]),
    dict(id="requirements", title="Requirements", fields=[F("requirements_note", "Project-specific requirements and assumptions", "textarea")], images=[]),
    dict(id="geometry", title="Analysis Pre-processing & Geometry",
         fields=[F("length_mm", "Overall length", "number", unit="mm"), F("width_mm", "Overall width", "number", unit="mm"),
                 F("susp_mm", "Distance coupling to suspension", "number", unit="mm"),
                 F("geo_note", "Geometry design note", "textarea")],
         images=[I("geo_iso", "3D Isometric Model", 90), I("geo_top", "Top View showing the length and width of the trailer", 85), I("geo_side", "Side View showing the distance of suspension from coupling", 85)]),
    dict(id="methodology", title="Methodology & Material", fields=[], images=[]),
    dict(id="meshing", title="Meshing",
         fields=[F("nodes", "Mesh nodes", "number"), F("elements", "Mesh elements", "number"), F("preproc_note", "Analysis pre-processing note", "textarea")],
         images=[I("mesh", "Meshed model", 135)]),
    dict(id="a1", title="Analysis 1 - Longitudinal Tension and Compression (14.2.1.1.1)", fields=analysis_fields(1), images=analysis_images(1)),
    dict(id="a2", title="Analysis 2 - Transverse Thrust (14.2.1.2.1)", fields=analysis_fields(2, "Hanger"), images=analysis_images(2)),
    dict(id="a3", title="Analysis 3 - Vertical Tension and Compression (14.2.1.3.1)", fields=analysis_fields(3, "Chassis"), images=analysis_images(3)),
    dict(id="a4", title="Analysis 4 - Drawbar Dynamic Test (14.2.2.1)",
         fields=[F("tow_mass", "Towing vehicle mass T", "number", unit="t")] + analysis_fields(4) + [
             F("a4_nmodes", "Number of modes", "number"), F("a4_mass", "mass participation", "number", unit="%"),
             F("a4_f1", "f1", "number", unit="Hz"), F("a4_f2", "f2", "number", unit="Hz"),
             F("a4_xpart", "X participation", "number", unit="%"), F("a4_ypart", "Y participation", "number", unit="%"),
             F("a4_hloc", "Harmonic stress location", default="drawbar"), F("a4_nstress", "Harmonic normal stress", "number", unit="MPa")],
         images=[I("a4_modes", "Modes extracted from Modal Analysis", 81), I("a4_mass_img", "Ratio of effective mass to total mass extracted from Modal Analysis", 63),
                 I("a4_load", "Load & constraints applied on the trailer", 100),
                 I("a4_fx", "Frequency Response at coupling holes in X-axis", 48), I("a4_fy", "Frequency Response at coupling holes in Y-axis", 48), I("a4_fz", "Frequency Response at coupling holes in Z-axis", 48),
                 I("a4_disp", "Displacement Plot for Analysis 4", 99),
                 I("a4_stress_img", "Stress Distribution Plot for Analysis 4", 56), I("a4_probe", "Stress Distribution Plot with the probe", 56),
                 I("a4_harm", "Normal Stress Distribution Plot at Y-axis from Harmonic Response Analysis", 72)]),
    dict(id="a5", title="Analysis 5 - Structural strength (AS 4100)", fields=analysis_fields(5, "Chassis"),
         images=[I("a5_load", "Force acting on Chassis top surface & Spring Hangers", 99), I("a5_remote", "Remote Displacement at Coupling Mount holes and Spring Hanger Bracket", 88),
                 I("a5_react", "Reaction forces at Coupling and Spring Bracket respectively", 78), I("a5_hangers", "Reaction forces at all Hangers", 64),
                 I("a5_disp", "Displacement Plot for Analysis 5", 85), I("a5_stress_img", "Stress Distribution Plot for Analysis 5", 56), I("a5_probe", "Stress Distribution Plot with the probe", 56)]),
    dict(id="a6", title="Analysis 6 - Drawbar Safety Chain Attachment Points (14.4)",
         fields=[F("sc_t", "Plate / RHS thickness", "number", unit="mm"), F("sc_d", "Hole clearance diameter", "number", unit="mm"),
                 F("sc_n", "Number of bolts carrying chain", "number"),
                 F("sc_weld", "Include weld check?", "select", "No", ["No", "Yes"]),
                 F("sc_leg", "Weld leg size", "number", unit="mm"), F("sc_wlen", "Total weld length", "number", unit="mm"),
                 F("sc_fuw", "Weld electrode tensile strength Fuw", "number", unit="MPa"),
                 F("sc_note", "Safety chain analysis note", "textarea")],
         images=[I("sc_img", "Safety chain mount", 100)]),
    dict(id="a7", title="Analysis 7 - Coupling attachment points",
         fields=[F("cp_n", "Number of coupling bolts", "number"), F("cp_bolt", "Bolt size"), F("cp_grade", "Bolt grade"),
                 F("cp_t", "Coupling plate thickness", "number", unit="mm"), F("cp_d", "Hole clearance diameter", "number", unit="mm"),
                 F("cp_df", "Bolt diameter (df)", "number", unit="mm"), F("cp_ae", "Edge distance (ae)", "number", unit="mm"),
                 F("cp_note", "Coupling analysis note", "textarea")],
         images=[I("cp_img", "Coupling mount (bolt locations)", 70)]),
    dict(id="conclusion", title="Conclusion", fields=[F("conclusion_note", "Project conclusion", "textarea")], images=[]),
    dict(id="references", title="References", fields=[F("material_url", "Material datasheet URL")], images=[]),
]

def schema():
    return dict(general=GENERAL, sections=SECTIONS)


# ----------------------------------------------------------------- styles
def _align(value, fallback=TA_LEFT):
    return {"left": TA_LEFT, "center": TA_CENTER, "centre": TA_CENTER, "right": TA_RIGHT, "justify": TA_JUSTIFY}.get(str(value).lower(), fallback)

def ST(layout=None):
    layout = layout or {}
    body_al = _align(layout.get("text_align"), TA_JUSTIFY)
    head_al = _align(layout.get("heading_align"), TA_LEFT)
    cap_al = _align(layout.get("caption_align"), TA_CENTER)
    body = ParagraphStyle("body", fontName=FONT, fontSize=10.5, leading=13, alignment=body_al, spaceAfter=8)
    cell = ParagraphStyle("cell", fontName=FONT, fontSize=10.5, leading=13)
    return dict(
        body=body,
        tight=ParagraphStyle("tight", parent=body, spaceAfter=2),
        p1=ParagraphStyle("p1", parent=body, alignment=TA_LEFT, spaceAfter=13.5),
        p1b=ParagraphStyle("p1b", parent=body, fontName=FONT_B, alignment=TA_LEFT, spaceAfter=13.5),
        bul1=ParagraphStyle("bul1", parent=body, alignment=TA_LEFT, leftIndent=36, bulletIndent=18, spaceAfter=2),
        raeno=ParagraphStyle("raeno", fontName=FONT_B, fontSize=20, leading=24, textColor=NAVY, alignment=TA_CENTER, spaceAfter=19),
        h1=ParagraphStyle("h1", fontName=FONT_B, fontSize=18, leading=22, textColor=BLUE, alignment=head_al, spaceAfter=12),
        h16=ParagraphStyle("h16", fontName=FONT_B, fontSize=16, leading=20, textColor=BLUE, alignment=head_al, spaceBefore=6, spaceAfter=10),
        h2=ParagraphStyle("h2", fontName=FONT_B, fontSize=12, leading=15, textColor=BLUE, alignment=head_al, spaceBefore=8, spaceAfter=4),
        cap=ParagraphStyle("cap", fontName="Helvetica-Bold", fontSize=10, leading=12, alignment=cap_al, spaceBefore=3, spaceAfter=8),
        cell=cell,
        cellc=ParagraphStyle("cellc", parent=cell, alignment=TA_CENTER),
        celb=ParagraphStyle("celb", fontName=FONT_B, fontSize=10.5, leading=13, alignment=TA_CENTER),
        li=ParagraphStyle("li", fontName=FONT, fontSize=10.5, leading=13, leftIndent=14, firstLineIndent=-14, spaceAfter=3),
        bul=ParagraphStyle("bul", parent=body, alignment=TA_LEFT, leftIndent=14, firstLineIndent=-14, spaceAfter=2),
        bul2=ParagraphStyle("bul2", parent=body, alignment=TA_LEFT, leftIndent=28, firstLineIndent=-14, spaceAfter=2),
        reqb=ParagraphStyle("reqb", parent=body, alignment=TA_LEFT, leftIndent=19, bulletIndent=3, spaceAfter=6),
        num=ParagraphStyle("num", fontName=FONT_B, fontSize=10.5, leading=13, leftIndent=7, spaceBefore=4, spaceAfter=0),
        sub=ParagraphStyle("sub", parent=body, alignment=TA_LEFT, leftIndent=46, bulletIndent=28, bulletFontName="Courier", bulletFontSize=10.5, spaceAfter=0),
        legend=ParagraphStyle("legend", parent=body, alignment=TA_LEFT, spaceAfter=13),
        eq=ParagraphStyle("eq", parent=body, alignment=TA_LEFT, leftIndent=108, spaceAfter=3),
        warn=ParagraphStyle("warn", fontName=FONT_B, fontSize=10.5, leading=13, textColor=colors.HexColor("#B00020")),
    )

CAPTION_GAP_PT = 20
HN = lambda num, text: f"{num}&nbsp;&nbsp;&nbsp;&nbsp;{escape(text)}"
RED = lambda t: f'<font color="#B00020"><b>{t}</b></font>'


# ----------------------------------------------------------------- flowables
class Slot(Flowable):
    """Image slot: fills with the uploaded image, otherwise leaves a dashed blank box for later editing."""
    def __init__(self, data, label, h, align="center", offset_x=0, offset_y=0, sid=None, snap=False):
        super().__init__(); self.data, self.label, self.h = data, label, h * mm
        self.align, self.offset_x, self.offset_y = align, offset_x * mm, offset_y * mm
        self.sid, self.snap = sid, snap
        self._ch = self.h
    def wrap(self, aw, ah):
        self.w = aw
        self._ch = self.h
        if self.snap and self.data:
            try:
                iw, ih = ImageReader(io.BytesIO(self.data)).getSize()
                self._ch = ih * min(aw / iw, self.h / ih)
            except Exception:
                pass
        return aw, self._ch
    def _record(self, x, y, w, h, filled):
        if not self.sid:
            return
        try:
            ax, ay = self.canv.absolutePosition(x, y)
            boxes = self.canv._section_pages.setdefault("__images", {})
            boxes[self.sid] = {"page": self.canv.getPageNumber(), "x": ax, "y": ay, "w": w, "h": h, "filled": filled}
        except Exception:
            pass
    def draw(self):
        c = self.canv
        if self.data:
            try:
                ir = ImageReader(io.BytesIO(self.data)); iw, ih = ir.getSize()
                s = min(self.w / iw, self.h / ih); dw, dh = iw * s, ih * s
                factor = {"left": 0, "center": .5, "centre": .5, "right": 1}.get(str(self.align).lower(), .5)
                x = min(max((self.w - dw) * factor + self.offset_x, 0), max(self.w - dw, 0))
                y = min(max((self._ch - dh) / 2 + self.offset_y, 0), max(self._ch - dh, 0))
                c.drawImage(ir, x, y, dw, dh, mask="auto")
                self._record(x, y, dw, dh, True)
                return
            except Exception:
                pass
        c.setStrokeColor(colors.HexColor("#9AA5B5")); c.setDash(4, 3); c.setLineWidth(0.8)
        c.rect(0, 0, self.w, self.h); c.setDash()
        self._record(0, 0, self.w, self.h, False)


_n = [0]
class CapField(Flowable):
    def __init__(self, text): super().__init__(); self.text = text
    def wrap(self, aw, ah): self.w = aw; return aw, 8 * mm
    def draw(self):
        _n[0] += 1
        self.canv.acroForm.textfield(name=f"caption_{_n[0]}", value=self.text, x=self.canv.absolutePosition(0, 1 * mm)[0], y=self.canv.absolutePosition(0, 1 * mm)[1], width=self.w, height=6 * mm,
            fontName="Helvetica-Bold", fontSize=8, textColor=colors.black, fillColor=colors.white, borderColor=colors.HexColor("#9AA5B5"),
            borderWidth=0.6, forceBorder=True)

class CellField(Flowable):
    def __init__(self, w, name): super().__init__(); self.w, self.name = w, name
    def wrap(self, aw, ah): return self.w, 6 * mm
    def draw(self):
        self.canv.acroForm.textfield(name=self.name, value="", x=self.canv.absolutePosition(0, 0)[0], y=self.canv.absolutePosition(0, 0)[1], width=self.w, height=6 * mm, fontName="Helvetica", fontSize=8.5,
            textColor=colors.black, fillColor=colors.white, borderColor=colors.HexColor("#9AA5B5"), borderWidth=0.6, forceBorder=True)

class PageMarker(Flowable):
    """Records the page a section (toc=False) or an index entry (toc=True) starts on."""
    def __init__(self, key, toc=False):
        super().__init__(); self.key, self.toc = key, toc
    def wrap(self, aw, ah): return 0, 0
    def draw(self):
        try:
            d = self.canv._toc_pages if self.toc else self.canv._section_pages
            d.setdefault(self.key, self.canv.getPageNumber())
        except Exception:
            pass


def first_page_watermark(canv, doc):
    if doc.page != 1 or not getattr(doc, "_cover", False) or not os.path.isfile(AUSTRALIA_WATERMARK):
        return
    canv.saveState()
    try:
        canv.setFillAlpha(0.26)
    except (AttributeError, NotImplementedError):
        pass
    canv.drawImage(AUSTRALIA_WATERMARK, 125, H - 540, 414, 334, preserveAspectRatio=True, anchor="c", mask="auto")
    canv.restoreState()


class NumCanvas(rl_canvas.Canvas):
    def __init__(self, *a, meta=None, section_pages=None, toc_pages=None, **k):
        super().__init__(*a, **k); self._st = []; self.meta = meta or {}
        self._section_pages = section_pages if section_pages is not None else {}
        self._toc_pages = toc_pages if toc_pages is not None else {}
    def showPage(self):
        self._st.append(dict(self.__dict__)); self._startPage()
    def save(self):
        n = len(self._st)
        for i, s in enumerate(self._st):
            self.__dict__.update(s); self.decor(i, n); super().showPage()
        super().save()

    def _text(self, x, top, text, font, size, color=colors.black, dy=None):
        self.setFillColor(color); self.setFont(font, size)
        self.drawString(x, H - top - (size * 0.92 if dy is None else dy), text)

    def _draw_cover(self):
        c = self
        if os.path.isfile(LOGO):
            c.drawImage(LOGO, 76, H - 100, 106, 58, mask="auto", preserveAspectRatio=True, anchor="w")
        c.setFillColor(colors.black)
        title = "CERTIFICATE OF CONFORMITY"
        right_margin = 32
        title_width = sum(c.stringWidth(ch, COVER_TITLE_FONT, 36 if i == 0 else 22) for i, ch in enumerate(title))
        x, base = W - right_margin - title_width, H - 82
        for i, ch in enumerate(title):
            size = 36 if i == 0 else 22
            c.setFont(COVER_TITLE_FONT, size)
            c.drawString(x, base, ch)
            x += c.stringWidth(ch, COVER_TITLE_FONT, size)
        for k, t in enumerate(["Composite Structures Australia Pty Ltd", "www.csaengineering.com.au", "info@csaengineering.com.au",
                               "8/8 Christensen Road, Stapylton Qld 4207.", "P: +61 452 292 355"]):
            c._text(90, 638 + k * 12.75, t, FONT, 10.6)
        for k, t in enumerate(["Certifier -", "Noel Singh", "Fellow IEAustCPEng RPEQ 23862 NER"]):
            c._text(332, 642 + k * 15, t, FONT, 11)
        qr = self.meta.get("qr")
        if qr:
            c.drawImage(ImageReader(io.BytesIO(qr)), 506, H - 699, 63, 63, mask="auto")
            self._section_pages.setdefault("__images", {})["qr"] = {"page": 1, "x": 506, "y": H - 699, "w": 63, "h": 63, "filled": True}

    def decor(self, i, n):
        c = self
        c.setFillColor(NAVY); c.rect(0, 0, BAR, H, stroke=0, fill=1)
        c.saveState(); c.translate(BAR / 2 + 4, H / 2); c.rotate(90); c.setFillColor(colors.white)
        c.setFont("Helvetica", 10.4); c.drawCentredString(0, 0, "CSA Engineering"); c.restoreState()
        c.setFillColor(HEAD); c.rect(0, 120, BAR, 34, stroke=0, fill=1)
        c.setFillColor(colors.white); c.setFont("Helvetica", 11.5); c.drawCentredString(BAR / 2, 132, f"{i + 1}/{n}")
        if i == 0 and self.meta.get("cover"):
            self._draw_cover()
        else:
            if os.path.isfile(LOGO):
                c.drawImage(LOGO, 90, H - 118, 141, 76, mask="auto", preserveAspectRatio=True, anchor="nw")
            for k, t in enumerate(["8/8 Christensen Road, Stapylton Qld 4207.", "E: info@csaengineering.com.au", "P: +61 452 292 355", "www.csaengineering.com.au"]):
                c._text(359, 45 + k * 14, t, "Helvetica", 10)
        x = FX
        for k, (txt, filled) in enumerate(self.meta.get("footer", [])):
            if k:
                c.setFillColor(colors.black); c.setFont(FONT, 10.6); c.drawString(x, 29.5, " | "); x += c.stringWidth(" | ", FONT, 10.6)
            c.setFillColor(colors.black if filled else colors.HexColor("#9A9A9A")); c.setFont(FONT, 10.6)
            c.drawString(x, 29.5, txt); x += c.stringWidth(txt, FONT, 10.6)


# ----------------------------------------------------------------- context
class Ctx:
    def __init__(self, data, images, template, layout=None, extras=None, removed=None):
        self.d, self.im, self.tpl, self.warn = data, images, template, []
        self.layout, self.s, self.active = layout or {}, ST(layout), None
        self.extras, self.removed = extras or {}, set(removed or [])
        self.labels = {f["id"]: f["label"] for f in GENERAL + [x for s in SECTIONS for x in s["fields"]]}
        self.defs = {f["id"]: f["default"] for f in GENERAL + [x for s in SECTIONS for x in s["fields"]]}
        self.toc, self.dyn_heading = {}, ""

    def _dynamic_key(self, key):
        active = str(self.active or "")
        if not re.fullmatch(r"(?:a\d+|analysis-\d+)", active, re.I):
            return key
        return re.sub(r"(?<![A-Za-z0-9-])a\d+(?=_|$)", active, str(key), count=1, flags=re.I)

    def raw(self, k):
        k = self._dynamic_key(k)
        return str(self.d.get(k, "") if k in self.d else self.defs.get(k, "")).strip()

    def standards(self):
        items = self.d.get("standards", [])
        if not isinstance(items, list):
            return []
        rows = []
        for item in items:
            if not isinstance(item, dict):
                continue
            standard = str(item.get("standard") or "").strip()
            requirement = str(item.get("requirement") or "").strip()
            conformity = str(item.get("conformity") or "Full Compliance").strip()
            if standard or requirement:
                rows.append(dict(standard=standard, requirement=requirement, conformity=conformity))
        return rows

    def materials(self):
        """Return normalized material rows; retain compatibility with legacy single-material reports."""
        items = self.d.get("materials")
        if isinstance(items, list):
            rows = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                row = {
                    "material": str(item.get("material") or item.get("grade") or "").strip(),
                    "fu": item.get("fu", item.get("tensile_mpa", "")),
                    "fy": item.get("fy", item.get("yield_mpa", "")),
                    "young": item.get("young", item.get("youngs_modulus_gpa", "")),
                    "nu": item.get("nu", item.get("poisson_ratio", "")),
                    "rho": item.get("rho", item.get("density_kg_m3", "")),
                }
                if any(str(value or "").strip() for value in row.values()):
                    rows.append(row)
            return rows

        # Older saved reports contain one material in the root-level fields.
        legacy = {key: self.d.get(key, "") for key in ("material", "fu", "fy", "young", "nu", "rho")}
        return [legacy] if any(str(value or "").strip() for value in legacy.values()) else []

    def ph(self, label):
        return f'<font color="#9A9A9A"><i>[ {escape(label)} ]</i></font>'
    def v(self, k):
        x = self.raw(k)
        if k in ("date", "rev_date") and len(x) == 10 and x[4:5] == "-" and x[7:8] == "-":
            x = f"{x[8:10]}-{x[5:7]}-{x[:4]}"
        return escape(x) if x else self.ph(self.labels.get(k, k))
    def text(self, k):
        x = self.raw(k)
        return escape(x).replace("\n", "<br/>") if x else self.ph(self.labels.get(k, k))
    def n(self, k):
        try: return float(self.raw(k))
        except ValueError: return None
    def num(self, x, fmt="{:,.2f}", label="calc"):
        return fmt.format(x) if x is not None else self.ph(label)

    def P(self, t, st="body"):
        return Paragraph(t, self.s[st])

    def main(self, t, st="h1"):
        """The section's main heading: honours a renamed heading and its alignment from the editor."""
        over = self.raw("heading__" + str(self.active)) if self.active else ""
        if over:
            t = escape(over)
        style = self.s[st]
        pos = self.raw("heading_align__" + str(self.active)) if self.active else ""
        if pos and pos != "inherit":
            style = style.clone(f"{st}_{self.active}"); style.alignment = _align(pos, style.alignment)
        p = Paragraph(t, style); p.rg_main = True
        return p

    def slot(self, sid, label, h):
        sid = self._dynamic_key(sid)
        if sid in self.removed:
            return []
        if self.tpl:
            return [Slot(None, label, h), CapField(label)]
        if not self.im.get(sid):
            return []
        try:
            h = max(20, min(float(self.raw("img_height__" + sid)), 140)) if self.raw("img_height__" + sid) else h
        except ValueError:
            pass
        cap = self.raw("cap__" + sid) or label
        image_align = self.raw("img_align__" + sid)
        if not image_align or image_align == "inherit":
            image_align = self.layout.get("image_align", "center")
        caption_position = self.raw("cap_pos__" + sid)
        if not caption_position or caption_position == "inherit":
            caption_position = self.layout.get("caption_position", "below")
        try: offset_x = float(self.raw("img_offset_x__" + sid) or 0)
        except ValueError: offset_x = 0
        try: offset_y = float(self.raw("img_offset_y__" + sid) or 0)
        except ValueError: offset_y = 0
        image = Slot(self.im.get(sid), cap, h, image_align, offset_x, offset_y, sid=sid, snap=True)
        if str(self.raw("cap_style__" + sid) or "").lower() == "body":
            cap_style = self.s["body"] if caption_position == "above" else ParagraphStyle("body_gap", parent=self.s["body"], spaceBefore=CAPTION_GAP_PT)
        else:
            cap_style = ParagraphStyle("cap_gap", parent=self.s["cap"],
                spaceBefore=CAPTION_GAP_PT if caption_position != "above" else 0,
                spaceAfter=CAPTION_GAP_PT if caption_position == "above" else self.s["cap"].spaceAfter)
        caption = Paragraph(escape(cap), cap_style)
        return [KeepTogether([caption, image] if caption_position == "above" else [image, caption])]

    def extra_slots(self, section_id):
        out = []
        for item in self.extras.get(section_id, []):
            if not isinstance(item, dict) or not item.get("id"):
                continue
            try:
                height = max(20, min(float(item.get("h", 75)), 140))
            except (TypeError, ValueError):
                height = 75
            out += self.slot(str(item["id"]), str(item.get("label") or "Additional figure"), height)
        return out

    def tbl(self, rows, widths, head=True, pad=3):
        t = Table(rows, colWidths=widths, repeatRows=1 if head else 0)
        sty = [("GRID", (0, 0), (-1, -1), 0.6, NAVY), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
               ("TOPPADDING", (0, 0), (-1, -1), pad), ("BOTTOMPADDING", (0, 0), (-1, -1), pad)]
        if head: sty.append(("BACKGROUND", (0, 0), (-1, 0), HEAD))
        t.setStyle(TableStyle(sty)); return t


# ----------------------------------------------------------------- shared text helpers
KNOWN_STD = {"ADR62/02": "Australian Design Rules 62/02 – Mechanical Connections Between Vehicles – 2007.",
             "AS4100-2020": "Steel Structures", "AS4100": "Steel Structures", "AS4100-1998": "Steel Structures"}

def _std_codes(c):
    out = []
    for r in c.standards():
        code = re.sub(r"^standard\s*:\s*", "", r["standard"].strip(), flags=re.I).split("\n")[0]
        code = re.sub(r"\s*[-–—]\s*\d+(?:\.\d+)+.*$", "", code).strip()
        if code and code.lower() not in [x.lower() for x in out]:
            out.append(code)
    return out

def _std_line(code):
    known = KNOWN_STD.get(re.sub(r"\s", "", code).upper())
    if known:
        return f"<b>{escape(code)}:</b> {escape(known)}"
    return f"<b>{escape(code)}</b>"

def _join(items):
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]

def kg(c): return c.n("atm")

def active_analysis_number(c, fallback):
    m = re.search(r"(?:a|analysis-)(\d+)$", str(c.active or ""), re.I)
    return int(m.group(1)) if m else fallback

def strength_block(c, n):
    st, fy = c.n(f"a{n}_stress"), c.n("fy")
    lim = 0.9 * fy if fy else None
    loc = c.raw(f"a{n}_loc").lower()
    locs = escape(loc) if loc else c.ph("Location of max stress")
    stress = c.num(st, "{:g}", "stress")
    out = [c.P(f"As per the stress distribution results obtained from the finite element analysis, the maximum Von Mises stress of {stress} MPa was observed on {locs}.", "tight"),
           c.P("This value represents the design action effect SX."),
           c.P(f"The corresponding design capacity (ϕRu), determined in accordance with AS 4100:2020, considering the yield stress of {c.v('fy')} MPa for {c.v('material')} used for Structural member, with a capacity reduction factor <b>(ϕ) of 0.9.</b>"),
           c.P(f"SX ≤ ϕ Ru also satisfy that ∴ {stress} ≤ {c.num(lim, '{:g}', '0.9 x Yield strength')}")]
    if st is not None and lim is not None and st > lim:
        c.warn.append(f"Analysis {active_analysis_number(c, n)}: stress {st:g} MPa > 0.9 x yield ({lim:g} MPa)")
        out.append(c.P(RED("The maximum stress exceeds the design capacity - engineer review required.")))
    else:
        out.append(c.P(f"Therefore, the Trailer satisfies the design strength requirements and is considered structurally safe under the applied loading conditions for {c.v('material')}."))
    out.append(c.P(f"<b>Project-specific analysis note: </b>{c.text(f'a{n}_note')}"))
    return out

def deform_text(c, n):
    return c.P(f"As shown above, following is the deformation of the structure under the analysis loading condition. The maximum deformation was observed is {c.num(c.n(f'a{n}_def'), '{:g}', 'deformation')} mm.")


# ----------------------------------------------------------------- section builders
def sec_cert(c):
    s = c.s
    kv = lambda label, value: Paragraph(f"<b>{label}</b> {value}", s["p1"])
    out = [Paragraph(f'RAE No: {c.v("rae_no")}', s["raeno"]),
           kv('Name and address of Applicant:', c.v("applicant")), kv('Project Name:', c.v("project_name")),
           kv('Certification No:', c.v("cert_no")), kv('Product Classification:', 'Trailer Certification'),
           Paragraph("<b>Certification was carried within following scope</b>", s["p1"]),
           Paragraph("<b>Australian Standards:</b>", s["p1"])]
    codes = [] if c.tpl else _std_codes(c)
    items = [_std_line(x) for x in codes] or [c.ph("Enter standards in Summary of Compliance")]
    out += [Paragraph(t, s["bul1"], bulletText="•") for t in items]
    out += [Spacer(1, 16), Paragraph("The assessment process has been carried out in accordance with the individual rules and conditions agreed with the applicant.", s["p1"]),
            Paragraph("<b>Valid till: 5 Years From issue date (Yearly Inspection required)</b>", s["p1"]), Spacer(1, 18)]
    hdr = [Paragraph(x, s["celb"]) for x in ["Revision", "Date", "Revision Details", "Prepared By", "Checked By"]]
    row = [Paragraph(c.v(k), s["cellc"]) for k in ["rev", "rev_date", "rev_details", "prepared_by", "checked_by"]]
    out.append(c.tbl([hdr, row], [52, 63, 195, 83, 75], pad=6))
    return out + [PageBreak()]

def sec_index(c):
    s, t = c.s, c.toc
    rows = [[Paragraph(x, s["celb"]) for x in ["Sr. No.", "Section", "Page No."]]]
    def add(no, title, key):
        rows.append([Paragraph(no, s["cellc"]), Paragraph(escape(title), s["cell"]), Paragraph(str(t.get(key, "")), s["cellc"])])
    add("1.", "Background & Scope of Work", "bg"); add("2.", "Summary of Compliance", "summary"); add("3.", "Requirements", "req")
    add("4.", "Analysis pre-processing", "pre"); add("4.1", "Geometry", "geo"); add("4.2", "Methodology", "meth")
    add("4.3", "Material", "mat"); add("4.4", "Meshing", "mesh"); add("5.", "Analysis & Results", "ana")
    for i, a in enumerate(_analysis_sections_for_report(c), 1):
        add(f"5.{i}", re.sub(r"^5\.\d+\s+", "", a["title"]), f"ana{i}")
        for j, sub in enumerate(_subsections(c, a["id"]), 1):
            add(f"5.{i}.{j}", sub["title"], f"sub{i}.{j}")
    add("6.", "Conclusion", "concl"); add("7.", "References", "ref")
    return [c.main("Index:"), c.tbl(rows, [50, 330, 88], pad=4.4), PageBreak()]

def sec_background(c):
    ax = f"{c.v('axle_type')} Trailer"
    lines = [_std_line(x) for x in _std_codes(c)] or [_std_line("ADR 62/02"), _std_line("AS 4100-2020")]
    out = [PageMarker("bg", toc=True), c.main(HN("1.", "Background & Scope of Work")),
           c.P(f"This report has been prepared for {c.v('applicant')} ({c.v('client')}) to evaluate the structural integrity of the {c.v('project_name')}. Structural analysis has been carried out for the newly developed trailer chassis and its internal load-carrying members. The trailer has been certified as a {ax} rated for {c.v('atm')} kg ATM."),
           c.P("<b>The scope of work undertaken by CSA Engineering includes:</b>"),
           c.P(f"•&nbsp;&nbsp;&nbsp;Performing Finite Element Analysis (FEA) on {ax} stress distribution and structural strength analysis.", "bul"),
           c.P("•&nbsp;&nbsp;&nbsp;Verifying compliance with safety and performance criteria, ensuring durability and operational efficiency", "bul"),
           c.P("•&nbsp;&nbsp;&nbsp;Standards referred:", "bul")]
    out += [c.P(f"•&nbsp;{t}", "bul2") for t in lines]
    out += [c.P("Project scope of work", "h2"), c.P(c.text("background_scope")),
            c.P("Analysis objectives", "h2"), c.P(c.text("background_objectives")),
            c.P("3D isometric images of an actual trailer from Autodesk Inventor software identify this product.")]
    imgs = c.slot("bg_front", "3D Isometric Model in Autodesk Inventor - Front", 85) + c.slot("bg_back", "3D Isometric Model in Autodesk Inventor - Back", 85)
    return out + ([PageBreak()] + imgs if imgs else []) + [PageBreak()]

CONF_FILL = {
    "full compliant": "#32CD32", "full compliance": "#32CD32", "fully compliant": "#32CD32",
    "partial compliant": "#FFD700", "partial compliance": "#FFD700",
    "client scope": "#4A90E2",
    "not compliant": "#F4B6B6",
}

def sec_summary(c):
    s = c.s
    widths = [26, 109, 255, 78]
    out = [PageMarker("summary", toc=True), c.main(HN("2.", "Summary of Compliance")),
           c.P("The following table evaluates the trailer specifications against the governing requirements of AS 4100-2020: Steel Structures, ADR 62/02 is categorized as follows:"),
           c.P("Full Compliant (Green): Requirement clearly stated in document.", "legend"),
           c.P("Partial Compliant (Yellow): Requirement not stated but likely met.", "legend"),
           c.P("Client Scope (Blue): Outside current assessment scope.", "legend")]
    rows = [[Paragraph(x, s["celb"]) for x in ["No.", "Standard", "Compliance requirement", "Conformity"]]]
    standards = c.standards()
    fills = []
    if c.tpl:
        for i in range(8):
            rows.append([Paragraph(str(i + 1), s["cellc"]), CellField(widths[1] - 4, f"standard_{i + 1}"), CellField(widths[2] - 4, f"requirement_{i + 1}"), CellField(widths[3] - 4, f"conformity_{i + 1}")])
    elif standards:
        for i, item in enumerate(standards):
            rows.append([Paragraph(str(i + 1), s["cellc"]), Paragraph(escape(item["standard"]).replace("\n", "<br/>"), s["cell"]),
                         Paragraph(escape(item["requirement"]).replace("\n", "<br/>"), s["cell"]), Paragraph(escape(item["conformity"]), s["cellc"])])
            conformity_key = " ".join(item["conformity"].split()).casefold()
            fill = CONF_FILL.get(conformity_key)
            if fill:
                fills.append(("BACKGROUND", (3, i + 1), (3, i + 1), colors.HexColor(fill)))
    else:
        rows.append([Paragraph("1", s["cellc"]), Paragraph(c.ph("add standards in the report builder"), s["cell"]), Paragraph("", s["cell"]), Paragraph("", s["cell"])])
    t = c.tbl(rows, widths, pad=8)
    if fills: t.setStyle(TableStyle(fills))
    return out + [t, PageBreak()]

def sec_req(c):
    out = [PageMarker("req", toc=True), c.main(HN("3.", "Requirements")),
           c.P("The following requirements apply for the trailer structural compliance as selected in the Summary of Compliance.")]
    standards = c.standards()
    if c.tpl:
        for i in range(8):
            out.append(Table([[Paragraph(f"{i + 1}.", c.s["li"]), CellField(FW - 18, f"requirement_note_{i + 1}")]], colWidths=[14, FW - 14]))
    elif standards:
        for item in standards:
            out.append(Paragraph(escape(item["requirement"] or item["standard"]).replace("\n", "<br/>"), c.s["reqb"], bulletText="•"))
    else:
        out.append(c.P(c.ph("Add standards in the Summary of Compliance section.")))
    out += [c.P("Project-specific requirements and assumptions", "h2"), c.P(c.text("requirements_note"))]
    return out + [PageBreak()]

def sec_geometry(c):
    s = c.s
    out = [PageMarker("pre", toc=True), c.main(HN("4.", "Analysis Pre-processing:")),
           c.P("The Trailer is analyzed using the finite element analysis technique. The software used for analysis is ANSYS Workbench which is used in the automotive industry for over a decade. 3D elements have been used in modelling as these are the most appropriate for static structural analysis."),
           PageMarker("geo", toc=True), c.P("4.1 Geometry", "h16"),
           c.P(f"{c.v('client')} has provided the required 3D geometric data that was required for the structural analysis of the trailer. Shown following are the dimensions of the major structural members of the trailer which was used for the analysis."),
           c.P("Project-specific geometry note", "h2"), c.P(c.text("geo_note")), Spacer(1, 6)]
    out.append(c.tbl([[Paragraph(x, s["celb"]) for x in ["Overall length", "Overall width", "Coupling to suspension"]],
                      [Paragraph(f"{c.v(k)} mm", s["cellc"]) for k in ["length_mm", "width_mm", "susp_mm"]]], [FW / 3] * 3, pad=6))
    out.append(Spacer(1, 8))
    return out + c.slot("geo_iso", "3D Isometric Model", 90) + c.slot("geo_top", "Top View showing the length and width of the trailer", 85) \
        + c.slot("geo_side", "Side View showing the distance of suspension from coupling", 85) + [PageBreak()]

def sec_methodology(c):
    s = c.s
    material_rows = c.materials()
    material_names = [escape(row["material"]) for row in material_rows if row["material"]]
    material_description = ", ".join(material_names) if material_names else c.v("material")
    steps = [("Model Preparation:", [f"The CAD model of the {c.v('project_name')} was imported into the FEA software.",
                                     "Geometric simplifications were applied where appropriate to improve computational efficiency without affecting the structural behaviour of the trailer."]),
             ("Material Assignment:", [f"{material_description} was assigned to the relevant structural members based on design requirements.",
                                       "Mechanical properties such as yield strength, ultimate strength, Young’s modulus, and Poisson’s ratio were defined."]),
             ("Meshing Strategy:", ["A fine mesh was applied to areas with high stress concentrations to improve accuracy.", "A balance between computational efficiency and precision was maintained."]),
             ("Boundary Conditions & Load Application:", ["The models were fixed at the necessary supports to replicate real-world constraints.", "Various load cases were applied to simulate different load conditions."]),
             ("Analysis Execution & Validation:", ["The simulation was run to determine stress distribution, deformations, and failure points.", "Results were validated by checking against engineering standards and previous empirical data."])]
    out = [PageMarker("meth", toc=True), c.main("4.2 Methodology", "h16"),
           c.P("The trailer assembly was analyzed using the Finite Element Analysis (FEA) technique. ANSYS Workbench was utilized to evaluate the structural response of the trailer under the loading conditions specified in ADR 62/02 Clause 14. Three-dimensional solid elements were used in the finite element model to accurately represent the geometry and load transfer characteristics of the structure.")]
    for i, (title, items) in enumerate(steps, 1):
        out.append(Paragraph(f"{i}.&nbsp;&nbsp;&nbsp;{escape(title)}", s["num"]))
        out += [Paragraph(t, s["sub"], bulletText="o") for t in items]
    mat = [[Paragraph(x, s["celb"]) for x in ["Material", "Tensile Strength (MPa)", "Yield Strength (MPa)", "Young’s Modulus (GPa)", "Poisson’s Ratio", "Density (kg/m^3)"]]]
    if c.tpl:
        # Keep the blank template's original editable single row.
        mat.append([CellField(width - 4, f"material_{key}")
                    for width, key in zip([84, 77, 77, 77, 77, 76], ("material", "fu", "fy", "young", "nu", "rho"))])
    elif material_rows:
        for row in material_rows:
            mat.append([
                Paragraph(escape(str(row["material"] or "—")), s["cellc"]),
                Paragraph(escape(str(row["fu"] if row["fu"] not in (None, "") else "—")), s["cellc"]),
                Paragraph(escape(str(row["fy"] if row["fy"] not in (None, "") else "—")), s["cellc"]),
                Paragraph(escape(str(row["young"] if row["young"] not in (None, "") else "—")), s["cellc"]),
                Paragraph(escape(str(row["nu"] if row["nu"] not in (None, "") else "—")), s["cellc"]),
                Paragraph(escape(str(row["rho"] if row["rho"] not in (None, "") else "—")), s["cellc"]),
            ])
    else:
        mat.append([Paragraph(c.v(k), s["cellc"]) for k in ("material", "fu", "fy", "young", "nu", "rho")])
    out += [PageMarker("mat", toc=True), Spacer(1, 10), c.P("4.3 Material", "h16"),
            c.P("The material properties used in the analysis are assumed to be linear, elastic, isotropic, and homogeneous as per the requirements of the Australian Standard AS 4100-2020 for structural steel design."),
            c.tbl(mat, [84, 77, 77, 77, 77, 76], pad=6)]
    return out + [PageBreak()]

def sec_meshing(c):
    return [PageMarker("mesh", toc=True), c.main("4.4 Meshing", "h16"),
            c.P(f"The fine mesh was created with the number of nodes as {c.v('nodes')} and the number of elements as {c.v('elements')}. Shown below are some images of the finite element model that was used for the analysis."),
            c.P("Project-specific analysis pre-processing note", "h2"), c.P(c.text("preproc_note"))] \
        + c.slot("mesh", "Meshed model", 135) + [PageBreak()]


STATIC = {1: ("14.2.1.1.1", "Longitudinal Tension and Compression", 1.5, "a horizontal force of", "as per clause 14.2.1.1.1", "longitudinal", ""),
          2: ("14.2.1.2.1", "Transverse Thrust", 0.5, "a transverse load of", "as per clause 14.2.1.2.1", "transverse", ""),
          3: ("14.2.1.3.1", "Vertical Tension and Compression", 0.5, "a vertical load of", "in accordance with Clause 14.2.1.3.1", "vertical", " (with an equal downward force on the chassis)")}

def sec_static(n):
    def f(c):
        d = active_analysis_number(c, n)
        clause, title, fac, verb, conj, direction, extra = STATIC[n]
        atm = kg(c)
        force = c.num(fac * G * atm if atm else None, "{:,.0f}", f"{fac} x 9.81 x ATM")
        out = [PageMarker(f"ana{d}", toc=True), c.main(c.dyn_heading or f"5.{d} ANALYSIS {d} (ADR 62/02- {clause}) - {title}", "h16"),
               c.P(f"Trailer boundary conditions and the force applied as shown in the below image. The trailer coupling was subjected to {verb} {force} N {conj} of ADR 62/02 i.e., {fac} x 9.81 x {c.v('atm')} kg, applied on the coupling holes in the {direction} direction{extra}. All hanger holes faces are fixed in all DOF.")]
        out += c.slot(f"a{n}_load", "Load & constraints applied on the trailer", 100) + [PageBreak()]
        out += c.slot(f"a{n}_disp", f"Displacement Plot for Analysis {d}", 99) + [deform_text(c, n), PageBreak()]
        out += c.slot(f"a{n}_stress_img", f"Stress Distribution Plot for Analysis {d}", 56) + c.slot(f"a{n}_probe", "Stress Distribution Plot with the probe", 56)
        return out + strength_block(c, n) + [PageBreak()]
    return f

def sec_a4(c):
    d = active_analysis_number(c, 4)
    atm = kg(c); T = c.n("tow_mass"); C = atm / 1000 if atm else None
    dc = G * T * C / (T + C) if (T and C) else None
    force = dc * 600 if dc is not None else None
    D, Fc, Cs, Tv = c.num(dc, "{:.3f}", "D-value"), c.num(force, "{:,.1f}", "force"), c.num(C, "{:g}", "ATM/1000"), c.v("tow_mass")
    Cp = c.num(C, "{:g}", "C")
    modes, f1, f2 = c.v("a4_nmodes"), c.v("a4_f1"), c.v("a4_f2")
    out = [PageMarker(f"ana{d}", toc=True), c.main(c.dyn_heading or f"5.{d} ANALYSIS {d} (ADR 62/02- 14.2.2.1)- Drawbar Dynamic Test", "h16"),
           c.P(f"Trailer boundary conditions and applied force are illustrated in the images below. The D-value for the trailer is {D} kN. The horizontal force applied is 0.6 x Coupling D-value = 0.6 x {D} x 10<super>3</super> = {Fc} N, in accordance with clause 14.2.2.1 of ADR 62/02."),
           c.P("D-value for this trailer is calculated as shown:"),
           Paragraph("D<sub>C</sub> = g . (T x C)/(T + C) (from AS2213.4:2008- 5.1)", ParagraphStyle("ctr", parent=c.s["body"], alignment=TA_CENTER)),
           c.P(f"Here, T = maximum design total mass in tonnes of the towing vehicle = {Tv} t<br/>C = mass in tonnes transmitted to the ground by the axle of the centre-axle trailer loaded to its maximum design total mass = {Cs} t<br/>Therefore, D<sub>C</sub> = 9.81 x ({Tv} x {Cp})/({Tv} + {Cp}) = {D} kN"),
           c.P(f"Force applied on the coupling holes in the -X direction = -0.6 x {D} x 10<super>3</super> = -{Fc} N."),
           c.P(f"The modal analysis was performed by applying fixed support at the hanger holes to extract the natural frequencies of the structure, with a total of {modes} modes with effective-to-total mass participation reaching {c.v('a4_mass')}% being extracted as shown below. This allowed us to identify the critical frequencies and ensure they are sufficiently separated from the operating frequencies and to attain accuracy in the Harmonic Response Analysis.")]
    out += c.slot("a4_modes", "Modes extracted from Modal Analysis", 81) + c.slot("a4_mass_img", "Ratio of effective mass to total mass extracted from Modal Analysis", 63)
    out += [c.P(f"The modal analysis was performed by applying fixed support at the hanger holes to extract the natural frequencies of the structure. Total {modes} modes are extracted thus from the table of ratio of effective mass to the total mass. It is observed that the most critical frequencies are {f1} Hz and {f2} Hz, with corresponding effective mass participation of {c.v('a4_xpart')}% in the X-direction and {c.v('a4_ypart')}% in the Y-direction respectively."),
            c.P(f"Thus {f1} Hz and {f2} Hz are critical frequencies."),
            c.P(f"The harmonic response analysis was performed to evaluate the structural response to an oscillating force of {Fc} N applied horizontally.")]
    out += c.slot("a4_load", "Load & constraints applied on the trailer", 100)
    out += c.slot("a4_fx", "Frequency Response at coupling holes in X-axis", 48) + c.slot("a4_fy", "Frequency Response at coupling holes in Y-axis", 48) + c.slot("a4_fz", "Frequency Response at coupling holes in Z-axis", 48)
    out += [c.P(f"ADR 62/02 stipulates that the trailer must have sufficient stiffness to withstand stresses and deformation caused due to resonance up to a frequency of 35Hz. In the harmonic response analysis, it was found that even if the trailer experiences the critical frequency of {f2} Hz, the stress and deformation experienced due to resonance is well within the acceptable values.")]
    out += c.slot("a4_disp", "Displacement Plot for Analysis 4", 99) + [deform_text(c, 4), PageBreak()]
    out += c.slot("a4_stress_img", "Stress Distribution Plot for Analysis 4", 56) + c.slot("a4_probe", "Stress Distribution Plot with the probe", 56) + strength_block(c, 4) + [PageBreak()]
    out += c.slot("a4_harm", "Normal Stress Distribution Plot at Y-axis from Harmonic Response Analysis", 72)
    ns = c.n("a4_nstress")
    if ns is None: verdict = c.ph("verdict")
    elif ns <= 82: verdict = "Thus, the trailer can withstand more than 2 million cycles."
    else:
        verdict = RED("This exceeds the 82 MPa fatigue limit - engineer review required."); c.warn.append(f"Analysis {d}: harmonic stress {ns:g} MPa > 82 MPa fatigue limit")
    loc = c.raw("a4_hloc").lower()
    out += [c.P(f"As per the analysis, the maximum normal stress observed on the {escape(loc) if loc else c.ph('Harmonic stress location')} is {c.num(ns, '{:g}', 'Harmonic normal stress')} MPa, which is significantly lower than the allowable yield strength of {c.v('fy')} MPa for {c.v('material')}. The fatigue limit for the material, as specified in AS 4100-2020, Clause 11.6, is 82 MPa for 2 million cycles. This indicates that the trailer is capable of withstanding at least 2 million cycles as required in clause 14.2.2.1. of ADR 62/02 under the specified oscillating force. {verdict}")]
    if os.path.isfile(FATIGUE):
        out.append(KeepTogether([Slot(open(FATIGUE, "rb").read(), "Fatigue", 73), c.P("Fatigue Criteria as stated in AS 4100-2020", "cap")]))
    return out + [PageBreak()]

def sec_a5(c):
    d = active_analysis_number(c, 5)
    a = kg(c); v1 = G * a if a else None
    out = [PageMarker(f"ana{d}", toc=True), c.main(c.dyn_heading or f"5.{d} ANALYSIS {d} (AS 4100-2020) - Structural strength of the trailer", "h16"),
           c.P(f"For {c.v('atm')} kg ATM was used for this load case in the chassis. The structural members of the trailer are analyzed with 1G vertical load & 1G Horizontal load applied simultaneously to check the structural integrity of the trailer as per AS 4100-2020."),
           c.P(f"As shown below following is the distributed loading applied to the trailer and the restraints. This loading is the worst-case scenario in practical application. 1G vertical load = {c.num(v1, '{:,.0f}', 'load')} N; total forward & downward force (resultant of 1G vertical and 1G horizontal) = {c.num(v1 * 2 ** .5 if v1 else None, '{:,.0f}', 'load')} N; braking force (0.8 x 9.81 x ATM) = {c.num(0.8 * v1 if v1 else None, '{:,.0f}', 'load')} N.")]
    out += c.slot("a5_load", "Force acting on Chassis top surface & Spring Hangers", 99) + [PageBreak()]
    out += c.slot("a5_remote", "Remote Displacement at Coupling Mount holes and Spring Hanger Bracket", 88) + c.slot("a5_react", "Reaction forces at Coupling and Spring Bracket respectively", 78) + [PageBreak()]
    out += c.slot("a5_hangers", "Reaction forces at all Hangers", 64) + c.slot("a5_disp", f"Displacement Plot for Analysis {d}", 85) + [deform_text(c, 5), PageBreak()]
    out += c.slot("a5_stress_img", f"Stress Distribution Plot for Analysis {d}", 56) + c.slot("a5_probe", "Stress Distribution Plot with the probe", 56) + strength_block(c, 5)
    return out + [PageBreak()]

def sec_a6(c):
    d = active_analysis_number(c, 6)
    a, t, dd, nb, fy = kg(c), c.n("sc_t"), c.n("sc_d"), c.n("sc_n"), c.n("fy")
    F_ = G * a if a else None
    per = F_ / nb if F_ and nb else None
    br = per / (t * dd) if per and t and dd else None
    out = [PageMarker(f"ana{d}", toc=True), c.main(c.dyn_heading or f"5.{d} ANALYSIS {d} (ADR 62/02- 14.4) – ‘Drawbar’ Safety Chain Attachment Points", "h16"),
           c.P("The chain will be fitted on either side of the center line of the drawbar, which satisfies ADR62/02 - 14.4.1.")]
    if c.raw("sc_weld") == "Yes":
        leg, L, fuw = c.n("sc_leg"), c.n("sc_wlen"), c.n("sc_fuw")
        cap = 0.36 * fuw * 0.707 * leg if fuw and leg else None
        tot = cap * L if cap and L else None
        out.append(c.P(f"The safety chain mount is welded to the drawbar. The weld is a {c.v('sc_leg')}mm fillet weld, total weld length {c.v('sc_wlen')}mm, GP weld with E41/W40 electrode (nominal tensile stress {c.v('sc_fuw')} MPa). Load capacity of the joint = 0.36 x Fuw x tt x kr = 0.36 x {c.v('sc_fuw')} x (0.707 x {c.v('sc_leg')}) x 1.0 = {c.num(cap, '{:.2f}', 'cap')} N/mm. Total load capacity of the welded joint = {c.num(cap, '{:.2f}', 'cap')} x {c.v('sc_wlen')} = {c.num(tot, '{:,.0f}', 'cap')} N."))
        if tot and F_:
            if tot >= F_: out.append(c.P("As the required weld strength is less than the total load capacity of the welded joint, the welding joint is passing."))
            else:
                c.warn.append("Analysis 6: weld capacity below chain load"); out.append(c.P("The weld capacity is below the required load - engineer review required.", "warn"))
    verdict = ""
    if br is not None and fy:
        if br < fy: verdict = f"The allowable stress for the material is {c.v('fy')} MPa. Thus, the safety chain mount is passing (safety factor {fy / br:.2f})."
        else: verdict = RED("The bearing stress exceeds the allowable stress - engineer review required."); c.warn.append("Analysis 6: bearing stress >= allowable")
    out += [c.P(f"The longitudinal tension of 9.81 x ‘ATM’ kg is {c.num(F_, '{:,.0f}', 'force')} N (vertical tension 0.5 x 9.81 x ‘ATM’ = {c.num(F_ / 2 if F_ else None, '{:,.0f}', 'force')} N). As {c.v('sc_n')} bolt(s) will be supporting the safety chain, the force per bolt is {c.num(per, '{:,.0f}', 'force')} N. The plate thickness is {c.v('sc_t')} mm."),
            c.P(f"The compressive (bearing) stress induced per bolt = longitudinal force per bolt / (thickness x hole clearance) = {c.num(per, '{:,.0f}', 'force')} / ({c.v('sc_t')} x {c.v('sc_d')}) = {c.num(br, '{:.1f}', 'stress')} MPa"),
            c.P(verdict or c.ph("verdict")), c.P(f"<b>Project-specific safety chain analysis note: </b>{c.text('sc_note')}")]
    return out + c.slot("sc_img", "Safety chain mount", 100) + [PageBreak()]

def sec_a7(c):
    d = active_analysis_number(c, 7)
    a, n, t, dd, fu = kg(c), c.n("cp_n"), c.n("cp_t"), c.n("cp_d"), c.n("fu")
    F_ = 1.5 * G * a if a else None
    per = F_ / n if F_ and n else None
    br = per / (t * dd) if per and t and dd else None
    v = ""
    if br is not None and fu:
        if br < fu: v = f"The ultimate tensile stress for the material {c.v('material')} is {c.v('fu')} MPa. Thus, the safety factor obtained is {fu / br:.2f}."
        else: v = RED("The bearing stress exceeds the material ultimate tensile strength - engineer review required."); c.warn.append("Analysis 7: bearing stress >= ultimate tensile strength")
    out = [PageMarker(f"ana{d}", toc=True), c.main(c.dyn_heading or f"5.{d} ANALYSIS {d} - Coupling", "h16"),
           c.P(f"The pulling force at 1.5G (1.5 x 9.81 x ‘ATM’ kg) is {c.num(F_, '{:,.1f}', 'force')} N. As there are {c.v('cp_n')} bolts, this force per bolt is {c.num(F_, '{:,.1f}', 'force')} / {c.v('cp_n')} = {c.num(per, '{:,.1f}', 'force')} N. The thickness of the coupling plate is {c.v('cp_t')} mm and the bolt size is {c.v('cp_bolt')}."),
           c.P(f"The compressive stress induced per bolt = {c.num(per, '{:,.1f}', 'force')} N / (coupling plate thickness x hole clearance) = {c.num(per, '{:,.1f}', 'force')} / ({c.v('cp_t')} x {c.v('cp_d')}) = {c.num(br, '{:.2f}', 'stress')} MPa"),
           c.P(v or c.ph("verdict")), c.P(f"<b>Project-specific coupling analysis note: </b>{c.text('cp_note')}")]
    out += c.slot("cp_img", "Coupling mount (bolt locations)", 70) + [c.P(f"Note: Bolt grade is assumed to be {c.v('cp_grade')}."), PageBreak()]
    df, ae = c.n("cp_df"), c.n("cp_ae")
    ok = lambda *xs: all(x is not None for x in xs)
    vb1 = 3.2 * df * t * fu if ok(df, t, fu) else None
    vb2 = ae * t * fu if ok(ae, t, fu) else None
    cands = [x for x in (vb1, vb2) if x is not None]
    gov = min(cands) / 1000 if cands else None
    phi = 0.9 * gov if gov is not None else None
    vbs = per / 1000 if per else None
    kn = lambda x, lbl: c.num(x / 1000 if x is not None else None, "{:,.1f}", lbl)
    N = lambda x, lbl: c.num(x, "{:,.0f}", lbl)
    E = lambda t_: c.P(t_, "eq")
    if vbs is not None and phi is not None:
        if vbs <= phi: bv = f"Thus, the bolted coupling connection satisfies the bearing requirements of AS 4100:2020 (safety factor {phi / vbs:.2f})."
        else: bv = RED("The applied bearing force exceeds the design capacity - engineer review required."); c.warn.append("Analysis 7: bearing force > design capacity")
    else: bv = c.ph("Bearing check verdict")
    tp, fup = c.v("cp_t"), c.v("fu")
    out += [c.P("<b>Ply in bearing (AS 4100:2020 Clause 9.3.2.4)</b>", "tight"),
            c.P(f"Diameter of the bolt = df = {c.v('cp_df')} mm", "tight"), c.P(f"Thickness of the ply = tp = {tp} mm", "tight"),
            c.P(f"Tensile strength of the ply = fup = {fup} MPa", "tight"), c.P(f"Edge distance in the direction of loading, ae = {c.v('cp_ae')} mm", "tight"),
            c.P("Capacity factor = φ = 0.9"),
            E("Vb = 3.2 df tp fup"), E(f"Vb = 3.2 × {c.v('cp_df')} × {tp} × {fup}"), E(f"Vb = {N(vb1, 'V_b1')} N = {kn(vb1, 'V_b1')} kN"), Spacer(1, 8),
            E("Vb = ae tp fup"), E(f"Vb = {c.v('cp_ae')} × {tp} × {fup}"), E(f"Vb = {N(vb2, 'V_b2')} N = {kn(vb2, 'V_b2')} kN"), Spacer(1, 8),
            c.P("Design bearing capacity,", "tight"),
            E(f"φVb = 0.9 × {c.num(gov, '{:,.1f}', 'governing V_b')} kN"), E(f"φVb = {c.num(phi, '{:,.1f}', 'φV_b')} kN"), Spacer(1, 8),
            c.P(f"Applied bearing force, Vb* = {c.num(vbs, '{:,.1f}', 'V_b*')} kN", "tight"), c.P("Capacity Check, Vb* ≤ φVb", "tight"),
            Paragraph(f"{c.num(vbs, '{:,.1f}', 'V_b*')} ≤ {c.num(phi, '{:,.1f}', 'φV_b')}", ParagraphStyle("chk", parent=c.s["body"], alignment=TA_LEFT, leftIndent=72)),
            c.P(bv)]
    return out + [PageBreak()]

def sec_concl(c):
    a = c.v("atm")
    stds = _join(_std_codes(c)) if _std_codes(c) else "ADR 62/02 and AS 4100:2020"
    return [PageMarker("concl", toc=True), c.main(HN("6.", "CONCLUSION")),
            c.P(f"The structural assessment of the {a} kg ATM trailer was carried out in accordance with the requirements of {escape(stds)}."),
            c.P("<b>This assessment assumes that the trailer is in a new condition with no material degradation, manufacturing defects, or damage.</b> Exposure to environmental and service-related effects, such as corrosion, wear, or mechanical damage, may significantly reduce the structural capacity of the trailer and its ability to safely support the rated ATM."),
            c.P(f"The assessment included static and dynamic load cases in accordance with {escape(_join(_std_codes(c)[:1]) if _std_codes(c) else 'ADR 62/02')} to evaluate the structural response of the trailer, including stress distribution, fatigue performance, and the effects of braking. The applied loading and boundary conditions were selected to represent the actual loading conditions of the trailer, including load transfer through the coupling connection and suspension mounting locations."),
            c.P(f"The results demonstrate that the assessed components satisfy the applicable strength and fatigue requirements of {escape(stds)} for a {a} kg ATM trailer."),
            c.P("Project conclusion", "h2"), c.P(c.text("conclusion_note")),
            c.P("This assessment is limited to the standards and requirements specified in Chapter 2 – Summary of Compliance."),
            c.P("The periodic inspection and maintenance should be undertaken, and a structural safety reassessment should be conducted if material degradation or damage is identified to ensure continued compliance with the applicable design requirements."),
            PageBreak()]

def sec_refs(c):
    return [PageMarker("ref", toc=True), c.main(HN("7.", "Reference")),
            c.P("1. Vehicle Standard – Australian Design Rules 62/02 – Mechanical Connections Between Vehicles – 2007.", "p1"),
            c.P("2. AS 4100-2020: Steel Structures.", "p1"),
            c.P("3. Material properties:", "tight"), c.P(c.text("material_url"))]

BUILD = dict(cert=sec_cert, index=sec_index, summary=sec_summary, background=sec_background, geometry=sec_geometry,
             requirements=sec_req, methodology=sec_methodology, meshing=sec_meshing, a1=sec_static(1), a2=sec_static(2), a3=sec_static(3),
             a4=sec_a4, a5=sec_a5, a6=sec_a6, a7=sec_a7, conclusion=sec_concl, references=sec_refs)


# ----------------------------------------------------------------- dynamic analysis + build
def _subsection_story(c, section_id, n):
    out = []
    for j, sub in enumerate(_subsections(c, section_id), start=1):
        out += [PageBreak(), PageMarker(f"sub{n}.{j}", toc=True), c.P(f"5.{n}.{j} {escape(sub['title'])}", "h2")]
        if sub["body"]:
            out.extend(_body_flowables(c, sub["body"]))
    return out

def _build_compliance_analysis(c, section):
    n = section["analysis_number"]
    calc = section.get("calculation_template") or ""
    if calc in CALC:
        return BUILD[calc](c)
    out = [PageMarker(f"ana{n}", toc=True), c.main(c.dyn_heading or f"5.{n} ANALYSIS {n}", "h16")]
    standard, requirement = section.get("compliance_standard") or "", section.get("compliance_requirement") or ""
    if standard:
        out.append(c.P(f"<b>Standard:</b> {escape(standard)}"))
    if requirement:
        for para in re.split(r"\n\s*\n", requirement.replace("\r\n", "\n")):
            if para.strip():
                out.extend(_body_flowables(c, para.strip()))
    else:
        out.append(c.P("Add the compliance requirement in Summary of Compliance."))
    stress, loc, de, note = c.n(f"a{n}_stress"), c.raw(f"a{n}_loc"), c.n(f"a{n}_def"), c.raw(f"a{n}_note")
    if stress is not None or loc or de is not None or note:
        out.append(c.P("Analysis results", "h2"))
        if stress is not None: out.append(c.P(f"Maximum stress (neglecting local): {c.num(stress, '{:g}', 'stress')} MPa"))
        if loc: out.append(c.P(f"Location of maximum stress: {escape(loc)}"))
        if de is not None: out.append(c.P(f"Maximum deformation: {c.num(de, '{:g}', 'deformation')} mm"))
    out.append(c.P("Project-specific analysis note: " + c.text(f"a{n}_note")))
    for image in section.get("images", []):
        out += c.slot(image["id"], image["label"], image["h"])
    return out + [PageBreak()]

def _add_tail(story, items):
    if not items: return story
    if story and isinstance(story[-1], PageBreak):
        story.pop(); return story + items + [PageBreak()]
    return story + items

def _squash(story):
    """Drop page breaks that would create blank pages."""
    out = []
    for f in story:
        if isinstance(f, PageBreak):
            last = next((x for x in reversed(out) if not isinstance(x, PageMarker)), None)
            if last is None or isinstance(last, PageBreak):
                continue
        out.append(f)
    while out and isinstance(out[-1], PageBreak):
        out.pop()
    return out

def _render(data, images, ids, template, layout, extras, removed, toc):
    c = Ctx(data, images, template, layout, extras, removed); c.toc = toc
    section_pages, toc_pages, story = {}, {}, []
    analysis_ids = {s["id"] for s in SECTIONS if re.fullmatch(r"a\d+", str(s["id"]), re.I)}
    dyn = [] if template else _analysis_sections_for_report(c)

    def analysis_story():
        out = []
        for k, a in enumerate(dyn):
            did, n = a["id"], a["analysis_number"]
            c.active, c.dyn_heading = did, escape(a["title"])
            head = [PageMarker(did)]
            if k == 0:
                head += [PageMarker("ana", toc=True), c.P(HN("5.", "Analysis & Results"), "h1")]
            custom = c.raw("body__" + did)
            if custom:
                body = [PageMarker(f"ana{n}", toc=True), c.main(c.dyn_heading, "h16")] + _body_flowables(c, custom)
                calc = a.get("calculation_template") or ""
                if calc in CALC:
                    body += [f for f in BUILD[calc](c) if not isinstance(f, PageMarker) and not getattr(f, "rg_main", False)]
                else:
                    for im in a.get("images", []):
                        body += c.slot(im["id"], im["label"], im["h"])
                    body.append(PageBreak())
            else:
                body = _build_compliance_analysis(c, a)
            sec = _add_tail(head + body, c.extra_slots(did))
            sub = _subsection_story(c, did, n)
            if sub:
                sec = _add_tail(sec, sub + [PageBreak()])
            out += sec
        return out

    inserted = False
    for s in SECTIONS:
        if s["id"] in analysis_ids and not template:
            if not inserted:
                story += analysis_story(); inserted = True
            continue
        if s["id"] not in ids:
            continue
        c.active, c.dyn_heading = s["id"], ""
        custom = c.raw("body__" + s["id"])
        if custom and not template:
            sec = [PageMarker(s["id"]), c.main(escape(s["title"]))] + _body_flowables(c, custom)
            for im in s["images"]:
                sec += c.slot(im["id"], im["label"], im["h"])
            sec.append(PageBreak())
        else:
            sec = [PageMarker(s["id"])] + BUILD[s["id"]](c)
        story += _add_tail(sec, c.extra_slots(s["id"]))
    if dyn and not inserted:
        story += analysis_story()

    story = _squash(story) or [Spacer(1, 1)]
    cover = "cert" in ids
    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=letter, title=c.raw("project_name") or "Trailer Certification Report", author="CSA Engineering")
    doc._cover = cover
    doc.addPageTemplates([PageTemplate("p", frames=[Frame(FX, FRAME_BOT, FW, FRAME_TOP - FRAME_BOT, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)],
                                       onPage=first_page_watermark)])
    def part(key, label):
        v = c.raw(key)
        return (v, True) if v else (f"[ {label} ]", False)
    qr = None if "qr" in c.removed else (images.get("qr") or make_qr_png("https://csaengineering.com.au/verify", 22))
    meta = {"footer": [part("rae_no", "RAE No."), part("applicant", "Applicant"), part("project_name", "Project name"), ("Certification Report", True)],
            "cover": cover, "qr": qr}
    canvas = functools.partial(NumCanvas, meta=meta, section_pages=section_pages, toc_pages=toc_pages)
    doc.build(story, canvasmaker=canvas)
    return buf.getvalue(), c.warn, section_pages, toc_pages


def build(data=None, images=None, selected=None, template=False, layout=None, extras=None, removed=None):
    """Returns (pdf_bytes, warnings, section_pages). template=True -> blank placeholders everywhere."""
    data = {} if template else (data or {})
    images = images or {}
    ids = selected if selected is not None else [s["id"] for s in SECTIONS]
    out, warns, section_pages, toc = _render(data, images, ids, template, layout, extras, removed, {})
    if not template and "index" in ids and toc:
        # second pass so the Report Index shows real page numbers
        out, warns, section_pages, _ = _render(data, images, ids, template, layout, extras, removed, toc)
    if template:
        from pypdf import PdfReader, PdfWriter
        writer = PdfWriter(clone_from=PdfReader(io.BytesIO(out)))
        cleaned = io.BytesIO(); writer.write(cleaned); out = cleaned.getvalue()
    return out, warns, section_pages


# ----------------------------------------------------------------- preserved Word/export and dynamic-report helpers

def make_qr_png(text, size_mm):
    """Generate a QR code PNG image as bytes."""
    qr = qrcode.QRCode(version=1, box_size=4, border=2)
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def HN(number, title):
    """Return a safely formatted numbered heading for the fixed report template."""
    return f"<b>{escape(str(number))}</b> {escape(str(title))}"


def add_word_first_page_watermark(doc, section):
    """Add the silhouette as a behind-text watermark in Word's first-page header."""
    if not os.path.isfile(AUSTRALIA_WATERMARK):
        return
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Mm

    section.different_first_page_header_footer = True
    paragraph = section.first_page_header.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    inline = paragraph.add_run().add_picture(AUSTRALIA_WATERMARK, width=Mm(176))._inline

    # python-docx creates an inline image. Convert it to a page-anchored,
    # behind-text DrawingML shape so it behaves as a real watermark.
    anchor = OxmlElement("wp:anchor")
    for name, value in {
        "distT": "0", "distB": "0", "distL": "0", "distR": "0",
        "simplePos": "0", "relativeHeight": "0", "behindDoc": "1",
        "locked": "0", "layoutInCell": "1", "allowOverlap": "1",
    }.items():
        anchor.set(name, value)
    simple_pos = OxmlElement("wp:simplePos")
    simple_pos.set("x", "0")
    simple_pos.set("y", "0")
    position_h = OxmlElement("wp:positionH")
    position_h.set("relativeFrom", "page")
    pos_h_offset = OxmlElement("wp:posOffset")
    pos_h_offset.text = str(17 * 36000)
    position_h.append(pos_h_offset)
    position_v = OxmlElement("wp:positionV")
    position_v.set("relativeFrom", "page")
    pos_v_offset = OxmlElement("wp:posOffset")
    pos_v_offset.text = str(96 * 36000)
    position_v.append(pos_v_offset)
    effect_extent = OxmlElement("wp:effectExtent")
    for name in ("l", "t", "r", "b"):
        effect_extent.set(name, "0")
    wrap_none = OxmlElement("wp:wrapNone")
    children = {child.tag: child for child in inline}
    anchor.extend([
        simple_pos,
        position_h,
        position_v,
        children[qn("wp:extent")],
        effect_extent,
        wrap_none,
        children[qn("wp:docPr")],
        children[qn("wp:cNvGraphicFramePr")],
        children[qn("a:graphic")],
    ])
    inline.getparent().replace(inline, anchor)


def _inline_report_markup(value):
    """Escape user content while supporting a small, safe Markdown subset."""
    text = escape(str(value or ""))
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", text)
    return text.replace("  ", " &nbsp;")


def _body_flowables(c, body):
    """Convert editable section text into flowing paragraphs, headings, lists and tables."""
    lines = str(body or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out, paragraph = [], []

    def flush_paragraph():
        if paragraph:
            text = "<br/>".join(_inline_report_markup(line) for line in paragraph).strip()
            if text:
                out.append(c.P(text))
            paragraph.clear()

    def table_cells(line):
        return [cell.strip() for cell in line.strip().strip("|").split("|")]

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            flush_paragraph()
            i += 1
            continue

        if "|" in line and i + 1 < len(lines) and re.match(
            r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$", lines[i + 1]
        ):
            flush_paragraph()
            raw_rows = [table_cells(line)]
            i += 2
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                raw_rows.append(table_cells(lines[i]))
                i += 1
            column_count = max((len(row) for row in raw_rows), default=1)
            normalized = [row + [""] * (column_count - len(row)) for row in raw_rows]
            rows = [[Paragraph(_inline_report_markup(cell), c.s["cell"]) for cell in row] for row in normalized]
            table = Table(rows, colWidths=[FW / column_count] * column_count, repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#8b9baa")),
                ("BACKGROUND", (0, 0), (-1, 0), HEAD),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            out.extend([Spacer(1, 3), table, Spacer(1, 6)])
            continue

        if line.startswith("### "):
            flush_paragraph()
            out.append(c.P(_inline_report_markup(line[4:]), "h2"))
        elif line.startswith("## "):
            flush_paragraph()
            out.append(c.P(_inline_report_markup(line[3:]), "h2"))
        elif line.startswith("# "):
            flush_paragraph()
            out.append(c.P(_inline_report_markup(line[2:]), "h1"))
        elif line.startswith(("- ", "* ")):
            flush_paragraph()
            out.append(c.P(f"&#8226;&nbsp;{_inline_report_markup(line[2:])}", "li"))
        else:
            paragraph.append(line)
        i += 1

    flush_paragraph()
    return out


def _resolve_calculation_template(standard, requirement):
    """Match only calculation cases already implemented by this report engine."""
    source = f"{standard or ''} {requirement or ''}".lower()
    patterns = [
        ("a1", r"14\.2\.1\.1\.1|longitudinal tension"),
        ("a2", r"14\.2\.1\.2\.1|transverse thrust"),
        ("a3", r"14\.2\.1\.3\.1|vertical tension"),
        ("a4", r"14\.2\.2\.1|drawbar dynamic|d-value"),
        ("a6", r"14\.4(?:\.1)?|safety chain"),
        ("a7", r"analysis\s*7|coupling attachment|coupling plate|coupling bolts"),
        ("a5", r"as\s*4100|structural strength"),
    ]
    for template_id, pattern in patterns:
        if re.search(pattern, source):
            return template_id
    return ""


def _dynamic_analysis_heading(number, standard, requirement):
    """Format a complete analysis heading from the selected standard and clause."""
    standard = re.sub(r"^standard\s*:\s*", "", str(standard or "").strip(), flags=re.I)
    requirement = str(requirement or "").strip().replace("\r\n", "\n")
    lines = [line.strip() for line in requirement.split("\n") if line.strip()]

    clause_pattern = re.compile(r"\b(?:clause\s*)?(\d+(?:\.\d+)+)\b", re.I)
    clause_match = clause_pattern.search(requirement) or clause_pattern.search(standard)
    clause_number = clause_match.group(1) if clause_match else ""

    description = ""
    for line in lines:
        candidate = re.sub(
            r"^\s*(?:clause\s*)?\d+(?:\.\d+)+\s*[:\-–—.)]?\s*",
            "",
            line,
            flags=re.I,
        )
        candidate = re.sub(
            r"^\s*(?:ADR\s*62/02|AS\s*4100(?:-\d{4})?)\s*[-:–—]?\s*",
            "",
            candidate,
            flags=re.I,
        )
        candidate = re.sub(r"^\s*[-:–—]\s*", "", candidate).strip()
        if candidate and not re.match(
            r"^(?:standard|selected standard|selected clause requirement)\s*:",
            candidate,
            re.I,
        ):
            description = candidate
            break

    standard_and_clause = standard
    if clause_number:
        standard_and_clause = f"{standard}{'- ' if standard else ''}{clause_number}"

    if standard_and_clause and description:
        return f"5.{number} ANALYSIS {number} ({standard_and_clause}) - {description}"
    if standard_and_clause:
        return f"5.{number} ANALYSIS {number} ({standard_and_clause})"
    if description:
        return f"5.{number} ANALYSIS {number} - {description}"
    return f"5.{number} ANALYSIS {number}"


def _subsections(c, section_id):
    """Read user-added Analysis subsections safely from the report data."""
    try:
        entries = json.loads(c.raw("subsections__" + str(section_id)) or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(entries, list):
        return []
    out = []
    for entry in entries[:30]:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title") or "").strip()[:250]
        body = str(entry.get("body") or "").strip()[:20000]
        if title:
            out.append({"title": title, "body": body})
    return out


def _analysis_sections_for_report(c):
    """Build one analysis section per selected Summary of Compliance row."""
    rows = c.standards()
    templates = {}
    for section in SECTIONS:
        match = re.fullmatch(r"a(\d+)", str(section.get("id", "")), re.I)
        if match:
            templates[int(match.group(1))] = section

    sections = []
    for number, row in enumerate(rows, start=1):
        template_section = templates.get(number, {})
        section_id = template_section.get("id") or f"analysis-{number}"
        requirement = str(row.get("requirement") or "").strip()
        standard = str(row.get("standard") or "").strip()
        calculation_template = _resolve_calculation_template(standard, requirement)
        calculation_section = templates.get(int(calculation_template[1:]), {}) if calculation_template else template_section
        heading = _dynamic_analysis_heading(number, standard, requirement)
        images = calculation_section.get("images") or analysis_images(number)
        images = [
            {**image, "id": re.sub(r"^a\d+_", f"{section_id}_", str(image.get("id") or ""), count=1, flags=re.I)}
            for image in images
        ]
        sections.append({
            "id": section_id,
            "title": heading,
            "compliance_standard": standard,
            "compliance_requirement": requirement,
            "calculation_template": calculation_template,
            "images": images,
            "analysis_number": number,
        })
    return sections


def build_word(data=None, images=None, selected=None, template=False, layout=None, extras=None, removed=None):
    """Create a visually faithful Word companion by embedding PDF pages.

    Word's pagination engine cannot reliably reproduce ReportLab's flowable
    layout (especially its fixed sidebar, form fields and figure placement).
    The controlled PDF therefore remains the single layout source.  Each PDF
    page is rendered at 200 DPI and anchored to an US Letter Word page, preserving
    every mark, font, image, footer and page number exactly as issued.

    This is deliberately a page-faithful, non-editable DOCX fallback.  The
    report data and the PDF generation path are shared; the PDF itself is not
    changed or post-processed.
    """
    import fitz  # PyMuPDF
    from docx import Document
    from docx.enum.section import WD_SECTION_START
    from docx.shared import Mm, Pt
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    # Use precisely the same input and builder as the ordinary PDF download.
    pdf_bytes, warnings, _ = build(
        data=data, images=images, selected=selected, template=template,
        layout=layout, extras=extras, removed=removed,
    )
    pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
    document = Document()

    def configure(section):
        section.page_width, section.page_height = Mm(215.9), Mm(279.4)
        section.left_margin = section.right_margin = Mm(0)
        section.top_margin = section.bottom_margin = Mm(0)
        section.header_distance = section.footer_distance = Mm(0)

    def anchor_to_page(run, picture):
        """Convert python-docx's inline drawing into a fixed page drawing."""
        inline = picture._inline
        inline.tag = qn("wp:anchor")
        inline.set("distT", "0")
        inline.set("distB", "0")
        inline.set("distL", "0")
        inline.set("distR", "0")
        inline.set("simplePos", "0")
        inline.set("relativeHeight", "0")
        inline.set("behindDoc", "0")
        inline.set("locked", "1")
        inline.set("layoutInCell", "1")
        inline.set("allowOverlap", "1")
        simple_pos = OxmlElement("wp:simplePos")
        simple_pos.set("x", "0")
        simple_pos.set("y", "0")
        pos_h = OxmlElement("wp:positionH")
        pos_h.set("relativeFrom", "page")
        pos_h.append(OxmlElement("wp:posOffset"))
        pos_h[0].text = "0"
        pos_v = OxmlElement("wp:positionV")
        pos_v.set("relativeFrom", "page")
        pos_v.append(OxmlElement("wp:posOffset"))
        pos_v[0].text = "0"
        inline.insert(0, simple_pos)
        inline.insert(1, pos_h)
        inline.insert(2, pos_v)

    for index, page in enumerate(pdf):
        section = document.sections[0] if index == 0 else document.add_section(WD_SECTION_START.NEW_PAGE)
        configure(section)
        # A new section has no body paragraph until one is explicitly added.
        # The image is anchored, so this carrier paragraph never participates
        # in the visible page layout.
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
        paragraph.paragraph_format.line_spacing = Pt(1)
        # 200 DPI keeps engineering diagrams and small report text sharp while
        # producing a practical download size.
        png = page.get_pixmap(matrix=fitz.Matrix(200 / 72, 200 / 72), alpha=False).tobytes("png")
        run = paragraph.add_run()
        picture = run.add_picture(io.BytesIO(png), width=Mm(215.9), height=Mm(279.4))
        anchor_to_page(run, picture)

    pdf.close()
    result = io.BytesIO()
    document.core_properties.title = (data or {}).get("project_name") or "Trailer Certification Report"
    document.core_properties.subject = "Page-faithful PDF companion"
    document.core_properties.comments = "Pages are embedded from the controlled PDF to preserve the issued layout."
    document.save(result)
    return result.getvalue(), warnings


def build_word_template(data, images, selected, layout, extras, removed):
    """Build a blank Word template matching the PDF template layout exactly."""
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Mm, Pt, RGBColor
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Mm(215.9), Mm(279.4)
    section.left_margin, section.right_margin = Mm(22), Mm(22)
    section.top_margin, section.bottom_margin = Mm(20), Mm(18)
    add_word_first_page_watermark(doc, section)

    normal = doc.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(9.5)

    CENTER = WD_ALIGN_PARAGRAPH.CENTER
    LEFT = WD_ALIGN_PARAGRAPH.LEFT
    NAVY = RGBColor(0x1F, 0x38, 0x64)
    WHITE = RGBColor(0xFF, 0xFF, 0xFF)

    def set_cell_bg(cell, color_hex):
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), color_hex)
        tcPr.append(shd)

    def set_cell_margins(cell, top=40, bottom=40, left=80, right=80):
        tcPr = cell._tc.get_or_add_tcPr()
        tcMar = OxmlElement("w:tcMar")
        for m, v in (("top", top), ("bottom", bottom), ("start", left), ("end", right), ("left", left), ("right", right)):
            node = OxmlElement(f"w:{m}")
            node.set(qn("w:w"), str(v))
            node.set(qn("w:type"), "dxa")
            tcMar.append(node)
        tcPr.append(tcMar)

    # ---------- 1. Logo + CERTIFICATE OF CONFORMITY heading table ----------
    t = doc.add_table(rows=1, cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for row in t.rows:
        row.cells[0].width = Mm(40)
        row.cells[1].width = Mm(127)

    cell0 = t.rows[0].cells[0]
    set_cell_margins(cell0)
    p0 = cell0.paragraphs[0]
    p0.alignment = CENTER
    logo_path = os.path.join(HERE, "assets", "logo.png")
    if os.path.exists(logo_path):
        r0 = p0.add_run()
        r0.add_picture(logo_path, width=Mm(22), height=Mm(22))

    cell1 = t.rows[0].cells[1]
    set_cell_margins(cell1)
    p1 = cell1.paragraphs[0]
    p1.alignment = CENTER
    run = p1.add_run("CERTIFICATE OF CONFORMITY")
    run.bold = True
    run.font.size = Pt(16)
    run.font.color.rgb = NAVY

    # ---------- 2. Spacer ----------
    doc.add_paragraph()

    # ---------- 3. RAE No (centered) ----------
    p_rae = doc.add_paragraph()
    p_rae.alignment = CENTER
    run = p_rae.add_run("RAE No: ")
    run.bold = True
    run.font.size = Pt(16)
    run.font.color.rgb = NAVY
    run2 = p_rae.add_run(data.get("rae_no") or "")
    run2.font.size = Pt(16)

    # ---------- 4. Applicant / project info (key-value pairs) ----------
    def kv(label, value):
        p = doc.add_paragraph()
        p.alignment = LEFT
        r1 = p.add_run(f"{label} ")
        r1.bold = True
        r2 = p.add_run(value or "")
        return p

    kv("Name and address of Applicant:", data.get("applicant", ""))
    kv("Project Name:", data.get("project_name", ""))
    kv("Product Classification:", "Trailer Certification")
    kv("Certification was carried within following scope", "")
    kv("Australian Standards:", "")

    p_std = doc.add_paragraph()
    p_std.alignment = LEFT
    r = p_std.add_run("Standards are entered in the Summary of Compliance section.")
    r.font.size = Pt(9.5)

    p_note = doc.add_paragraph()
    p_note.alignment = LEFT
    r = p_note.add_run("The assessment process has been carried out in accordance with the individual rules and conditions agreed with the applicant.")
    r.font.size = Pt(9.5)

    kv("Valid till: 5 Years From issue date (Yearly Inspection required)", "")

    # ---------- 5. Revision table ----------
    rev_t = doc.add_table(rows=1, cols=4)
    rev_t.alignment = WD_TABLE_ALIGNMENT.CENTER
    rev_t.autofit = False
    headers = ["Revision", "Date", "Revision Details", "Prepared By"]
    for i, h in enumerate(headers):
        cell = rev_t.rows[0].cells[i]
        set_cell_margins(cell)
        set_cell_bg(cell, "95B3D7")
        p = cell.paragraphs[0]
        p.alignment = CENTER
        run = p.add_run(h)
        run.bold = True
        run.font.size = Pt(9)
        run.font.color.rgb = WHITE

    row = rev_t.add_row()
    for i in range(4):
        cell = row.cells[i]
        set_cell_margins(cell)
        cell.paragraphs[0].add_run("")

    # ---------- 6. 3-column table: CSA Engineering | Noel Singh | QR code ----------
    qr_png = make_qr_png("https://csaengineering.com.au/verify", 22)
    qr_buf = io.BytesIO(qr_png)

    info_t = doc.add_table(rows=1, cols=3)
    info_t.alignment = WD_TABLE_ALIGNMENT.CENTER
    info_t.autofit = False
    for row in info_t.rows:
        row.cells[0].width = Mm(58)
        row.cells[1].width = Mm(62)
        row.cells[2].width = Mm(47)

    c1 = info_t.rows[0].cells[0]
    set_cell_margins(c1)
    p = c1.paragraphs[0]
    p.alignment = LEFT
    r = p.add_run("CSA Engineering\nwww.csaengineering.com.au\ninfo@csaengineering.com.au\n8/8 Christensen Road, Stapylton Qld 4207.\nP: 0452 292 355")
    r.font.size = Pt(9)

    c2 = info_t.rows[0].cells[1]
    set_cell_margins(c2)
    p = c2.paragraphs[0]
    p.alignment = LEFT
    r = p.add_run("Noel Singh\nFellow IEAustCPEng RPEQ\n23862 NER")
    r.font.size = Pt(9)

    c3 = info_t.rows[0].cells[2]
    set_cell_margins(c3, top=0, bottom=0)
    p = c3.paragraphs[0]
    p.alignment = CENTER
    run = p.add_run()
    run.add_picture(qr_buf, width=Mm(22), height=Mm(22))

    qr_head_p = doc.add_paragraph()
    qr_head_p.alignment = CENTER
    r = qr_head_p.add_run("QR / verification code")
    r.bold = True
    r.font.size = Pt(9)

    # Keep the template editable: these rows are intentionally blank rather
    # than copying historic requirements into every newly downloaded report.
    doc.add_page_break()
    heading = doc.add_heading("Summary of Compliance", level=1)
    heading.alignment = LEFT
    summary = doc.add_table(rows=1, cols=4)
    summary.alignment = WD_TABLE_ALIGNMENT.CENTER
    summary.autofit = False
    summary_headers = ["No.", "Standard", "Compliance requirement", "Conformity"]
    summary_widths = [Mm(10), Mm(38), Mm(89), Mm(30)]
    for i, label in enumerate(summary_headers):
        cell = summary.rows[0].cells[i]
        cell.width = summary_widths[i]
        set_cell_margins(cell)
        set_cell_bg(cell, "95B3D7")
        p = cell.paragraphs[0]
        p.alignment = CENTER
        run = p.add_run(label)
        run.bold = True
        run.font.size = Pt(9)
    for number in range(1, 9):
        row = summary.add_row()
        values = [str(number), "", "", "Full Compliance"]
        for i, value in enumerate(values):
            cell = row.cells[i]
            cell.width = summary_widths[i]
            set_cell_margins(cell)
            p = cell.paragraphs[0]
            p.alignment = CENTER if i in (0, 3) else LEFT
            p.add_run(value)

    doc.add_page_break()
    heading = doc.add_heading("Requirements", level=1)
    heading.alignment = LEFT
    doc.add_paragraph("The following requirements apply for the trailer structural compliance as selected in the Summary of Compliance.")
    for number in range(1, 9):
        doc.add_paragraph(f"{number}. ")

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue(), []
