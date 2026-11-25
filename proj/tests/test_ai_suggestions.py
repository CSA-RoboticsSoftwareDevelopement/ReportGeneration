from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai.image_processor import prepare_image
from ai.routes import create_router
from ai.validation_service import validate_model_result


def image_bytes() -> bytes:
    image = Image.new("RGB", (32, 24), "white")
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


class AiSuggestionTests(unittest.TestCase):
    def client(self, require_user=lambda request: {"id": 1}, require_csrf=lambda request: None):
        app = FastAPI()
        app.include_router(create_router(require_user, require_csrf))
        return TestClient(app)

    def payload(self):
        return {"report_id": "r1", "section_id": "analysis-strength", "image_id": "evidence-1"}

    def test_image_validation_rejects_non_image(self):
        with self.assertRaises(HTTPException) as error:
            prepare_image(b"not an image")
        self.assertEqual(error.exception.status_code, 400)

    def test_endpoint_requires_authenticated_user(self):
        client = self.client(require_user=lambda request: (_ for _ in ()).throw(HTTPException(status_code=401, detail="Sign in is required.")))
        response = client.post("/api/ai/suggestions", data=self.payload(), files={"image": ("test.png", image_bytes(), "image/png")})
        self.assertEqual(response.status_code, 401)

    def test_endpoint_requires_csrf(self):
        client = self.client(require_csrf=lambda request: (_ for _ in ()).throw(HTTPException(status_code=403, detail="Invalid or missing CSRF token.")))
        response = client.post("/api/ai/suggestions", data=self.payload(), files={"image": ("test.png", image_bytes(), "image/png")})
        self.assertEqual(response.status_code, 403)

    @patch("ai.routes.analyse_image")
    def test_endpoint_returns_reviewable_mocked_analysis(self, analyse_image):
        analyse_image.return_value = ({
            "analysis_type": "Equivalent Stress",
            "extracted_values": {"maximum_stress": {"value": "100.86", "unit": "MPa"}},
            "suggestions": {"caption": "Stress contour", "description": "A visible stress distribution.", "observations": ["A local high-stress region is visible."]},
            "warnings": [],
        }, "qwen3-vl:2b")
        response = self.client().post("/api/ai/suggestions", data=self.payload(), files={"image": ("test.png", image_bytes(), "image/png")})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["requires_review"])
        self.assertFalse(body["extracted_values"]["maximum_stress"]["verified"])
        self.assertEqual(body["suggestions"]["caption"], "Stress contour")

    def test_non_numeric_model_value_is_not_presented_as_a_measurement(self):
        result = validate_model_result({"extracted_values": {"value": {"value": "not readable", "unit": ""}}}, image_id="i", section_id="s", model="test")
        self.assertEqual(result.extracted_values, {})
        self.assertTrue(result.requires_review)


if __name__ == "__main__":
    unittest.main()
