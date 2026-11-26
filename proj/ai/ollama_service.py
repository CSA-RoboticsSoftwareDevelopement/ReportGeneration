from __future__ import annotations

import json
import os
import re
from typing import Any

from fastapi import HTTPException

from .extraction_service import build_plain_prompt


def _content(response: Any) -> str:
    if isinstance(response, dict):
        message = response.get("message") or {}
        return str(message.get("content") or "")
    return str(getattr(getattr(response, "message", None), "content", "") or "")


def _models(response: Any) -> list[str]:
    values = response.get("models", []) if isinstance(response, dict) else getattr(response, "models", [])
    names = []
    for item in values or []:
        name = item.get("model") if isinstance(item, dict) else getattr(item, "model", None)
        if name:
            names.append(str(name))
    return names


def _parse_json(content: str) -> dict:
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
    try:
        value = json.loads(clean)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="The local model returned an unreadable analysis. Try again.") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=502, detail="The local model returned an invalid analysis.")
    return value


def _text_payload(content: str) -> dict:
    """Turn a local vision description into the existing review-only response."""
    description = str(content or "").strip()[:2000]
    caption = description.split(".", 1)[0].strip()[:240] if description else ""
    return {
        "analysis_type": "",
        "extracted_values": {},
        "suggestions": {"caption": caption, "description": description, "observations": []},
        "warnings": ["No numerical values were extracted automatically. Review this generated description against the original image."],
        "requires_review": True,
    }


def analyse_image(image_base64: str, section_id: str, context: str) -> tuple[dict, str]:
    model = os.getenv("VISION_MODEL", "qwen3-vl:2b").strip() or "qwen3-vl:2b"
    base_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").strip()
    timeout = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120"))
    try:
        import httpx
        from ollama import Client, ResponseError
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="Local AI support is unavailable because the Ollama Python package is not installed.") from exc
    try:
        client = Client(host=base_url, timeout=timeout)
        available = _models(client.list())
        if model not in available:
            raise HTTPException(status_code=503, detail=f"The configured vision model '{model}' is not installed in Ollama. Run: ollama pull {model}")
        for _attempt in range(2):
            response = client.chat(
                model=model,
                messages=[{"role": "user", "content": build_plain_prompt(section_id, context), "images": [image_base64]}],
                # Qwen3-VL exposes a thinking channel. Disable it so a small
                # model reserves its response budget for the visible result.
                think=False,
                options={"temperature": 0, "num_predict": 700},
            )
            description = _content(response)
            if description:
                return _text_payload(description), model
        raise HTTPException(status_code=502, detail="The local model did not return a description. Try again.")
    except HTTPException:
        raise
    except ResponseError as exc:
        raise HTTPException(status_code=502, detail=f"Ollama could not analyse this image: {exc.error}") from exc
    except (httpx.ConnectError, httpx.TimeoutException, ConnectionError, TimeoutError, OSError) as exc:
        raise HTTPException(status_code=503, detail="Ollama is not running or did not respond in time. Start Ollama and try again.") from exc
