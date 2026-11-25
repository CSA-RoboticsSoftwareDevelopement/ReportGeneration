from __future__ import annotations

from .schemas import response_json_schema


def build_prompt(section_id: str, context: str) -> str:
    focus = "general engineering evidence"
    section = section_id.lower()
    if "stress" in section or "strength" in section:
        focus = "equivalent von Mises stress contours and critical regions"
    elif "deform" in section or "displacement" in section:
        focus = "total deformation or displacement contours"
    elif "force" in section or "load" in section:
        focus = "applied loads, force directions, and load locations"
    elif "support" in section or "boundary" in section:
        focus = "boundary conditions, fixed supports, and remote displacement"
    return f"""You are reviewing a single engineering-report image. Focus on {focus}.
Report section context: {context[:2000] or 'None provided'}

Return JSON only, matching the supplied schema. Describe only information visibly present in the image.
Never invent numbers, units, material properties, loads, or safety/pass-fail conclusions. Use an empty string for unreadable values and keep every text field concise (under 250 characters). All extracted numerical values are unverified. Give a concise neutral caption, a concise technical description, observations, and warnings for missing/uncertain information."""


def build_plain_prompt(section_id: str, context: str) -> str:
    """A short, non-schema prompt for smaller vision models that struggle with JSON."""
    focus = "engineering evidence"
    section = section_id.lower()
    if "stress" in section or "strength" in section:
        focus = "visible stress contours and critical regions"
    elif "deform" in section or "displacement" in section:
        focus = "visible deformation or displacement contours"
    elif "force" in section or "load" in section:
        focus = "visible loads and force directions"
    elif "support" in section or "boundary" in section:
        focus = "visible supports and boundary conditions"
    return f"""Write one concise engineering-report description of this image, focusing on {focus}.
Only state what is visibly present. Do not invent numerical values, units, material properties, loads, or pass/fail conclusions.
Section context: {context[:800] or 'None provided'}
Return plain text only, under 500 characters."""


def output_schema():
    return response_json_schema()
