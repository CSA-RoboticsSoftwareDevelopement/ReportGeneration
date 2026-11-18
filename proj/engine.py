"""CSA-style trailer certification report engine (ADR 62/02 + AS4100).
Standard wording is fixed here (taken from the sample reports); users only supply the variable fields + images.
"""
import io, os, functools
from xml.sax.saxutils import escape
import qrcode
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, Flowable, KeepTogether)
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.utils import ImageReader
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, "assets", "logo.png")
FATIGUE = os.path.join(HERE, "assets", "fatigue.png")
AUSTRALIA_WATERMARK = os.path.join(HERE, "assets", "australia_silhouette.png")
NAVY, BLUE, HEAD = colors.HexColor("#00205B"), colors.HexColor("#4F81BD"), colors.HexColor("#95B3D7")
G = 9.81
W, H = A4
BAR = 18 * mm
FX, FW = BAR + 12 * mm, W - BAR - 12 * mm - 14 * mm          # frame x / width


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
    F("report_title", "Report title"),
    F("date", "Report date", "date"),
    F("atm", "ATM", "number", unit="kg"),
    F("axle_type", "Axle type", "select", "Dual Axle", ["Dual Axle", "Single Axle", "Tri Axle"]),
    F("trailer_type", "Trailer description", default="trailer"),
    F("rev", "Revision", default="R0"),
    F("rev_date", "Revision date", "date"),
    F("rev_details", "Revision details", default="Initial Release"),
    F("prepared_by", "Prepared by (initials)"),
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
    return [I(f"a{n}_load", "Load & constraints applied on the trailer", 85),
            I(f"a{n}_stress_img", f"Stress Distribution Plot for Analysis {n}", 75),
            I(f"a{n}_probe", "Stress Distribution Plot with the probe", 75),
            I(f"a{n}_disp", f"Displacement Plot for Analysis {n}", 75)]

SUMMARY_ROW_FIELDS = [F("conformity", "Default Conformity", "select", "Full Compliance", ["Full Compliance", "Fully Compliance"])]
for _i in range(10):
    SUMMARY_ROW_FIELDS.extend([
        F(f"summary_std_{_i}", f"Row {_i + 1} – Standard", "text"),
        F(f"summary_req_{_i}", f"Row {_i + 1} – Compliance Requirement", "textarea"),
        F(f"summary_conf_{_i}", f"Row {_i + 1} – Conformity", "select", "Full Compliance", ["Full Compliance", "Fully Compliance"]),
    ])

SECTIONS = [
    dict(id="cert", title="Certificate of Conformity", fields=[], images=[]),
    dict(id="title", title="Title page & Structural Certification", fields=[], images=[]),
    dict(id="summary", title="Summary of Compliance", fields=[], images=[]),
    dict(id="background", title="Background", fields=[], images=[I("bg_front", "3D Isometric Model in Autodesk Inventor - Front", 80), I("bg_back", "3D Isometric Model in Autodesk Inventor - Back", 80)]),
    dict(id="geometry", title="The geometry of the Trailer",
         fields=[F("length_mm", "Overall length", "number", unit="mm"), F("width_mm", "Overall width", "number", unit="mm"),
                 F("susp_mm", "Distance coupling to suspension", "number", unit="mm"),
                 F("geo_note", "Design note, e.g. stiffener plates / revisions (optional)", "textarea")],
         images=[I("geo_iso", "3D Isometric Model", 70), I("geo_top", "Top View showing the length and width of the trailer", 55), I("geo_side", "Side View showing the distance of suspension from coupling", 40)]),
    dict(id="requirements", title="Requirements", fields=[], images=[]),
    dict(id="preproc", title="Analysis - Pre-Processing data (FEA, material, mesh)",
         fields=[F("nodes", "Mesh nodes", "number"), F("elements", "Mesh elements", "number")],
         images=[I("mesh", "Meshed model", 100)]),
    dict(id="a1", title="Analysis 1 - Longitudinal Tension and Compression (14.2.1.1.1)", fields=analysis_fields(1), images=analysis_images(1)),
    dict(id="a2", title="Analysis 2 - Transverse Thrust (14.2.1.2.1)", fields=analysis_fields(2, "Hanger"), images=analysis_images(2)),
    dict(id="a3", title="Analysis 3 - Vertical Tension and Compression (14.2.1.3.1)", fields=analysis_fields(3, "Chassis"), images=analysis_images(3)),
    dict(id="a4", title="Analysis 4 - Drawbar Dynamic Test (14.2.2.1)",
         fields=[F("tow_mass", "Towing vehicle mass T", "number", "2", unit="t")] + analysis_fields(4),
         images=analysis_images(4)),
    dict(id="a5", title="Analysis 5 - Structural strength (AS4100)", fields=analysis_fields(5, "Chassis"),
         images=[I("a5_load", "Force acting on Chassis top surface & Spring Hangers", 85), I("a5_remote", "Remote Displacement at Coupling Mount holes and Spring Hanger Bracket", 70),
                 I("a5_react", "Reaction forces at Coupling and Spring Bracket respectively", 55), I("a5_stress_img", "Stress Distribution Plot for Analysis 5", 75),
                 I("a5_probe", "Stress Distribution Plot with the probe", 75), I("a5_disp", "Displacement Plot for Analysis 5", 75)]),
    dict(id="a6", title="Analysis 6 - Drawbar Safety Chain Attachment Points (14.4)",
         fields=[F("sc_t", "Plate / RHS thickness", "number", "10", unit="mm"), F("sc_d", "Hole clearance diameter", "number", "15", unit="mm"),
                 F("sc_n", "Number of bolts carrying chain", "number", "2"),
                 F("sc_weld", "Include weld check?", "select", "No", ["No", "Yes"]),
                 F("sc_leg", "Weld leg size", "number", "4", unit="mm"), F("sc_wlen", "Total weld length", "number", "300", unit="mm"),
                 F("sc_fuw", "Weld electrode tensile strength Fuw", "number", "410", unit="MPa")],
         images=[I("sc_img", "Safety chain mount", 60)]),
    dict(id="a7", title="Analysis 7 - Coupling attachment points",
         fields=[F("cp_n", "Number of coupling bolts", "number", "4"), F("cp_bolt", "Bolt size", default="M14"),
                 F("cp_t", "Coupling plate thickness", "number", "6", unit="mm"), F("cp_d", "Hole clearance diameter", "number", "15", unit="mm")],
         images=[]),
    dict(id="conclusion", title="Conclusion", fields=[], images=[]),
]

def schema():
    return dict(general=GENERAL, sections=SECTIONS)


# ----------------------------------------------------------------- styles
def _align(value, fallback=TA_LEFT):
    """Translate the UI's alignment labels into ReportLab constants."""
    return {"left": TA_LEFT, "center": TA_CENTER, "centre": TA_CENTER,
            "right": TA_RIGHT, "justify": TA_JUSTIFY}.get(str(value).lower(), fallback)


def ST(layout=None):
    layout = layout or {}
    body_align = _align(layout.get("text_align"), TA_JUSTIFY)
    heading_align = _align(layout.get("heading_align"), TA_LEFT)
    caption_align = _align(layout.get("caption_align"), TA_CENTER)
    b = dict(fontName="Helvetica", fontSize=9.5, leading=13, alignment=body_align, spaceAfter=6)
    return dict(
        body=ParagraphStyle("body", **b),
        h1=ParagraphStyle("h1", fontName="Helvetica", fontSize=15, leading=19, textColor=BLUE, alignment=heading_align, spaceBefore=4, spaceAfter=10),
        h2=ParagraphStyle("h2", fontName="Helvetica", fontSize=12, leading=15, textColor=BLUE, alignment=heading_align, spaceBefore=8, spaceAfter=6),
        cap=ParagraphStyle("cap", fontName="Helvetica-Bold", fontSize=8, leading=10, alignment=caption_align, spaceBefore=3, spaceAfter=8),
        cell=ParagraphStyle("cell", fontName="Helvetica", fontSize=8.5, leading=11),
        celb=ParagraphStyle("celb", fontName="Helvetica-Bold", fontSize=8.5, leading=11),
        big=ParagraphStyle("big", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=colors.black),
        title=ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=18, leading=23, textColor=BLUE, alignment=TA_CENTER, spaceAfter=14),
        li=ParagraphStyle("li", fontName="Helvetica", fontSize=9, leading=12, leftIndent=14, firstLineIndent=-14, textColor=NAVY, spaceAfter=3),
        warn=ParagraphStyle("warn", fontName="Helvetica-Bold", fontSize=9.5, leading=13, textColor=colors.HexColor("#B00020")),
    )


# ----------------------------------------------------------------- flowables
class Slot(Flowable):
    """Image slot: fills with the uploaded image, otherwise leaves a dashed blank box for later editing."""
    def __init__(self, data, label, h, align="center", offset_x=0, offset_y=0):
        super().__init__(); self.data, self.label, self.h = data, label, h * mm
        self.align, self.offset_x, self.offset_y = align, offset_x * mm, offset_y * mm
    def wrap(self, aw, ah):
        self.w = aw; return aw, self.h
    def draw(self):
        c = self.canv
        if self.data:
            try:
                ir = ImageReader(io.BytesIO(self.data)); iw, ih = ir.getSize()
                s = min(self.w / iw, self.h / ih); dw, dh = iw * s, ih * s
                factor = {"left": 0, "center": .5, "centre": .5, "right": 1}.get(str(self.align).lower(), .5)
                x = min(max((self.w - dw) * factor + self.offset_x, 0), max(self.w - dw, 0))
                y = min(max((self.h - dh) / 2 + self.offset_y, 0), max(self.h - dh, 0))
                c.drawImage(ir, x, y, dw, dh, mask="auto"); return
            except Exception:
                pass
        c.setStrokeColor(colors.HexColor("#9AA5B5")); c.setDash(4, 3); c.setLineWidth(0.8)
        c.rect(0, 0, self.w, self.h); c.setDash()
        c.setFillColor(colors.HexColor("#9AA5B5")); c.setFont("Helvetica-Oblique", 8.5)
        c.drawCentredString(self.w / 2, self.h / 2, f"[ IMAGE: {self.label} ]")


def make_qr_png(text, size_mm):
    """Generate a QR code PNG image as bytes."""
    qr = qrcode.QRCode(version=1, box_size=4, border=2)
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def first_page_watermark(canv, doc):
    """Paint the supplied Australia silhouette behind certificate page content."""
    if doc.page != 1 or not os.path.isfile(AUSTRALIA_WATERMARK):
        return
    canv.saveState()
    try:
        # Use a light alpha so the certificate's text, QR, and revision table
        # remain readable over the silhouette.
        canv.setFillAlpha(0.26)
    except (AttributeError, NotImplementedError):
        pass
    canv.drawImage(
        AUSTRALIA_WATERMARK,
        23 * mm,
        82 * mm,
        176 * mm,
        125 * mm,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )
    canv.restoreState()


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


_n = [0]
class CapField(Flowable):
    """Editable caption (AcroForm text field) used in the template PDF."""
    def __init__(self, text): super().__init__(); self.text = text
    def wrap(self, aw, ah): self.w = aw; return aw, 8 * mm
    def draw(self):
        _n[0] += 1
        self.canv.acroForm.textfield(name=f"caption_{_n[0]}", value=self.text, x=self.canv.absolutePosition(0, 1 * mm)[0], y=self.canv.absolutePosition(0, 1 * mm)[1], width=self.w, height=6 * mm,
            fontName="Helvetica-Bold", fontSize=8, textColor=colors.black, fillColor=colors.white, borderColor=colors.HexColor("#9AA5B5"),
            borderWidth=0.6, forceBorder=True)

class CellField(Flowable):
    """Editable blank table cell (AcroForm text field) used in the template PDF."""
    def __init__(self, w, name): super().__init__(); self.w, self.name = w, name
    def wrap(self, aw, ah): return self.w, 6 * mm
    def draw(self):
        self.canv.acroForm.textfield(name=self.name, value="", x=self.canv.absolutePosition(0, 0)[0], y=self.canv.absolutePosition(0, 0)[1], width=self.w, height=6 * mm, fontName="Helvetica", fontSize=8.5,
            textColor=colors.black, fillColor=colors.white, borderColor=colors.HexColor("#9AA5B5"), borderWidth=0.6, forceBorder=True)

class PageMarker(Flowable):
    """Marker flowable that records the page number a section starts on."""
    def __init__(self, section_id):
        super().__init__(); self.section_id = section_id
    def wrap(self, aw, ah):
        self.w = 0; self.h = 0; return 0, 0
    def draw(self):
        try:
            self.canv._section_pages[self.section_id] = self.canv.getPageNumber()
        except Exception:
            pass


class NumCanvas(rl_canvas.Canvas):
    def __init__(self, *a, meta=None, section_pages=None, **k):
        super().__init__(*a, **k); self._st = []; self.meta = meta or {}
        self._section_pages = section_pages if section_pages is not None else {}
    def showPage(self):
        self._st.append(dict(self.__dict__)); self._startPage()
    def save(self):
        n = len(self._st)
        for i, s in enumerate(self._st):
            self.__dict__.update(s); self.decor(i, n); super().showPage()
        super().save()
    def decor(self, i, n):
        c = self
        c.setFillColor(NAVY); c.rect(0, 0, BAR, H, stroke=0, fill=1)
        c.saveState(); c.translate(BAR / 2 + 3, H / 2); c.rotate(90); c.setFillColor(colors.white)
        c.setFont("Helvetica", 9); c.drawCentredString(0, 0, "CSA Engineering"); c.restoreState()
        if i == 0:
            return
        c.setFillColor(HEAD); c.rect(0, 28 * mm, BAR, 20 * mm, stroke=0, fill=1)
        c.setFillColor(colors.white); c.setFont("Helvetica", 11); c.drawCentredString(BAR / 2, 36 * mm, f"{i}/{n - 1}")
        c.drawImage(LOGO, FX, H - 33 * mm, 32 * mm, 17 * mm, mask="auto")
        c.setFillColor(colors.black); c.setFont("Helvetica", 8.5)
        for k, t in enumerate(["8/8 Christensen Road, Stapylton Qld 4207.", "E: info@csaengineering.com.au", "P: 0452 292 355", "www.csaengineering.com.au"]):
            c.drawString(FX + FW - 62 * mm, H - 17 * mm - k * 4.2 * mm, t)
        c.setFont("Helvetica", 8); c.drawString(FX, 12 * mm, self.meta.get("footer", ""))


# ----------------------------------------------------------------- builder
class Ctx:
    def __init__(self, data, images, template, layout=None, extras=None, removed=None):
        self.d, self.im, self.tpl, self.warn = data, images, template, []
        self.layout, self.s, self.active = layout or {}, ST(layout), None
        self.extras, self.removed = extras or {}, set(removed or [])
        self.labels = {f["id"]: f["label"] for f in GENERAL + [x for s in SECTIONS for x in s["fields"]]}
        self.defs = {f["id"]: f["default"] for f in GENERAL + [x for s in SECTIONS for x in s["fields"]]}
    def raw(self, k):
        v = str(self.d.get(k, "") if k in self.d else self.defs.get(k, "")).strip()
        return v
    def standards(self):
        """Return valid rows from the dynamic standards list submitted by the UI."""
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
    def ph(self, label):
        return f'<font color="#999999"><i>[ {escape(label)} ]</i></font>'
    def v(self, k):
        x = self.raw(k)
        # Browser date inputs submit YYYY-MM-DD; reports retain the conventional
        # DD-MM-YYYY presentation without changing the stored input value.
        if k in ("date", "rev_date") and len(x) == 10 and x[4:5] == "-" and x[7:8] == "-":
            x = f"{x[8:10]}-{x[5:7]}-{x[:4]}"
        return escape(x) if x else self.ph(self.labels.get(k, k))
    def n(self, k):
        try: return float(self.raw(k))
        except ValueError: return None
    def num(self, x, fmt="{:,.2f}", label="calc"):
        return fmt.format(x) if x is not None else self.ph(label)
    def P(self, t, st="body"):
        style = self.s[st]
        # A section heading may be renamed and positioned independently in Phase 3.
        if st == "h1" and self.active:
            replacement = self.raw("heading__" + self.active)
            if replacement:
                t = escape(replacement)
            position = self.raw("heading_align__" + self.active)
            if position and position != "inherit":
                style = style.clone("h1_" + self.active)
                style.alignment = _align(position, style.alignment)
        return Paragraph(t, style)
    def slot(self, sid, label, h):
        if sid in self.removed:
            return []
        if self.tpl:
            return [Slot(None, label, h), CapField(label)]
        # Issued reports and live previews are evidence-driven: a figure takes
        # up space only after the user has supplied its image.  The blank
        # template above deliberately retains its editable placeholder boxes.
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
        image = Slot(self.im.get(sid), cap, h, image_align, offset_x, offset_y)
        caption = self.P(escape(cap), "cap")
        return [caption, image] if caption_position == "above" else [image, caption]
    def extra_slots(self, section_id):
        """Extra figures added from the report builder for one report section."""
        out = []
        for item in self.extras.get(section_id, []):
            if not isinstance(item, dict) or not item.get("id"):
                continue
            image_id = str(item["id"])
            label = str(item.get("label") or "Additional figure")
            try:
                height = max(20, min(float(item.get("h", 75)), 140))
            except (TypeError, ValueError):
                height = 75
            out += self.slot(image_id, label, height)
        return out
    def tbl(self, rows, widths, head=True):
        t = Table(rows, colWidths=widths, repeatRows=1 if head else 0)
        sty = [("GRID", (0, 0), (-1, -1), 0.6, NAVY), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
        if head: sty.append(("BACKGROUND", (0, 0), (-1, 0), HEAD))
        t.setStyle(TableStyle(sty)); return t
    def check(self, name, stress, limit):
        if stress is None: return self.ph("stress"), ""
        sf = limit / stress if stress else 0
        if stress >= limit:
            self.warn.append(f"{name}: stress {stress:g} MPa >= limit {limit:g} MPa")
            return None, f'<font color="#B00020"><b>This exceeds the allowable value - engineer review required (safety factor {sf:.2f}).</b></font>'
        return True, f"Thus the design is safe with a safety factor of {sf:.2f}."


def atm_kg(c): return c.n("atm")

def sec_cert(c):
    s = c.s; out = []
    t = Table([[Slot(open(LOGO, "rb").read(), "logo", 22), Paragraph("CERTIFICATE OF CONFORMITY", s["big"])]], colWidths=[40 * mm, FW - 40 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")])); out += [t, Spacer(1, 14 * mm)]
    out += [Paragraph(f'<font color="#1F3864" size="16"><b>RAE No: {c.v("rae_no")}</b></font>', ParagraphStyle("c", alignment=TA_CENTER, leading=20)), Spacer(1, 12 * mm)]
    b = lambda k, v: c.P(f"<b>{k}</b> {v}")
    standards = c.standards()
    if c.tpl:
        standards_text = c.ph("Enter standards in Summary of Compliance")
    elif standards:
        standards_text = "<br/>".join(f"{i + 1}) <b>{escape(item['standard'])}</b>" for i, item in enumerate(standards) if item["standard"])
        standards_text = standards_text or c.ph("Add standards in the report builder")
    else:
        standards_text = c.ph("Add standards in the report builder")
    out += [b("Name and address of Applicant:", c.v("applicant")), b("Project Name:", c.v("project_name")), b("Product Classification:", "Trailer Certification"),
            b("Certification was carried within following scope", ""), b("Australian Standards:", ""),
            c.P(standards_text), Spacer(1, 6 * mm),
            c.P("The assessment process has been carried out in accordance with the individual rules and conditions agreed with the applicant."),
            b("Valid till: 5 Years From issue date (Yearly Inspection required)", ""), Spacer(1, 6 * mm)]
    out.append(c.tbl([[Paragraph(x, s["celb"]) for x in ["Revision", "Date", "Revision Details", "Prepared By"]],
                      [Paragraph(c.v(k), s["cell"]) for k in ["rev", "rev_date", "rev_details", "prepared_by"]]], [24 * mm, 28 * mm, FW - 24 * mm - 28 * mm - 28 * mm, 28 * mm]))
    out.append(Spacer(1, 22 * mm))
    left = c.P("CSA Engineering<br/>www.csaengineering.com.au<br/>info@csaengineering.com.au<br/>8/8 Christensen Road, Stapylton Qld 4207.<br/>P: 0452 292 355")
    mid = c.P("<font size=10.5>Noel Singh<br/>Fellow IEAustCPEng RPEQ<br/>23862 NER</font>")
    if "qr" in c.removed:
        qr = Spacer(FW - 120 * mm, 22 * mm)
    else:
        # The verification QR is a standard report element, not an optional
        # upload. An uploaded QR may replace it, but previews and downloaded
        # reports fall back to the same code used by the blank template.
        qr = Slot(c.im.get("qr") or make_qr_png("https://csaengineering.com.au/verify", 22), c.raw("cap__qr") or "QR", 22)
    t = Table([[left, mid, qr]], colWidths=[58 * mm, 62 * mm, FW - 120 * mm]); t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return out + [t, PageBreak()]

def sec_title(c):
    out = [Spacer(1, 25 * mm), c.P(c.v("report_title"), "title"), c.P(c.v("client")), c.P(c.v("date")),
           c.P('<font color="#4F81BD" size=13>ENGINEER:</font>'),
           c.P("Noel Singh<br/>Fellow IEAustCPEng RPEQ 23862 NER<br/>Composite Structures Australia Pty Ltd<br/>8/8 Christensen Road, Stapylton Qld 4207.<br/>www.csaengineering.com.au<br/>Ph: +614 52 292 355<br/>Email: info@csaengineering.com.au"),
           Spacer(1, 30 * mm), c.P("Structural Certification", "h2"),
           c.P(f"The trailer described in this report was analyzed for structural integrity as required by ADR 62/02. Professional engineers of Composite Structures Australia certify that the design can safely withstand an ATM of {c.v('atm')}kg. Check for static stresses and fatigue life as per ADR 62/02 and Australian Standard AS4100-1998 (2016)."),
           PageBreak()]
    return out

ROWS = [("ADR 62/02 - 14.2.1.1.1<br/>Static Design Load", "Longitudinal Tension and Compression<br/>For trailers up to 23.5 tonnes 'ATM', (N) 1.5 x 9.81 x 'ATM' (kg)"),
        ("ADR 62/02 - 14.2.1.2.1<br/>Static Design Load", "Transverse Thrust<br/>For trailers up to 4.5 tonnes 'ATM', (N) 0.5 x 9.81 x 'ATM' (kg)."),
        ("ADR 62/02 - 14.2.1.3.1<br/>Static Design Load", "Vertical Tension and Compression<br/>For trailers up to 4.5 tonnes 'ATM', (N) 0.5 x 9.81 x 'ATM' (kg)."),
        ("ADR 62/02 - 14.2.2<br/>Static Design Load", "'Drawbars' - Dynamic Testing<br/>'Drawbars' for other trailers, a horizontal oscillating force of (kN) +/- 0.6 x 'Coupling' 'D-value' (kN) in the longitudinal direction concurrently for at least 2 million cycles"),
        ("AS4100-1998-R2016", "The structural strength of the trailer apart from ADR62/02"),
        ("ADR 62/02 - 14.4", "'Drawbar' Safety Chain Attachment Points<br/>Longitudinal tension (N) = 9.81 x 'ATM' (kg); and vertical tension (N) = 0.5 x 9.81 x 'ATM' (kg)."),
        ("AS4100-1998-R2016", "Coupling attachment points - Coupling plate bolt holes strength")]

def sec_summary(c):
    s = c.s
    rows = [[Paragraph(x, s["celb"]) for x in ["No.", "Standard", "Compliance requirement", "Conformity"]]]
    standards = c.standards()
    widths = [10 * mm, 38 * mm, FW - 10 * mm - 38 * mm - 30 * mm, 30 * mm]
    if c.tpl:
        for i in range(8):
            rows.append([Paragraph(str(i + 1), s["cell"]), CellField(widths[1] - 4, f"standard_{i + 1}"), CellField(widths[2] - 4, f"requirement_{i + 1}"), CellField(widths[3] - 4, f"conformity_{i + 1}")])
    elif standards:
        for i, item in enumerate(standards):
            std = escape(item["standard"]).replace("\n", "<br/>")
            req = escape(item["requirement"]).replace("\n", "<br/>")
            cnf = escape(item["conformity"])
            rows.append([Paragraph(str(i + 1), s["cell"]), Paragraph(std, s["cell"]), Paragraph(req, s["cell"]), Paragraph(cnf, s["cell"])])
    else:
        rows.append([Paragraph("", s["cell"]), Paragraph(c.ph("add standards in the report builder"), s["cell"]), Paragraph("", s["cell"]), Paragraph("", s["cell"])])
    return [c.P("Summary of Compliance", "h1"), c.tbl(rows, widths), PageBreak()]

def sec_background(c):
    return [c.P("Background", "h1"),
            c.P(f"Structural analysis and certification services are required for a new build chassis and internal carrying member's design and analysis of a {c.v('trailer_type')}. The trailer requires certification as a {c.v('axle_type')} trailer type {c.v('atm')}kg ATM."),
            c.P("3D isometric images of an actual trailer from Autodesk Inventor software identify this product."), Spacer(1, 4 * mm)] \
        + c.slot("bg_front", "3D Isometric Model in Autodesk Inventor - Front", 80) + c.slot("bg_back", "3D Isometric Model in Autodesk Inventor - Back", 80) + [PageBreak()]

def sec_geometry(c):
    s = c.s
    out = [c.P("The geometry of the Trailer", "h1"),
           c.P(f"{c.v('client')} has provided the required 3D geometric data that was required for the structural analysis of the trailer. Shown following are the dimensions of the major structural members of the trailer which was used for the analysis.")]
    if c.raw("geo_note"): out.append(c.P(escape(c.raw("geo_note"))))
    out.append(c.tbl([[Paragraph(x, s["celb"]) for x in ["Overall length", "Overall width", "Coupling to suspension"]],
                      [Paragraph(f"{c.v(k)} mm", s["cell"]) for k in ["length_mm", "width_mm", "susp_mm"]]], [FW / 3] * 3))
    out.append(Spacer(1, 4 * mm))
    return out + c.slot("geo_iso", "3D Isometric Model", 70) + c.slot("geo_top", "Top View showing the length and width of the trailer", 55) + c.slot("geo_side", "Side View showing the distance of suspension from coupling", 40) + [PageBreak()]

REQ = ["ADR 62/02- Clause 14.2.1.1.1: Longitudinal Tension and Compression For Trailers up to 23.5 tonnes 'ATM' other than 'Converter Dollies', (N) - 1.5 x 9.81 x 'ATM' (kg)",
       "ADR 62/02- Clause 14.2.1.2.1: Transverse Thrust For trailers up to 4.5 tonnes 'ATM', (N) 0.5 x 9.81 x 'ATM' (kg)",
       "ADR 62/02- Clause 14.2.1.3.1: Vertical Tension and Compression For trailers up to 4.5 tonnes 'ATM', (N) 0.5 x 9.81 x 'ATM' (kg)",
       "ADR 62/02- Clause 14.2.2.1: 'Drawbars'- Dynamic Testing 'Drawbars' for other trailers, a horizontal oscillating force of (kN) +/- 0.6 x 'Coupling' 'D-value' (kN) in the longitudinal direction concurrently for at least 2 million cycles.",
       "AS 4100-1998-R2016: Structural strength of the trailer not covered in the ADR 62/02 for maximum load condition",
       "ADR 62/02- Clause 14.4. 'Drawbars' - Safety Chain Attachment Points<br/>14.4.1. Any safety chain attachment point affixing a safety chain to a 'Drawbar' must be located as near as practicable to the 'Coupling'. Where two points of attachment are required, they must be mounted one on either side of the centerline of the 'Drawbar'.<br/>14.4.2. Any safety chain attachment point affixing a safety chain to a 'Drawbar' must withstand at least the following forces, separately applied, without incurring either any residual deformation that would interfere or degrade the function of the assembly or any breaks, cracks or separation of the components. The static forces must be maintained for not less than 10 seconds:<br/>14.4.2.1. Longitudinal tension (N) = 9.81 x 'ATM' (kg); and<br/>14.4.2.2. vertical tension (N) = 0.5 x 9.81 x 'ATM' (kg).",
       "Coupling mount check"]

def sec_req(c):
    out = [c.P("Requirements", "h1"), c.P("The following requirements apply for the trailer structural compliance as selected in the Summary of Compliance.")]
    standards = c.standards()
    if c.tpl:
        for i in range(8):
            out.append(Table([[Paragraph(f"{i + 1}.", c.s["li"]), CellField(FW - 18 * mm, f"requirement_note_{i + 1}")]], colWidths=[14 * mm, FW - 14 * mm], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")])))
    elif standards:
        for i, item in enumerate(standards):
            text = item["requirement"] or item["standard"]
            out.append(Paragraph(f"{i + 1}. {escape(text).replace(chr(10), '<br/>')}", c.s["li"]))
    else:
        out.append(c.P(c.ph("Add standards in the Summary of Compliance section.")))
    return out + [PageBreak()]

def sec_pre(c):
    s = c.s
    mat = [[Paragraph(x, s["celb"]) for x in ["Material", "Tensile Strength (MPa)", "Yield Strength (MPa)", "Young's Modulus (GPa)", "Poisson's Ratio", "Density (kg/m^3)"]],
           ]
    ws = [FW * x for x in (.24, .16, .16, .16, .14, .14)]
    keys = ["material", "fu", "fy", "young", "nu", "rho"]
    mat.append([CellField(w - 4, f"mat_{k}") if c.tpl else Paragraph(escape(c.raw(k)), s["cell"]) for w, k in zip(ws, keys)])
    return [c.P("Analysis- Pre-Processing data", "h1"),
            c.P("The trailer is analyzed using the finite element analysis technique. The software used for analysis is ANSYS Workbench which is used in the automotive industry for over a decade. 3D elements have been used in modelling as these are the most appropriate for static structural analysis."),
            c.P("Material", "h2"), c.P("The material used for the analysis with the following mechanical properties is given in the below table."),
            c.tbl(mat, ws), Spacer(1, 6 * mm), c.P("Meshing", "h2"),
            c.P(f"The fine mesh was created with the number of nodes as {c.v('nodes')} and the number of elements as {c.v('elements')}. Shown below are some images of the finite element model that was used for the analysis.")] \
        + c.slot("mesh", "Meshed model", 100) + [PageBreak()]

STATIC = {1: ("14.2.1.1.1", "Longitudinal Tension and Compression", 1.5, "coupling holes in the longitudinal direction"),
          2: ("14.2.1.2.1", "Transverse Thrust", 0.5, "coupling holes in the transverse direction"),
          3: ("14.2.1.3.1", "Vertical Tension and Compression", 0.5, "coupling holes in the vertical direction (with an equal downward force on the chassis)")}

def results(c, n, limit_label="yield strength", limit=None):
    fy = limit if limit is not None else c.n("fy")
    st, de = c.n(f"a{n}_stress"), c.n(f"a{n}_def")
    ok, tail = c.check(f"Analysis {n}", st, fy) if fy else (None, "")
    out = [c.P(f"As per the result shown in the stress distribution plot, neglecting local stresses, the max stress of {c.num(st, '{:g}', 'stress')} MPa was found on the {c.v(f'a{n}_loc')}, which is {'less than' if ok else 'compared with'} the yield strength of material {c.v('material')} which is {c.v('fy')} MPa. {tail}")]
    if c.raw(f"a{n}_note"): out.append(c.P(escape(c.raw(f"a{n}_note"))))
    return out, de

def sec_static(n):
    def f(c):
        clause, title, fac, where = STATIC[n]; atm = atm_kg(c)
        force = c.num(fac * G * atm, "{:,.0f}", "force") if atm else c.ph(f"{fac} x 9.81 x ATM")
        out = [c.P(f"ANALYSIS {n} (ADR 62/02- {clause}) - {title}", "h1"),
               c.P(f"Trailer restraint and the force applied as shown in the below image. The applied force is {force} N as per clause {clause} of ADR 62/02 i.e., {fac} x 9.81 x {c.v('atm')} kg, applied on the {where}. All hanger holes faces are fixed in all DOF.")]
        out += c.slot(f"a{n}_load", "Load & constraints applied on the trailer", 85) + c.slot(f"a{n}_stress_img", f"Stress Distribution Plot for Analysis {n}", 75)
        out.append(PageBreak())
        out += c.slot(f"a{n}_probe", "Stress Distribution Plot with the probe", 75)
        r, de = results(c, n); out += r
        out += c.slot(f"a{n}_disp", f"Displacement Plot for Analysis {n}", 75)
        out.append(c.P(f"As shown above, the following is the deformation of the structure under the Analysis {n} loading condition. The maximum deformation is {c.num(de, '{:g}', 'deformation')} mm."))
        return out + [PageBreak()]
    return f

def sec_a4(c):
    T, C = c.n("tow_mass"), (atm_kg(c) / 1000 if atm_kg(c) else None)
    dc = G * T * C / (T + C) if T and C else None
    out = [c.P("ANALYSIS 4 (ADR 62/02- 14.2.2.1)- Drawbar Dynamic Test", "h1"),
           c.P(f"The D-value for the trailer is {c.num(dc, '{:.3f}', 'D-value')} kN. The force applied is 0.6 x Coupling D-value = 0.6 x {c.num(dc, '{:.3f}', 'D-value')} x 10<super>3</super> = {c.num(dc * 600 if dc else None, '{:,.1f}', 'force')} N."),
           c.P("D-value for this trailer is calculated as shown:<br/>D<sub>C</sub> = g . (T x C)/(T + C) (from AS2213.4:2008- 5.1)<br/>"
               f"Here, T = maximum design total mass in tonnes of the towing vehicle = {c.v('tow_mass')} t<br/>C = mass in tonnes transmitted to the ground by the axle of the centre-axle trailer loaded to its maximum design total mass = {c.num(C, '{:g}', 'ATM/1000')} t<br/>"
               f"Therefore, D<sub>C</sub> = 9.81 x ({c.v('tow_mass')} x {c.num(C, '{:g}', 'C')})/({c.v('tow_mass')} + {c.num(C, '{:g}', 'C')}) = {c.num(dc, '{:.3f}', 'D-value')} kN")]
    out += c.slot("a4_load", "Load & constraints applied on the trailer", 85) + c.slot("a4_stress_img", "Stress Distribution Plot for Analysis 4", 75) + [PageBreak()]
    out += c.slot("a4_probe", "Stress Distribution Plot with the probe", 75)
    st = c.n("a4_stress"); fy = c.n("fy"); fat = 82.0
    verdict = ""
    if st is not None:
        if st <= fat: verdict = "Thus, the trailer can withstand more than 2 million cycles."
        else:
            verdict = '<font color="#B00020"><b>This exceeds the 82 MPa fatigue limit - engineer review required.</b></font>'; c.warn.append(f"Analysis 4: stress {st:g} MPa > 82 MPa fatigue limit")
    out.append(c.P(f"As per result, neglecting local stress the max stress induced in the drawbar of the trailer is {c.num(st, '{:g}', 'stress')} MPa, which is lower than the allowable yield limit of {c.v('fy')} MPa. The fatigue limit of 2 million cycles for {c.v('material')} material as per AS4100-1998, clause 11.6, is 82 MPa. {verdict or c.ph('verdict')}"))
    if c.raw("a4_note"): out.append(c.P(escape(c.raw("a4_note"))))
    out += [Slot(open(FATIGUE, "rb").read(), "Fatigue", 80), c.P("Fatigue Criteria as stated in AS4100-1998", "cap")]
    out += c.slot("a4_disp", "Displacement Plot for Analysis 4", 75)
    out.append(c.P(f"As shown above, the following is the deformation of the structure under the Analysis 4 loading condition. The maximum deformation is {c.num(c.n('a4_def'), '{:g}', 'deformation')} mm."))
    return out + [PageBreak()]

def sec_a5(c):
    a = atm_kg(c)
    v1 = G * a if a else None
    out = [c.P("ANALYSIS 5 (AS4100-1998 2016) - Structural strength of the trailer", "h1"),
           c.P(f"For {c.v('atm')}kg ATM was used for this load case in the chassis. The structural members of the trailer are analyzed with 1G vertical load & 1G Horizontal load applied simultaneously to check the structural integrity of the trailer as per AS 4100-1998."),
           c.P(f"As shown below following is the distributed loading applied to the trailer and the restraints. This loading is the worst-case scenario in practical application. 1G vertical load = {c.num(v1, '{:,.0f}', 'load')} N; "
               f"total forward & downward force (resultant of 1G vertical and 1G horizontal) = {c.num(v1 * 2 ** .5 if v1 else None, '{:,.0f}', 'load')} N; "
               f"braking force (0.8 x 9.81 x ATM) = {c.num(0.8 * v1 if v1 else None, '{:,.0f}', 'load')} N.")]
    out += c.slot("a5_load", "Force acting on Chassis top surface & Spring Hangers", 85) + [PageBreak()] + c.slot("a5_remote", "Remote Displacement at Coupling Mount holes and Spring Hanger Bracket", 70)
    out += c.slot("a5_react", "Reaction forces at Coupling and Spring Bracket respectively", 55) + [PageBreak()]
    out += c.slot("a5_stress_img", "Stress Distribution Plot for Analysis 5", 75) + c.slot("a5_probe", "Stress Distribution Plot with the probe", 75)
    r, de = results(c, 5); out += r
    out += [PageBreak()] + c.slot("a5_disp", "Displacement Plot for Analysis 5", 75)
    out.append(c.P(f"As shown above, the following is the deformation of the structure under the Analysis 5 loading condition. The maximum deformation is {c.num(de, '{:g}', 'deformation')} mm."))
    return out + [PageBreak()]

def sec_a6(c):
    a, t, d, nb, fy = atm_kg(c), c.n("sc_t"), c.n("sc_d"), c.n("sc_n"), c.n("fy")
    F_ = G * a if a else None
    per = F_ / nb if F_ and nb else None
    br = per / (t * d) if per and t and d else None
    out = [c.P("ANALYSIS 6 (ADR 62/02- 14.4) - 'Drawbar' Safety Chain Attachment Points", "h1"),
           c.P("The chain will be fitted on either side of the center line of the drawbar, which satisfies ADR62/02 - 14.4.1.")]
    if c.raw("sc_weld") == "Yes":
        leg, L, fuw = c.n("sc_leg"), c.n("sc_wlen"), c.n("sc_fuw")
        cap = 0.36 * fuw * 0.707 * leg if fuw and leg else None
        tot = cap * L if cap and L else None
        out.append(c.P(f"The safety chain mount is welded to the drawbar. The weld is a {c.v('sc_leg')}mm fillet weld, total weld length {c.v('sc_wlen')}mm, GP weld with E41/W40 electrode (nominal tensile stress {c.v('sc_fuw')} MPa). "
                       f"Load capacity of the joint = 0.36 x Fuw x tt x kr = 0.36 x {c.v('sc_fuw')} x (0.707 x {c.v('sc_leg')}) x 1.0 = {c.num(cap, '{:.2f}', 'cap')} N/mm. "
                       f"Total load capacity of the welded joint = {c.num(cap, '{:.2f}', 'cap')} x {c.v('sc_wlen')} = {c.num(tot, '{:,.0f}', 'cap')} N."))
        if tot and F_:
            if tot >= F_: out.append(c.P("As the required weld strength is less than the total load capacity of the welded joint, the welding joint is passing."))
            else:
                c.warn.append("Analysis 6: weld capacity below chain load"); out.append(c.P("<b>The weld capacity is below the required load - engineer review required.</b>", "warn"))
    verdict = ""
    if br is not None and fy:
        if br < fy: verdict = f"The allowable stress for the material is {c.v('fy')} MPa. Thus, the safety chain mount is passing (safety factor {fy / br:.2f})."
        else: verdict = "<b>The bearing stress exceeds the allowable stress - engineer review required.</b>"; c.warn.append("Analysis 6: bearing stress >= allowable")
    out += [c.P(f"The longitudinal tension of 9.81 x 'ATM' kg is {c.num(F_, '{:,.0f}', 'force')} N (vertical tension 0.5 x 9.81 x 'ATM' = {c.num(F_ / 2 if F_ else None, '{:,.0f}', 'force')} N). As {c.v('sc_n')} bolt(s) will be supporting the safety chain, the force per bolt is {c.num(per, '{:,.0f}', 'force')} N. The plate thickness is {c.v('sc_t')}mm."),
            c.P(f"The compressive (bearing) stress induced per bolt = longitudinal force per bolt / (thickness x hole clearance) = {c.num(per, '{:,.0f}', 'force')} / ({c.v('sc_t')} x {c.v('sc_d')}) = {c.num(br, '{:.1f}', 'stress')} MPa"),
            c.P(verdict or c.ph("verdict"))]
    return out + c.slot("sc_img", "Safety chain mount", 60) + [PageBreak()]

def sec_a7(c):
    a, n, t, d, fy = atm_kg(c), c.n("cp_n"), c.n("cp_t"), c.n("cp_d"), c.n("fy")
    F_ = 1.5 * G * a if a else None
    per = F_ / n if F_ and n else None
    br = per / (t * d) if per and t and d else None
    v = ""
    if br is not None and fy:
        if br < fy: v = f"The allowable stress for the material {c.v('material')} is {c.v('fy')} MPa (safety factor {fy / br:.2f})."
        else: v = "<b>The bearing stress exceeds the allowable stress - engineer review required.</b>"; c.warn.append("Analysis 7: bearing stress >= allowable")
    return [c.P("ANALYSIS 7 - Coupling", "h1"),
            c.P(f"The pulling force at 1.5G (1.5 x 9.81 x 'ATM' kg) is {c.num(F_, '{:,.0f}', 'force')} N. As there are {c.v('cp_n')} bolts, this force per bolt is {c.num(per, '{:,.2f}', 'force')} N. The thickness of the coupling plate is {c.v('cp_t')} mm and the bolt size is {c.v('cp_bolt')}."),
            c.P(f"The compressive stress induced per bolt = {c.num(per, '{:,.2f}', 'force')} / (Plate thickness x Hole clearance) = {c.num(per, '{:,.2f}', 'force')} / ({c.v('cp_t')} x {c.v('cp_d')}) = {c.num(br, '{:.2f}', 'stress')} MPa"),
            c.P(v or c.ph("verdict")), PageBreak()]

def sec_concl(c):
    return [c.P("CONCLUSION", "h1"), c.P("The trailer fully complies with ADR 62/02 and AS 4100-1998."),
            c.P("The analysis conducted assumes a new trailer with no material degradation and material are homogenous. Exposure to environmental effects in service may significantly reduce the material's strength capacity to support the full ATM of the trailer. Care must be taken as the trailer will not be able to perform to its full capacity in degraded (e.g., corroded) conditions and an inspection for safety reassessment should be organized by the equipment owner.")]

BUILD = dict(cert=sec_cert, title=sec_title, summary=sec_summary, background=sec_background, geometry=sec_geometry,
             requirements=sec_req, preproc=sec_pre, a1=sec_static(1), a2=sec_static(2), a3=sec_static(3),
             a4=sec_a4, a5=sec_a5, a6=sec_a6, a7=sec_a7, conclusion=sec_concl)


def build(data=None, images=None, selected=None, template=False, layout=None, extras=None, removed=None):
    """Returns (pdf_bytes, warnings). template=True -> blank placeholders everywhere."""
    data = {} if template else (data or {})
    c = Ctx(data, images or {}, template, layout, extras, removed)
    ids = selected or [s["id"] for s in SECTIONS]
    section_pages = {}
    story = []
    for s in SECTIONS:
        if s["id"] in ids:
            c.active = s["id"]
            # An optional browser-preview override gives an editor full control
            # of a section's wording while retaining its editable figures.
            custom_body = c.raw("body__" + s["id"])
            
            if custom_body and not template:
                section_heading = c.raw("heading__" + s["id"]) or s["title"]
                section_story = [PageMarker(s["id"]), c.P(escape(section_heading), "h1")]
                for paragraph in custom_body.replace("\r\n", "\n").split("\n\n"):
                    text = paragraph.strip()
                    if text:
                        section_story.append(c.P(escape(text).replace("\n", "<br/>")))
                for image_info in s["images"]:
                    section_story += c.slot(image_info["id"], image_info["label"], image_info["h"])
                section_story.append(PageBreak())
            else:
                section_story = [PageMarker(s["id"])] + BUILD[s["id"]](c)
                custom_heading = c.raw("heading__" + s["id"])
                if custom_heading and not template:
                    for flowable in section_story:
                        if isinstance(flowable, Paragraph) and flowable.style.name == "h1":
                            flowable.text = escape(custom_heading)
                            break
            added_figures = c.extra_slots(s["id"])
            if added_figures:
                ends_page = bool(section_story and isinstance(section_story[-1], PageBreak))
                if ends_page:
                    section_story.pop()
                section_story += added_figures
                if ends_page:
                    section_story.append(PageBreak())
            story += section_story
    while story and isinstance(story[-1], PageBreak): story.pop()
    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=A4, title=c.raw("project_name") or "Trailer Certification Report", author="CSA Engineering")
    doc.addPageTemplates([PageTemplate("p", frames=[Frame(FX, 20 * mm, FW, H - 20 * mm - 38 * mm, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=first_page_watermark)])
    foot = f"{c.raw('rae_no') or 'RAE'} | {c.raw('report_title') or 'Trailer Certification Report'}"
    canvas = functools.partial(NumCanvas, meta={"footer": foot}, section_pages=section_pages)
    doc.build(story, canvasmaker=canvas)
    out = buf.getvalue()
    if template:                                   # tidy the form PDF (removes duplicate /Font keys)
        from pypdf import PdfReader, PdfWriter
        w = PdfWriter(clone_from=PdfReader(io.BytesIO(out))); b2 = io.BytesIO(); w.write(b2); out = b2.getvalue()
    return out, c.warn, section_pages


def _build_word_editable_legacy(data=None, images=None, selected=None, template=False, layout=None, extras=None, removed=None):
    """Create a .docx companion report identically matching the generated PDF report.

    Everything remains identical to the PDF:
    - Same structure, text, headers, footers, margins (FX=30mm left, 14mm right)
    - Full sidebar (CSA Engineering) on pages
    - Top right company details and logo header
    - Formatted tables with exact background colors (#95B3D7), borders, and column widths
    - Embedded images and formatted dashed image slots matching the PDF exactly
    - Page breaks in the exact same positions as the PDF
    """
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.shared import Mm, Pt, RGBColor
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from PIL import Image, ImageDraw
    import html as py_html
    import re

    data = data or {}
    images = images or {}
    layout = layout or {}
    extras = extras or {}
    removed = set(removed or [])

    # Instantiate the same builder Context as used for PDF generation
    c = Ctx(data, images, template, layout, extras, removed)
    warns = list(c.warn)

    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Mm(210), Mm(297)
    section.left_margin = Mm(30)
    section.right_margin = Mm(14)
    section.top_margin = Mm(34)
    section.bottom_margin = Mm(20)
    section.different_first_page_header_footer = True

    # Styling helper maps
    word_align = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "centre": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
        "justify": WD_ALIGN_PARAGRAPH.JUSTIFY
    }
    def to_word_align(rl_align):
        if rl_align == TA_CENTER:
            return WD_ALIGN_PARAGRAPH.CENTER
        elif rl_align == TA_RIGHT:
            return WD_ALIGN_PARAGRAPH.RIGHT
        elif rl_align == TA_JUSTIFY:
            return WD_ALIGN_PARAGRAPH.JUSTIFY
        return WD_ALIGN_PARAGRAPH.LEFT

    NAVY_HEX = "00205B"
    HEAD_HEX = "95B3D7"
    BLUE_COLOR = RGBColor(0x4F, 0x81, 0xBD)
    NAVY_COLOR = RGBColor(0x00, 0x20, 0x5B)
    GRAY_COLOR = RGBColor(0x99, 0x99, 0x99)
    RED_COLOR = RGBColor(0xB0, 0x00, 0x20)
    DARK_BLUE_COLOR = RGBColor(0x1F, 0x38, 0x64)

    def set_cell_background(cell, hex_color):
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), hex_color)
        tcPr.append(shd)

    def set_cell_borders(cell, color=NAVY_HEX, sz="4", val="single"):
        tcPr = cell._tc.get_or_add_tcPr()
        tcBorders = OxmlElement("w:tcBorders")
        for border_name in ("top", "left", "bottom", "right"):
            border = OxmlElement(f"w:{border_name}")
            border.set(qn("w:val"), val)
            border.set(qn("w:sz"), sz)
            border.set(qn("w:space"), "0")
            border.set(qn("w:color"), color)
            tcBorders.append(border)
        tcPr.append(tcBorders)

    def set_cell_margins(cell, top=60, bottom=60, left=100, right=100):
        tcPr = cell._tc.get_or_add_tcPr()
        tcMar = OxmlElement("w:tcMar")
        for m, v in (("top", top), ("bottom", bottom), ("left", left), ("right", right)):
            node = OxmlElement(f"w:{m}")
            node.set(qn("w:w"), str(v))
            node.set(qn("w:type"), "dxa")
            tcMar.append(node)
        tcPr.append(tcMar)

    def add_floating_picture(paragraph, img_source, left_mm, top_mm, width_mm, height_mm, behind_doc=True):
        """Anchor a drawing shape absolutely to the page coordinates."""
        r = paragraph.add_run()
        if isinstance(img_source, (bytes, bytearray)):
            stream = io.BytesIO(img_source)
        elif hasattr(img_source, "read"):
            stream = img_source
        else:
            stream = img_source
        inline = r.add_picture(stream, width=Mm(width_mm), height=Mm(height_mm))._inline
        anchor = OxmlElement("wp:anchor")
        for k, v in [
            ("distT", "0"), ("distB", "0"), ("distL", "0"), ("distR", "0"),
            ("simplePos", "0"), ("relativeHeight", "0"),
            ("behindDoc", "1" if behind_doc else "0"),
            ("locked", "0"), ("layoutInCell", "1"), ("allowOverlap", "1")
        ]:
            anchor.set(k, v)
        simple_pos = OxmlElement("wp:simplePos")
        simple_pos.set("x", "0")
        simple_pos.set("y", "0")
        pos_h = OxmlElement("wp:positionH")
        pos_h.set("relativeFrom", "page")
        pos_h_offset = OxmlElement("wp:posOffset")
        pos_h_offset.text = str(int(left_mm * 36000))
        pos_h.append(pos_h_offset)

        pos_v = OxmlElement("wp:positionV")
        pos_v.set("relativeFrom", "page")
        pos_v_offset = OxmlElement("wp:posOffset")
        pos_v_offset.text = str(int(top_mm * 36000))
        pos_v.append(pos_v_offset)

        effect = OxmlElement("wp:effectExtent")
        for n in ("l", "t", "r", "b"):
            effect.set(n, "0")
        wrap_none = OxmlElement("wp:wrapNone")
        children = {child.tag: child for child in inline}
        anchor.extend([
            simple_pos, pos_h, pos_v, children[qn("wp:extent")],
            effect, wrap_none, children[qn("wp:docPr")],
            children[qn("wp:cNvGraphicFramePr")], children[qn("a:graphic")]
        ])
        inline.getparent().replace(inline, anchor)

    def make_placeholder_image(label, width_px=900, height_px=360):
        img = Image.new("RGB", (width_px, height_px), color=(255, 255, 255))
        draw = ImageDraw.Draw(img)
        dash_len, gap_len = 10, 6
        border_col = (154, 165, 181)
        for x in range(0, width_px, dash_len + gap_len):
            draw.line([(x, 0), (min(x + dash_len, width_px), 0)], fill=border_col, width=2)
            draw.line([(x, height_px - 1), (min(x + dash_len, width_px), height_px - 1)], fill=border_col, width=2)
        for y in range(0, height_px, dash_len + gap_len):
            draw.line([(0, y), (0, min(y + dash_len, height_px))], fill=border_col, width=2)
            draw.line([(width_px - 1, y), (width_px - 1, min(y + dash_len, height_px))], fill=border_col, width=2)

        text = f"[ IMAGE: {label} ]"
        try:
            bbox = draw.textbbox((0, 0), text)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            draw.text(((width_px - tw) / 2, (height_px - th) / 2), text, fill=border_col)
        except Exception:
            draw.text((20, height_px // 2 - 10), text, fill=border_col)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    # Configure headers and footers
    # 1. First page header: watermark
    add_word_first_page_watermark(doc, section)

    # 2. Subsequent pages header: Navy vertical bar, Logo, CSA contact info
    header = section.header
    hp = header.paragraphs[0]
    hp.paragraph_format.space_before = Pt(0)
    hp.paragraph_format.space_after = Pt(0)
    hp.paragraph_format.line_spacing = Pt(12)

    sidebar_path = os.path.join(HERE, "assets", "csa_sidebar.png")
    if os.path.isfile(sidebar_path):
        add_floating_picture(hp, sidebar_path, 0, 0, 18, 297, behind_doc=True)
    if os.path.isfile(LOGO):
        add_floating_picture(hp, LOGO, 30, 8, 32, 17, behind_doc=False)

    # Company contact block at top right (x=134mm, y=8mm)
    hrun = hp.add_run(
        "8/8 Christensen Road, Stapylton Qld 4207.\n"
        "E: info@csaengineering.com.au\n"
        "P: 0452 292 355\n"
        "www.csaengineering.com.au"
    )
    hrun.font.name = "Arial"
    hrun.font.size = Pt(8.5)
    hrun.font.color.rgb = RGBColor(0, 0, 0)
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    # 3. Footer: Report title / RAE No. left, page number right
    foot_text = f"{c.raw('rae_no') or 'RAE'} | {c.raw('report_title') or 'Trailer Certification Report'}"
    footer = section.footer
    fp = footer.paragraphs[0]
    fp.paragraph_format.space_before = Pt(0)
    fp.paragraph_format.space_after = Pt(0)
    frun1 = fp.add_run(foot_text + "\t")
    frun1.font.name = "Arial"
    frun1.font.size = Pt(8)
    frun1.font.color.rgb = RGBColor(0x33, 0x33, 0x33)

    # Add dynamic Word page number: Page X of Y
    fld1 = OxmlElement("w:fldSimple")
    fld1.set(qn("w:instr"), "PAGE")
    fp._p.append(fld1)
    frun2 = fp.add_run(" / ")
    frun2.font.name = "Arial"
    frun2.font.size = Pt(8)
    fld2 = OxmlElement("w:fldSimple")
    fld2.set(qn("w:instr"), "NUMPAGES")
    fp._p.append(fld2)

    def render_html_to_paragraph(p, html_text, base_font_size=Pt(9.5), base_color=None, base_bold=False):
        if not html_text:
            return
        tokens = re.split(r"(<[^>]+>)", html_text)
        bold_stack = [base_bold]
        italic_stack = [False]
        color_stack = [base_color]
        size_stack = [base_font_size]
        sub_stack = [False]
        sup_stack = [False]

        for token in tokens:
            if not token:
                continue
            lower_token = token.lower()
            if lower_token.startswith("<"):
                if lower_token in ("<br>", "<br/>", "<br />"):
                    p.add_run("\n")
                elif lower_token in ("<b>", "<strong>"):
                    bold_stack.append(True)
                elif lower_token in ("</b>", "</strong>"):
                    if len(bold_stack) > 1:
                        bold_stack.pop()
                elif lower_token in ("<i>", "<em>"):
                    italic_stack.append(True)
                elif lower_token in ("</i>", "</em>"):
                    if len(italic_stack) > 1:
                        italic_stack.pop()
                elif lower_token == "<sub>":
                    sub_stack.append(True)
                elif lower_token == "</sub>":
                    if len(sub_stack) > 1:
                        sub_stack.pop()
                elif lower_token in ("<sup>", "<super>"):
                    sup_stack.append(True)
                elif lower_token in ("</sup>", "</super>"):
                    if len(sup_stack) > 1:
                        sup_stack.pop()
                elif lower_token.startswith("<font"):
                    c_m = re.search(r'color=["\']?#?([0-9a-fA-F]{6})["\']?', token)
                    s_m = re.search(r'size=["\']?(\d+(?:\.\d+)?)["\']?', token)
                    c_val = color_stack[-1]
                    s_val = size_stack[-1]
                    if c_m:
                        hex_c = c_m.group(1)
                        c_val = RGBColor(int(hex_c[:2], 16), int(hex_c[2:4], 16), int(hex_c[4:], 16))
                    if s_m:
                        s_val = Pt(float(s_m.group(1)))
                    color_stack.append(c_val)
                    size_stack.append(s_val)
                elif lower_token == "</font>":
                    if len(color_stack) > 1:
                        color_stack.pop()
                    if len(size_stack) > 1:
                        size_stack.pop()
            else:
                raw_text = py_html.unescape(token)
                run = p.add_run(raw_text)
                run.font.name = "Arial"
                if bold_stack[-1]:
                    run.bold = True
                if italic_stack[-1]:
                    run.italic = True
                if color_stack[-1]:
                    run.font.color.rgb = color_stack[-1]
                if size_stack[-1]:
                    run.font.size = size_stack[-1]
                if sub_stack[-1]:
                    run.font.subscript = True
                if sup_stack[-1]:
                    run.font.superscript = True

    def add_flowable_paragraph(p, flowable):
        style = flowable.style
        p.alignment = to_word_align(style.alignment)
        p.paragraph_format.space_before = Pt(style.spaceBefore if hasattr(style, "spaceBefore") else 0)
        p.paragraph_format.space_after = Pt(style.spaceAfter if hasattr(style, "spaceAfter") else 4)
        if hasattr(style, "leading") and style.leading:
            p.paragraph_format.line_spacing = Pt(style.leading)

        base_bold = False
        base_size = Pt(getattr(style, "fontSize", 9.5))
        base_color = None

        if hasattr(style, "textColor") and style.textColor:
            try:
                tc = style.textColor
                if hasattr(tc, "hexval"):
                    h = tc.hexval().lstrip("0x").lstrip("#")
                    base_color = RGBColor(int(h[:2], 16), int(h[2:4], 16), int(h[4:], 16))
            except Exception:
                pass

        if getattr(style, "name", "") in ("h1", "h2", "title", "big"):
            base_bold = True
            if not base_color:
                base_color = BLUE_COLOR

        if getattr(style, "name", "") == "cap":
            base_bold = True
            base_size = Pt(8)

        render_html_to_paragraph(p, flowable.text, base_font_size=base_size, base_color=base_color, base_bold=base_bold)

    def add_flowable_table(table_flowable):
        cell_values = table_flowable._cellvalues
        n_rows = len(cell_values)
        n_cols = len(cell_values[0]) if n_rows > 0 else 0
        if n_rows == 0 or n_cols == 0:
            return

        t = doc.add_table(rows=n_rows, cols=n_cols)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.autofit = False

        # Apply column widths if provided
        col_widths = getattr(table_flowable, "_colWidths", None)
        total_fw_mm = 166  # FW in ReportLab = 210 - 18 - 12 - 14 = 166mm
        for r_idx in range(n_rows):
            row = t.rows[r_idx]
            for c_idx in range(n_cols):
                cell = row.cells[c_idx]
                set_cell_margins(cell, top=50, bottom=50, left=80, right=80)
                if col_widths and c_idx < len(col_widths):
                    w_pt = col_widths[c_idx]
                    cell.width = Mm(w_pt * 25.4 / 72.0)

        # Inspect table styles from ReportLab
        has_borders = False
        commands = []
        if hasattr(table_flowable, "_cellStyles"):
            pass
        if hasattr(table_flowable, "_table"):
            pass
        # Check command table styles
        for cmd in getattr(table_flowable, "_argH", []) or []:
            pass

        # Check if header row has background or borders
        # In our engine: TableStyle has ("GRID", (0, 0), (-1, -1), 0.6, NAVY), ("BACKGROUND", (0, 0), (-1, 0), HEAD)
        is_bordered_table = (n_cols > 1 and n_rows > 1 and not (n_cols == 2 and n_rows == 1))
        # Exclude cert top table (1x2 logo+title) and cert bottom info table (1x3)
        if n_rows == 1 and n_cols in (2, 3):
            is_bordered_table = False

        if is_bordered_table:
            # Header background
            for c_idx in range(n_cols):
                set_cell_background(t.rows[0].cells[c_idx], HEAD_HEX)
            # Add grid borders to all cells
            for row in t.rows:
                for cell in row.cells:
                    set_cell_borders(cell, color=NAVY_HEX)

        for r_idx, row_vals in enumerate(cell_values):
            for c_idx, val in enumerate(row_vals):
                cell = t.rows[r_idx].cells[c_idx]
                cp = cell.paragraphs[0]
                cp.paragraph_format.space_before = Pt(0)
                cp.paragraph_format.space_after = Pt(0)
                if is_bordered_table and r_idx == 0:
                    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                if isinstance(val, Paragraph):
                    add_flowable_paragraph(cp, val)
                elif isinstance(val, Slot):
                    render_slot(cp, val)
                elif isinstance(val, str):
                    render_html_to_paragraph(cp, val, base_font_size=Pt(8.5))
                else:
                    cp.add_run(str(val) if val is not None else "")

    def render_slot(paragraph, slot_obj):
        image_align = word_align.get(str(slot_obj.align).lower(), WD_ALIGN_PARAGRAPH.CENTER)
        paragraph.alignment = image_align
        paragraph.paragraph_format.space_before = Pt(2)
        paragraph.paragraph_format.space_after = Pt(4)
        h_mm = max(20.0, min(float(slot_obj.h * 72.0 / 25.4 if slot_obj.h < 150 else slot_obj.h * 25.4 / 72.0), 140.0))
        # slot_obj.h is stored as h * mm in points (1mm = 72/25.4 pt = 2.8346 pt)
        # Convert points back to mm: pt * 25.4 / 72
        target_h_mm = float(slot_obj.h) * 25.4 / 72.0
        target_h_mm = max(20.0, min(target_h_mm, 140.0))

        if slot_obj.data:
            try:
                paragraph.add_run().add_picture(io.BytesIO(slot_obj.data), height=Mm(target_h_mm))
                return
            except Exception:
                pass
        # Fallback to visual dashed placeholder image identical to ReportLab Slot draw()
        placeholder_bytes = make_placeholder_image(slot_obj.label)
        paragraph.add_run().add_picture(io.BytesIO(placeholder_bytes), height=Mm(target_h_mm))

    # Iterate through all report sections exactly as ReportLab does
    selected_ids = selected or [s["id"] for s in SECTIONS]
    first_item = True

    for s in SECTIONS:
        if s["id"] not in selected_ids:
            continue
        c.active = s["id"]
        custom_body = c.raw("body__" + s["id"])
        if custom_body and not template:
            section_story = [c.P(s["title"], "h1")]
            for para_text in custom_body.replace("\r\n", "\n").split("\n\n"):
                t_str = para_text.strip()
                if t_str:
                    section_story.append(c.P(escape(t_str).replace("\n", "<br/>")))
            for image_info in s["images"]:
                section_story += c.slot(image_info["id"], image_info["label"], image_info["h"])
            section_story.append(PageBreak())
        else:
            section_story = BUILD[s["id"]](c)

        added_figures = c.extra_slots(s["id"])
        if added_figures:
            ends_page = bool(section_story and isinstance(section_story[-1], PageBreak))
            if ends_page:
                section_story.pop()
            section_story += added_figures
            if ends_page:
                section_story.append(PageBreak())

        # Render each flowable into the Word document
        for item in section_story:
            if isinstance(item, PageBreak):
                doc.add_page_break()
                continue
            if isinstance(item, Spacer):
                # Only add slight vertical spacing for substantial spacers
                if item.height > 15:
                    sp = doc.add_paragraph()
                    sp.paragraph_format.space_before = Pt(0)
                    sp.paragraph_format.space_after = Pt(min(float(item.height) * 25.4 / 72.0 * 0.7, 24))
                    sp.paragraph_format.line_spacing = Pt(0)
                continue
            if isinstance(item, Paragraph):
                p = doc.paragraphs[-1] if (first_item and len(doc.paragraphs) > 0 and not doc.paragraphs[-1].text) else doc.add_paragraph()
                first_item = False
                add_flowable_paragraph(p, item)
            elif isinstance(item, Table):
                add_flowable_table(item)
                first_item = False
            elif isinstance(item, Slot):
                p = doc.add_paragraph()
                first_item = False
                render_slot(p, item)

    output = io.BytesIO()
    doc.save(output)
    return output.getvalue(), warns


def build_word(data=None, images=None, selected=None, template=False, layout=None, extras=None, removed=None):
    """Create a visually faithful Word companion by embedding PDF pages.

    Word's pagination engine cannot reliably reproduce ReportLab's flowable
    layout (especially its fixed sidebar, form fields and figure placement).
    The controlled PDF therefore remains the single layout source.  Each PDF
    page is rendered at 200 DPI and anchored to an A4 Word page, preserving
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
        section.page_width, section.page_height = Mm(210), Mm(297)
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
        picture = run.add_picture(io.BytesIO(png), width=Mm(210), height=Mm(297))
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
    section.page_width, section.page_height = Mm(210), Mm(297)
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
