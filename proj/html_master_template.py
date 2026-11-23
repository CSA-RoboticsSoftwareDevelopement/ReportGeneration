"""Dynamic adapter for a pdf2htmlEX report master.

The supplied CSA master is a visual HTML export: every page is positioned with
CSS rather than being a normal document template.  This adapter deliberately
keeps that layout intact and only replaces its existing grey ``[ value ]``
tokens.  The same report-data dictionary used by the ReportLab report is used
here, so a value entered in the editor is stored once and is available to both
renderers.

The HTML master is optional.  The normal ReportLab renderer remains the
authoritative renderer for dynamically added sections/pages, calculations,
images and editor overlays.  This route gives the provided visual master a
faithful PDF export without sacrificing those editable workflows.
"""
from __future__ import annotations

import html
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
DEFAULT_SOURCE = Path(r"C:\Users\itcsa\Downloads\Trailer_Report_TEMPLATE_13_.html")
LOCAL_SOURCE = HERE / "assets" / "Trailer_Report_TEMPLATE_13_.html"


def source_path() -> Path | None:
    """Return the configured master without requiring it at application boot."""
    configured = os.getenv("REPORT_HTML_TEMPLATE", "").strip()
    candidates = [Path(configured)] if configured else []
    candidates.extend((LOCAL_SOURCE, DEFAULT_SOURCE))
    return next((item for item in candidates if item.is_file()), None)


def status() -> dict[str, Any]:
    source = source_path()
    if not source:
        return {"available": False, "message": "HTML report master was not found."}
    raw = source.read_text(encoding="utf-8", errors="replace")
    return {
        "available": True,
        "name": source.name,
        "pages": len(re.findall(r'class="pf\b', raw)),
        "source": str(source),
    }


def _value_map(data: dict[str, Any]) -> dict[str, str]:
    """Map human-facing placeholder labels to the existing stored variables."""
    # Import lazily: engine imports no adapter, avoiding an import cycle.
    import engine

    values: dict[str, str] = {}
    for field in engine.GENERAL:
        values[field["label"]] = str(data.get(field["id"], field.get("default", "")) or "").strip()
    for section in engine.SECTIONS:
        for field in section.get("fields", []):
            values[field["label"]] = str(data.get(field["id"], field.get("default", "")) or "").strip()

    # These shorter aliases occur in the supplied source template.
    aliases = {
        "ATM": "atm",
        "Overall length": "length_mm",
        "Overall width": "width_mm",
        "Distance coupling to suspension": "susp_mm",
        "Geometry design note": "geo_note",
        "Project scope of work": "background_scope",
        "Analysis objectives": "background_objectives",
        "Analysis pre-processing note": "preproc_note",
        "Mesh nodes": "nodes",
        "Mesh elements": "elements",
        "Project-specific requirements and assumptions": "requirements_note",
        "Project conclusion": "conclusion_note",
    }
    values.update({label: str(data.get(key, "") or "").strip() for label, key in aliases.items()})

    # Common calculation outputs are derived from the same variables rather
    # than being independently entered values.
    def number(key: str) -> float | None:
        try:
            return float(data.get(key, ""))
        except (TypeError, ValueError):
            return None

    atm, bolts, thickness, hole = number("atm"), number("cp_n"), number("cp_t"), number("cp_d")
    if all(value is not None and value > 0 for value in (atm, bolts, thickness, hole)):
        pulling = 1.5 * 9.81 * atm
        per_bolt = pulling / bolts
        stress = per_bolt / (thickness * hole)
        values.update({
            "Coupling pulling force": f"{pulling:.1f}",
            "Force per bolt": f"{per_bolt:.1f}",
            "Coupling compressive stress": f"{stress:.2f}",
            "Coupling safety factor": f"{410 / stress:.2f}" if stress else "",
        })
    return values


def render(data: dict[str, Any]) -> str:
    """Return master HTML with populated values, preserving empty grey tokens."""
    source = source_path()
    if not source:
        raise FileNotFoundError("HTML report master was not found. Set REPORT_HTML_TEMPLATE or place it in proj/assets.")
    raw = source.read_text(encoding="utf-8", errors="replace")
    for label, value in sorted(_value_map(data).items(), key=lambda pair: len(pair[0]), reverse=True):
        if not value:
            continue
        # The source uses literal text nodes such as [ Overall length ].  Do
        # not alter CSS, embedded images, fonts or its precise page geometry.
        pattern = r"\[\s*" + re.escape(label) + r"\s*\]"
        raw = re.sub(pattern, lambda _match: html.escape(value), raw, flags=re.IGNORECASE)
    return raw


def _chrome() -> str | None:
    configured = os.getenv("REPORT_HTML_CHROME", "").strip()
    choices = [configured] if configured else []
    choices += [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for candidate in choices:
        if candidate and Path(candidate).is_file():
            return candidate
    return shutil.which("chrome") or shutil.which("msedge")


def _story_pdf(markup: str, output: Path) -> bool:
    """Best-effort local fallback where headless Chromium is unavailable.

    PyMuPDF supports enough of the static HTML export to retain text, inline
    assets and page flow. It is not chosen first because Chromium is more
    faithful to pdf2htmlEX's absolute-positioned CSS.
    """
    try:
        import pymupdf
        story = pymupdf.Story(html=markup)
        writer = pymupdf.DocumentWriter(str(output))
        page = pymupdf.Rect(0, 0, 595.276, 841.89)  # A4 in PDF points

        def rectfn(rect_num, filled):
            return page, page, pymupdf.Matrix()

        story.write(writer, rectfn)
        writer.close()
        # pdf2htmlEX embeds images and fonts as data URIs. Compact the
        # fallback result so an otherwise valid export is practical to
        # download when Chromium cannot run in a locked-down environment.
        if output.is_file():
            compact = output.with_name("report-compact.pdf")
            doc = pymupdf.open(output)
            doc.save(compact, garbage=4, deflate=True, use_objstms=1)
            doc.close()
            compact.replace(output)
        return output.is_file() and output.stat().st_size >= 100
    except Exception:
        return False


def build_pdf(data: dict[str, Any]) -> bytes:
    """Print the populated HTML master to PDF using a local Chromium browser."""
    chrome = _chrome()
    with tempfile.TemporaryDirectory(prefix="report-html-master-") as folder:
        root = Path(folder)
        source = root / "report.html"
        output = root / "report.pdf"
        markup = render(data)
        source.write_text(markup, encoding="utf-8")
        completed = None
        if chrome:
            command = [
                chrome, "--headless=new", "--disable-gpu", "--disable-gpu-compositing",
                "--use-angle=swiftshader", "--disable-features=Vulkan,UseSkiaRenderer", "--no-first-run",
                f"--user-data-dir={root / 'browser-profile'}",
                "--allow-file-access-from-files", "--print-to-pdf-no-header",
                f"--print-to-pdf={output}", source.as_uri(),
            ]
            completed = subprocess.run(command, capture_output=True, text=True, timeout=90, check=False)
        # Chromium may exit non-zero on managed Windows machines after writing
        # a valid PDF (for example because an OS-crypt profile warning is
        # emitted).  The artifact itself is the reliable completion signal.
        if not output.is_file() or output.stat().st_size < 100:
            _story_pdf(markup, output)
        if not output.is_file() or output.stat().st_size < 100:
            detail = ((completed.stderr or completed.stdout) if completed else "No local browser was found.").strip()
            raise RuntimeError(f"HTML master PDF export failed: {detail[-1600:]}")
        return output.read_bytes()
