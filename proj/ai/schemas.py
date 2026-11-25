from __future__ import annotations

from pydantic import BaseModel, Field


class ExtractedValue(BaseModel):
    value: float | str | None = None
    unit: str | None = None
    verified: bool = False


class Suggestions(BaseModel):
    caption: str = ""
    description: str = ""
    observations: list[str] = Field(default_factory=list)


class SuggestionResponse(BaseModel):
    image_id: str
    section_id: str
    model: str
    analysis_type: str | None = None
    extracted_values: dict[str, ExtractedValue] = Field(default_factory=dict)
    suggestions: Suggestions = Field(default_factory=Suggestions)
    warnings: list[str] = Field(default_factory=list)
    requires_review: bool = True


def response_json_schema() -> dict:
    """Schema for model output; request identity is supplied only by the server."""
    return {
        "type": "object",
        "required": ["analysis_type", "extracted_values", "suggestions", "warnings", "requires_review"],
        "properties": {
            "analysis_type": {"type": "string"},
            "extracted_values": {
                "type": "object",
                "additionalProperties": {
                    "type": "object",
                    "required": ["value", "unit"],
                    "properties": {"value": {"type": "string"}, "unit": {"type": "string"}},
                },
            },
            "suggestions": {
                "type": "object",
                "required": ["caption", "description", "observations"],
                "properties": {
                    "caption": {"type": "string"},
                    "description": {"type": "string"},
                    "observations": {"type": "array", "items": {"type": "string"}},
                },
            },
            "warnings": {"type": "array", "items": {"type": "string"}},
            "requires_review": {"type": "boolean"},
        },
    }
