from __future__ import annotations

import base64
import io

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError


MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
MAX_EDGE = 2048
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}


def prepare_image(data: bytes) -> str:
    """Validate and normalise an image to a compact PNG base64 payload."""
    if not data:
        raise HTTPException(status_code=400, detail="Select an image before requesting AI suggestions.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Images for AI suggestions must be 10 MB or smaller.")
    try:
        with Image.open(io.BytesIO(data)) as source:
            source.verify()
        with Image.open(io.BytesIO(data)) as source:
            if source.format not in ALLOWED_FORMATS:
                raise HTTPException(status_code=415, detail="AI suggestions support PNG, JPEG, and WEBP images.")
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="The image is too large for local AI analysis.")
            image = source.convert("RGB")
            if max(image.size) > MAX_EDGE:
                image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="PNG", optimize=True)
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=400, detail="The selected file is not a readable image.")
    return base64.b64encode(output.getvalue()).decode("ascii")
