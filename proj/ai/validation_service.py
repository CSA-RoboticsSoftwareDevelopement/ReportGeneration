from __future__ import annotations

from typing import Any

from .schemas import ExtractedValue, SuggestionResponse, Suggestions


MAX_TEXT = 4000


def _text(value: Any, limit: int = MAX_TEXT) -> str:
    return str(value or "").strip()[:limit]


def validate_model_result(payload: Any, *, image_id: str, section_id: str, model: str) -> SuggestionResponse:
    """Normalise untrusted model output and attach the mandatory review warning."""
    if not isinstance(payload, dict):
        raise ValueError("The local model returned an invalid response.")
    raw_suggestions = payload.get("suggestions") if isinstance(payload.get("suggestions"), dict) else {}
    extracted: dict[str, ExtractedValue] = {}
    raw_values = payload.get("extracted_values") if isinstance(payload.get("extracted_values"), dict) else {}
    for key, value in raw_values.items():
        if not isinstance(value, dict) or not _text(key, 80):
            continue
        number = value.get("value")
        if isinstance(number, bool):
            number = None
        elif isinstance(number, str):
            try:
                number = float(number.replace(",", "").strip())
            except ValueError:
                number = None
        elif not isinstance(number, (int, float)):
            number = None
        unit = _text(value.get("unit"), 40) or None
        if number is None and not unit:
            continue
        extracted[_text(key, 80)] = ExtractedValue(
            value=number,
            unit=unit,
            verified=False,
        )
    observations = raw_suggestions.get("observations")
    if not isinstance(observations, list):
        observations = []
    warnings = [_text(item, 500) for item in (payload.get("warnings") or []) if _text(item, 500)]
    review_warning = "AI-extracted values and observations require engineering review against the original simulation data."
    if review_warning not in warnings:
        warnings.append(review_warning)
    return SuggestionResponse(
        image_id=image_id,
        section_id=section_id,
        model=model,
        analysis_type=_text(payload.get("analysis_type"), 120) or None,
        extracted_values=extracted,
        suggestions=Suggestions(
            caption=_text(raw_suggestions.get("caption"), 500),
            description=_text(raw_suggestions.get("description")),
            observations=[_text(item, 700) for item in observations if _text(item, 700)][:12],
        ),
        warnings=warnings[:12],
        requires_review=True,
    )
