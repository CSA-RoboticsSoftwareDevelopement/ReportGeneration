import collections, hashlib, io, json, os, secrets, time, urllib.parse
from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import RedirectResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException
from starlette.middleware.sessions import SessionMiddleware
import config  # Loads local .env values before database modules are imported.
import engine
import project_lookup
import auth
import standards_library
import materials_library
import pdf_studio
import report_overlays
import reports_store
import html_master_template

try:
    import fitz  # PyMuPDF for filling v2 template AcroForm fields
except Exception:
    fitz = None

HERE = os.path.dirname(os.path.abspath(__file__))
AVATAR_DIR = os.path.join(HERE, "uploads", "avatars")
os.makedirs(AVATAR_DIR, exist_ok=True)
TEMPLATE_PDF = os.path.join(HERE, "assets", "Trailer_Report_TEMPLATE_v2.pdf")


def _enabled(value):
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


_environment = os.getenv("APP_ENV", "development").strip().lower()
_production = _environment in {"production", "prod"}
_configured_secret = os.getenv("AUTH_SESSION_SECRET", "").strip()

# A random development secret is convenient locally, but a deployment must use
# a stable, private secret. Otherwise sessions could be forged or invalidated
# whenever the service restarts.
if not _configured_secret or _configured_secret == "replace-with-a-long-random-secret":
    if _production:
        raise RuntimeError("AUTH_SESSION_SECRET must be set in production.")
    _configured_secret = secrets.token_urlsafe(48)
elif len(_configured_secret) < 32:
    raise RuntimeError("AUTH_SESSION_SECRET must contain at least 32 characters.")

_secure_cookie = _enabled(os.getenv("AUTH_COOKIE_SECURE", "1" if _production else "0"))
if _production and not _secure_cookie:
    raise RuntimeError("AUTH_COOKIE_SECURE must be enabled in production.")

app = FastAPI(title="Trailer Certification Report Generator")
app.add_middleware(
    SessionMiddleware,
    secret_key=_configured_secret,
    session_cookie="trailer_report_session",
    max_age=60 * 60 * 12,
    # SessionMiddleware cookies are always HttpOnly. Strict blocks the browser
    # from sending this cookie with cross-site navigation and requests.
    same_site="strict",
    https_only=_secure_cookie,
)
app.mount("/avatars", StaticFiles(directory=AVATAR_DIR), name="avatars")


def _csrf_token(request: Request):
    token = request.session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        request.session["csrf_token"] = token
    return token


def require_csrf(request: Request):
    expected = request.session.get("csrf_token")
    supplied = request.headers.get("X-CSRF-Token", "")
    if not expected or not secrets.compare_digest(str(expected), supplied):
        raise HTTPException(status_code=403, detail="Invalid or missing CSRF token.")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
    # The page contains inline styling and scripts, so these are allowed while
    # all other script/style sources remain restricted to this application.
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; "
        "frame-src 'self' blob:; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    )
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    if _secure_cookie:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


def _normalise_report_data(payload):
    """Keep editable section narratives in the same data object for preview and export."""
    data = payload.get("data", {})
    if not isinstance(data, dict):
        data = {}
    # body__<section-id> is the shared contract used by the browser editor,
    # PDF builder, page preview and Word export (Word is rendered from the PDF).
    for key, value in list(data.items()):
        if key.startswith("body__"):
            if not isinstance(value, str):
                raise HTTPException(status_code=400, detail=f"Invalid section content for {key[6:]}.")
            if len(value) > 50000:
                raise HTTPException(status_code=413, detail=f"Section content for {key[6:]} exceeds 50,000 characters.")
            data[key] = value
    standards = payload.get("standards", data.get("standards", []))
    if not isinstance(standards, list):
        standards = []
    normalized_standards = []
    for index, row in enumerate(standards, start=1):
        if not isinstance(row, dict):
            continue
        standard = str(row.get("standard") or "").strip()
        requirement = str(row.get("requirement") or "").strip()
        conformity = str(row.get("conformity") or "Full Compliance").strip()
        if not (standard or requirement):
            continue
        normalized_standards.append({
            "id": str(row.get("id") or f"compliance-{index}")[:180],
            "standard": standard[:2000],
            "requirement": requirement[:50000],
            "conformity": conformity[:120],
        })
    data["standards"] = normalized_standards
    return data


def _set_field_value(widget, value):
    """Safely set an AcroForm widget field value."""
    if not value:
        return
    try:
        widget.field_value = value
        widget.update()
    except Exception:
        pass


def _replace_text_placeholders(doc, data):
    """Replace bracketed placeholders like [ RAE No. ] with actual data values.

    Scans every page's text spans and replaces any [ KEY ] patterns
    with the corresponding value from the report data dictionary.
    """
    placeholder_map = {
        "RAE No.": "rae_no",
        "Project name": "project_name",
        "Certification No.": "rae_no",
        "Revision date": "rev_date",
        "Revision No.": "rev",
        "Prepared by (initials)": "prepared_by",
        "Checked by (initials)": "prepared_by",
        "Project scope of work": "background_scope",
        "Analysis objectives": "background_objectives",
        "Mesh nodes": "nodes",
        "Mesh elements": "elements",
        "Project-specific requirements": "requirements_note",
        "Project conclusion": "conclusion_note",
    }

    for pno in range(len(doc)):
        page = doc[pno]
        text_dict = page.get_text("dict")
        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    t = span.get("text", "").strip()
                    if t.startswith("[") and t.endswith("]"):
                        key = t[1:-1].strip()
                        if key in placeholder_map:
                            data_key = placeholder_map[key]
                            replacement = str(data.get(data_key, "") or "")
                            if not replacement:
                                replacement = f"[{key}]"
                            # Replace by drawing over the old text
                            bbox = span["bbox"]
                            try:
                                page.insert_textbox(
                                    bbox,
                                    replacement,
                                    fontsize=span.get("size", 11),
                                    fontname=span.get("font", "helv"),
                                    color=(0, 0, 0),
                                    overlay=True
                                )
                            except Exception:
                                try:
                                    page.insert_text(
                                        (bbox[0] + 1, bbox[1] + span.get("size", 11)),
                                        replacement,
                                        fontsize=span.get("size", 11),
                                        fontname=span.get("font", "helv"),
                                        color=(0, 0, 0),
                                    )
                                except Exception:
                                    pass


def _fill_template_field(widget, name, data, standards, image_captions):
    """Fill one v2 template AcroForm widget from report data."""
    value = ""
    if name.startswith("caption_"):
        try:
            cap_num = int(name[len("caption_"):])
        except ValueError:
            cap_num = None
        if cap_num is not None:
            value = image_captions.get(str(cap_num), "")
            if not value:
                value = f"Figure {cap_num}"
    elif name.startswith("standard_"):
        try:
            idx = int(name[len("standard_"):]) - 1
        except ValueError:
            idx = -1
        if 0 <= idx < len(standards):
            value = standards[idx].get("standard", "")
    elif name.startswith("requirement_"):
        try:
            idx = int(name[len("requirement_"):]) - 1
        except ValueError:
            idx = -1
        if 0 <= idx < len(standards):
            value = standards[idx].get("requirement", "")
    elif name.startswith("conformity_"):
        try:
            idx = int(name[len("conformity_"):]) - 1
        except ValueError:
            idx = -1
        if 0 <= idx < len(standards):
            value = standards[idx].get("conformity", "Full Compliance")
    elif name.startswith("requirement_note_"):
        try:
            idx = int(name[len("requirement_note_"):]) - 1
        except ValueError:
            idx = -1
        if 0 <= idx < len(standards):
            value = standards[idx].get("requirement", "")
    elif name.startswith("mat_"):
        key = name[len("mat_"):]
        value = str(data.get(key, "") or "")
    elif name == "rae_no":
        value = str(data.get("rae_no", "") or "")
    elif name == "applicant":
        value = str(data.get("applicant", "") or "")
    elif name == "client":
        value = str(data.get("client", "") or "")
    elif name == "project_name":
        value = str(data.get("project_name", "") or "")
    elif name == "report_title":
        value = str(data.get("report_title", "") or "")
    elif name == "date":
        value = str(data.get("date", "") or "")
    elif name == "atm":
        value = str(data.get("atm", "") or "")
    elif name == "axle_type":
        value = str(data.get("axle_type", "") or "")
    elif name == "trailer_type":
        value = str(data.get("trailer_type", "") or "")
    elif name == "rev":
        value = str(data.get("rev", "") or "")
    elif name == "rev_date":
        value = str(data.get("rev_date", "") or "")
    elif name == "rev_details":
        value = str(data.get("rev_details", "") or "")
    elif name == "prepared_by":
        value = str(data.get("prepared_by", "") or "")
    elif name == "material":
        value = str(data.get("material", "") or "")
    elif name == "fu":
        value = str(data.get("fu", "") or "")
    elif name == "fy":
        value = str(data.get("fy", "") or "")
    elif name == "young":
        value = str(data.get("young", "") or "")
    elif name == "nu":
        value = str(data.get("nu", "") or "")
    elif name == "rho":
        value = str(data.get("rho", "") or "")
    _set_field_value(widget, value)


def fill_v2_template(data: dict, images: dict = None) -> bytes:
    """Fill the v2 template PDF's AcroForm fields with report data.

    Maps report data to the template's existing AcroForm fields:
      - caption_*    -> image captions / labels
      - standard_*   -> Summary of Compliance standard column
      - requirement_* -> Summary of Compliance compliance requirement column
      - conformity_* -> Summary of Compliance conformity column
      - requirement_note_* -> Requirements section notes
      - mat_*        -> Material table fields
    Returns the filled PDF as bytes.
    """
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is not available; cannot fill v2 template.")
    if not os.path.isfile(TEMPLATE_PDF):
        raise FileNotFoundError(f"v2 template not found: {TEMPLATE_PDF}")

    images = images or {}
    doc = fitz.open(TEMPLATE_PDF)

    standards = data.get("standards", []) if isinstance(data.get("standards"), list) else []

    # Build image caption map: caption number -> label
    caption_order = []
    for page in doc:
        for widget in page.widgets() or []:
            name = widget.field_name or ""
            if name.startswith("caption_"):
                try:
                    num = int(name[len("caption_"):])
                except ValueError:
                    continue
                caption_order.append((num, name))
    caption_order.sort()

    slot_labels = {}
    for key, val in data.items():
        if key.startswith("cap__") and isinstance(val, str) and val.strip():
            sid = key[len("cap__"):]
            slot_labels[sid] = val.strip()

    default_labels = {
        "bg_front": "3D Isometric Model in Autodesk Inventor - Front",
        "bg_back": "3D Isometric Model in Autodesk Inventor - Back",
        "geo_iso": "3D Isometric Model",
        "geo_top": "Top View showing the length and width of the trailer",
        "geo_side": "Side View showing the distance of suspension from coupling",
        "mesh": "Meshed model",
    }
    for n in range(1, 8):
        default_labels[f"a{n}_load"] = f"Load & constraints applied on the trailer"
        default_labels[f"a{n}_stress_img"] = f"Stress Distribution Plot for Analysis {n}"
        default_labels[f"a{n}_probe"] = f"Stress Distribution Plot with the probe"
        default_labels[f"a{n}_disp"] = f"Displacement Plot for Analysis {n}"

    present_slots = [sid for sid in images if images.get(sid)]
    for key in data:
        if key.startswith("cap__"):
            sid = key[len("cap__"):]
            if sid not in present_slots:
                present_slots.append(sid)

    image_captions = {}
    caption_index = 0
    for num, _name in caption_order:
        if caption_index < len(present_slots):
            sid = present_slots[caption_index]
            image_captions[sid] = slot_labels.get(sid, default_labels.get(sid, f"Figure {num}"))
            # Also map caption number directly for lookup by number
            image_captions[str(num)] = image_captions[sid]
            caption_index += 1

    for page in doc:
        for widget in page.widgets() or []:
            name = widget.field_name or ""
            if not name:
                continue
            _fill_template_field(widget, name, data, standards, image_captions)

    try:
        doc.regenerate_appearance()
    except Exception:
        pass

    # Replace bracketed text placeholders (e.g. [ RAE No. ], [ Project name ])
    try:
        _replace_text_placeholders(doc, data)
    except Exception:
        pass

    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True)
    doc.close()
    return out.getvalue()


def get_template_section_pages() -> dict:
    """Scan the v2 template PDF and map section IDs to their starting page numbers.

    Searches each page for known section titles to build the
    section -> page mapping used by the Section Pdf Editor for navigation.
    """
    if fitz is None or not os.path.isfile(TEMPLATE_PDF):
        return {}
    section_keywords = {
        "cert": "Certificate of Conformity",
        "title": "Title page & Structural Certification",
        "index": "Report Index",
        "background": "Background & Scope of Work",
        "summary": "Summary of Compliance",
        "requirements": "Requirements",
        "preproc": "Analysis - Pre-Processing",
        "geometry": "The geometry of the Trailer",
        "material_mesh": "Material and mesh",
        "conclusion": "Conclusion",
    }
    result = {}
    try:
        doc = fitz.open(TEMPLATE_PDF)
        for pno in range(len(doc)):
            page = doc[pno]
            text = page.get_text()
            for sid, keyword in section_keywords.items():
                if sid not in result and keyword in text:
                    result[sid] = pno + 1
        # Analysis sections a1-a7: search by their titles
        for n in range(1, 8):
            sid = f"a{n}"
            if sid in result:
                continue
            for pno in range(len(doc)):
                page = doc[pno]
                text = page.get_text()
                if f"Analysis {n}" in text or f"ANALYSIS {n}" in text:
                    result[sid] = pno + 1
                    break
        doc.close()
    except Exception:
        pass
    return result


def require_user(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in is required.")
    try:
        user = auth.get_user(user_id)
    except auth.AuthConfigurationError:
        raise HTTPException(status_code=503, detail="Authentication service is unavailable.")
    if not user:
        request.session.clear()
        raise HTTPException(status_code=401, detail="Your session has expired. Sign in again.")
    return user

app.include_router(reports_store.create_router(require_user, require_csrf))

app.include_router(pdf_studio.create_router(require_user, require_csrf))

@app.get("/", include_in_schema=False)
def index():
    """Open the Next.js application; FastAPI remains the secured API service."""
    return RedirectResponse(os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000"))

@app.get("/api/schema")
def schema(request: Request):
    require_user(request)
    return engine.schema()


@app.get("/api/auth/me")
def current_user(request: Request):
    return {"user": require_user(request), "csrf_token": _csrf_token(request)}


@app.put("/api/auth/profile")
async def update_profile(request: Request):
    require_csrf(request)
    user = require_user(request)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid profile request.")
    try:
        updated = auth.update_user_profile(user["id"], payload)
    except auth.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except auth.AuthConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=400, detail="No valid profile fields provided.")
    request.session.clear()
    request.session["user_id"] = updated["id"]
    return {"user": updated, "csrf_token": _csrf_token(request)}


@app.post("/api/auth/reset-password")
async def reset_password(request: Request):
    require_csrf(request)
    user = require_user(request)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid password reset request.")
    current_password = payload.get("current_password", "")
    new_password = payload.get("new_password", "")
    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="Current password and new password are required.")
    try:
        updated = auth.reset_password(user["id"], current_password, new_password)
    except auth.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except auth.AuthConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=400, detail="Password reset failed.")
    request.session.clear()
    request.session["user_id"] = updated["id"]
    return {"user": updated, "csrf_token": _csrf_token(request)}


@app.post("/api/auth/avatar")
async def upload_avatar(request: Request):
    require_csrf(request)
    user = require_user(request)
    try:
        form = await request.form()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid avatar upload request.")
    file = form.get("file")
    if not file or not hasattr(file, "read") or not file.filename:
        raise HTTPException(status_code=400, detail="No avatar file provided.")
    try:
        contents = await file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to read avatar file.")
    content_type = file.content_type or "application/octet-stream"
    try:
        updated = auth.upload_avatar(user["id"], contents, file.filename, content_type)
    except auth.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except auth.AuthConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=400, detail="Avatar upload failed.")
    request.session.clear()
    request.session["user_id"] = updated["id"]
    return {"user": updated, "csrf_token": _csrf_token(request)}


@app.get("/api/auth/csrf")
def csrf_token(request: Request):
    """Issue a same-origin CSRF token for the sign-in and sign-up forms."""
    return {"csrf_token": _csrf_token(request)}


@app.post("/api/auth/signup")
async def signup(request: Request):
    require_csrf(request)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signup request.")
    try:
        user = auth.create_user(payload.get("full_name") or payload.get("display_name"), payload.get("email"), payload.get("password"))
    except auth.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except auth.AuthConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    request.session.clear()
    request.session["user_id"] = user["id"]
    return {"user": user, "csrf_token": _csrf_token(request)}


@app.post("/api/auth/login")
async def login(request: Request):
    require_csrf(request)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid login request.")
    try:
        user = auth.authenticate(payload.get("email"), payload.get("password"))
    except auth.AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except auth.AuthConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    request.session.clear()
    request.session["user_id"] = user["id"]
    return {"user": user, "csrf_token": _csrf_token(request)}


@app.post("/api/auth/logout")
def logout(request: Request):
    require_csrf(request)
    request.session.clear()
    return {"ok": True, "csrf_token": _csrf_token(request)}

@app.get("/api/project-by-rae/{rae_id}")
def project_by_rae(rae_id: str, request: Request):
    """Read-only RAE/subproject lookup used to prefill the project name."""
    require_user(request)
    try:
        result = project_lookup.find_project(rae_id)
    except project_lookup.LookupConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        # Do not reveal host, credentials, or internal database details to a browser.
        raise HTTPException(status_code=502, detail="Project lookup is temporarily unavailable.")
    if not result:
        raise HTTPException(status_code=404, detail="No project was found for this RAE ID.")
    return JSONResponse(result)


@app.get("/api/standards")
def standards(request: Request):
    require_user(request)
    try:
        return {"standards": standards_library.list_standards()}
    except standards_library.StandardsLibraryError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.get("/api/standards/{standard_id}/clauses")
def standard_clauses(standard_id: int, request: Request):
    require_user(request)
    try:
        return {"clauses": standards_library.list_clauses(standard_id)}
    except standards_library.StandardsValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except standards_library.StandardsLibraryError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.post("/api/standards/manual")
async def save_manual_standard(request: Request):
    require_csrf(request)
    require_user(request)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid standards-library entry.")
    try:
        return standards_library.save_manual_entry(payload)
    except standards_library.StandardsValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except standards_library.StandardsLibraryError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.get("/api/materials")
def materials(request: Request):
    require_user(request)
    try:
        return {"materials": materials_library.list_materials()}
    except materials_library.MaterialsLibraryError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.post("/api/materials/manual")
async def save_manual_material(request: Request):
    require_csrf(request)
    require_user(request)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid material-library entry.")
    try:
        return {"material": materials_library.save_manual_material(payload)}
    except materials_library.MaterialsValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except materials_library.MaterialsLibraryError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

@app.get("/api/template")
def template(request: Request):
    require_user(request)
    if not os.path.isfile(TEMPLATE_PDF):
        raise HTTPException(status_code=503, detail="The v2 template PDF is not available on the server.")
    data = open(TEMPLATE_PDF, "rb").read()
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="Trailer_Report_TEMPLATE_v2.pdf"'})

@app.get("/api/template/word")
def template_word(request: Request):
    require_user(request)
    # Generate this from the current report definition.  A checked-in DOCX
    # becomes stale whenever template fields such as the standards table change.
    content, _ = engine.build_word(template=True)
    return Response(content, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Disposition": 'attachment; filename="Trailer_Report_TEMPLATE.docx"'})


@app.get("/api/template/html/status")
def html_template_status(request: Request):
    """Expose whether the supplied pdf2htmlEX master is ready for export."""
    require_user(request)
    return html_master_template.status()


@app.post("/api/template/html/pdf")
async def html_template_pdf(request: Request):
    """Export the supplied HTML master after filling its grey field tokens.

    This is deliberately separate from /api/generate: the standard report
    engine remains the editable, multi-page renderer used by Section Editor.
    The HTML source can therefore be used as an exact visual master without
    breaking section navigation, overlays, added figures, or calculations.
    """
    require_csrf(request)
    require_user(request)
    form = await request.form()
    try:
        payload = json.loads(form["payload"])
    except (KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="Invalid report payload.")
    data = _normalise_report_data(payload)
    try:
        content = html_master_template.build_pdf(data)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    stem = data.get("rae_no") or "Trailer"
    return Response(content, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{stem}_HTML_Master_Report.pdf"'
    })

# Moving / resizing an image or adding text in the section editor changes only the overlay keys below.
# The slow engine build is cached on everything else, so those edits only re-run the fast PDF overlay step.
_OVERLAY_KEYS = ("img_dx__", "img_dy__", "img_scale__", "txt__")
_BUILD_CACHE = collections.OrderedDict()
_BUILD_CACHE_SIZE, _BUILD_CACHE_TTL = 6, 300


def _build_pdf_cached(data, images, selected, layout, extras, removed):
    core = {k: v for k, v in data.items() if not str(k).startswith(_OVERLAY_KEYS)}
    h = hashlib.sha1(json.dumps([core, selected, layout, extras, removed], sort_keys=True, default=str).encode())
    for k in sorted(images):
        h.update(k.encode())
        h.update(hashlib.sha1(images[k]).digest())
    key = h.hexdigest()
    # Always re-fill the v2 template to ensure dynamic values are current.
    # The cache TTL is kept for the final (content, warns, section_pages) tuple
    # but the template filling is forced on each call so that preview/generate
    # always reflects the latest report data.
    try:
        content = fill_v2_template(data, images)
        warns = []
        section_pages = get_template_section_pages()
    except Exception:
        content, warns, section_pages = engine.build(
            data, images, selected, layout=layout, extras=extras, removed=removed
        )
    result = (content, warns, section_pages)
    # Cache the final tuple (not the intermediate filled content) so that
    # repeated calls with the same parameters stay fast, but the template
    # filling itself is always forced on every call.
    if key not in _BUILD_CACHE:
        _BUILD_CACHE[key] = (time.time(), result)
    while len(_BUILD_CACHE) > _BUILD_CACHE_SIZE:
        _BUILD_CACHE.popitem(last=False)
    return result


@app.post("/api/generate")
async def generate(request: Request):
    require_csrf(request)
    require_user(request)
    form = await request.form()
    p = json.loads(form["payload"])
    images = {}
    for k, v in form.items():
        if k.startswith("img__") and hasattr(v, "read"):
            b = await v.read()
            if b: images[k[5:]] = b
    output = p.get("output", "pdf")
    data = _normalise_report_data(p)
    selected, layout = p.get("selected"), p.get("layout", {})
    extras, removed = p.get("extra_images", {}), p.get("removed_images", [])
    stem = data.get("rae_no") or "Trailer"
    if output == "word":
        content, warns = engine.build_word(data, images, selected, layout=layout, extras=extras, removed=removed)
        section_pages = {}
        name = stem + "_Certification_Report.docx"
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        content, warns, section_pages = _build_pdf_cached(data, images, selected, layout, extras, removed)
        # re-apply what the user did by hand in the section editor (moved/resized images, added text)
        content, section_pages = report_overlays.apply_editor_overlays(content, section_pages, data, images, layout)
        name = stem + "_Certification_Report.pdf"
        media_type = "application/pdf"
    return Response(content, media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="{name}"',
        "X-Warnings": urllib.parse.quote(json.dumps(warns)),
        "X-Section-Pages": urllib.parse.quote(json.dumps(section_pages)),
        "Access-Control-Expose-Headers": "X-Warnings, X-Section-Pages, Content-Disposition"})


@app.post("/api/preview/pages")
async def preview_pages(request: Request, png: int = 1):
    """Render the report PDF and return every page as a base64 PNG, plus the
    section -> page-number mapping so the frontend can show the right page."""
    require_csrf(request)
    require_user(request)
    form = await request.form()
    p = json.loads(form["payload"])
    images = {}
    for k, v in form.items():
        if k.startswith("img__") and hasattr(v, "read"):
            b = await v.read()
            if b: images[k[5:]] = b
    data = _normalise_report_data(p)
    selected, layout = p.get("selected"), p.get("layout", {})
    extras, removed = p.get("extra_images", {}), p.get("removed_images", [])
    content, warns, section_pages = _build_pdf_cached(data, images, selected, layout, extras, removed)
    content, section_pages = report_overlays.apply_editor_overlays(content, section_pages, data, images, layout)

    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"PDF rendering unavailable: {exc}")

    doc = fitz.open(stream=content, filetype="pdf")
    pages = []
    import base64
    page_count = len(doc)
    if png:  # ?png=0 skips the PNG rasters (the in-app PDF editor renders from the PDF itself)
        for i in range(page_count):
            pix = doc[i].get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
            b64 = base64.b64encode(pix.tobytes("png")).decode()
            pages.append({"page": i + 1, "dataUrl": "data:image/png;base64," + b64})
    doc.close()
    return JSONResponse({"pages": pages, "section_pages": section_pages})
