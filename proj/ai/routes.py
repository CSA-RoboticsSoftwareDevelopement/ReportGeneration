from __future__ import annotations

import json
import logging

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from .image_processor import prepare_image
from .ollama_service import analyse_image
from .validation_service import validate_model_result


logger = logging.getLogger(__name__)


def create_router(require_user, require_csrf) -> APIRouter:
    router = APIRouter(prefix="/api/ai", tags=["AI suggestions"])

    @router.post("/suggestions")
    async def suggestions(
        request: Request,
        image: UploadFile = File(...),
        report_id: str = Form(""),
        section_id: str = Form(...),
        image_id: str = Form(...),
        section_context: str = Form(""),
    ):
        require_user(request)
        require_csrf(request)
        if not section_id.strip() or not image_id.strip():
            raise HTTPException(status_code=400, detail="A report section and image are required for AI suggestions.")
        try:
            data = await image.read(10 * 1024 * 1024 + 1)
            payload = prepare_image(data)
            try:
                context = json.loads(section_context) if section_context.strip().startswith("{") else section_context
            except json.JSONDecodeError:
                context = section_context
            context_text = json.dumps(context, ensure_ascii=False) if isinstance(context, dict) else str(context or "")
            raw, model = analyse_image(payload, section_id.strip(), context_text)
            result = validate_model_result(raw, image_id=image_id.strip(), section_id=section_id.strip(), model=model)
        except HTTPException:
            raise
        except ValueError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Unexpected local AI suggestion failure")
            raise HTTPException(status_code=502, detail="AI suggestions could not be generated. Confirm that Ollama is running, then try again.") from exc
        return JSONResponse(result.model_dump())

    return router
