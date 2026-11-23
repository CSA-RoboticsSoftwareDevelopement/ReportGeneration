"""Server-side storage for reports, folders and photos (MySQL + files on disk)."""
import json, os, re, shutil, time, uuid
from contextlib import closing
from pathlib import Path
import pymysql
from pymysql.cursors import DictCursor
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse, Response

ROOT = Path(__file__).with_name("uploads") / "reports"
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
KINDS = {"current", "original"}
STATUSES = {"draft", "in_review", "approved", "archived"}
MAX_IMG = 25 * 1024 * 1024
MAX_JSON = 20 * 1024 * 1024


def _conn():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "csareport"),
        charset="utf8mb4", cursorclass=DictCursor, autocommit=False,
    )


def _run(sql, args=(), *, one=False, all_=False):
    with closing(_conn()) as con:
        with con.cursor() as cur:
            cur.execute(sql, args)
            result = cur.fetchone() if one else cur.fetchall() if all_ else None
        con.commit()
        return result


def _owner(user):
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(user.get("id")))[:64]


def _check(value, what="id"):
    if not ID_RE.match(str(value or "")):
        raise HTTPException(status_code=400, detail=f"Invalid {what}.")
    return value


def _dir(owner, rid):
    return ROOT / "files" / owner / rid


def _own(owner, rid):
    row = _run("SELECT * FROM rg_reports WHERE id=%s AND owner=%s", (rid, owner), one=True)
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")
    return row


def _pub(r):
    return {
        "id": r["id"], "title": r["title"] or "Untitled report", "rae": r["rae"] or "",
        "project": r["project"] or "", "rev": r["rev"] or "", "axle": r["axle"] or "",
        "editor": r["editor"] or "", "status": r["status"] or "draft",
        "starred": bool(r["starred"]), "pinned": bool(r["pinned"]), "folder": r["folder"] or "",
        "sections": r["sections"] or 0, "figures": r["figures"] or 0, "thumb": r["thumb"] or "",
        "sig": r["sig"] or "", "createdAt": r["created"], "updatedAt": r["updated"],
        "lastViewedAt": r["viewed"],
    }


def create_router(require_user, require_csrf) -> APIRouter:
    router = APIRouter(prefix="/api/report-store", tags=["Report store"])

    @router.get("/reports")
    def list_reports(request: Request):
        owner = _owner(require_user(request))
        rows = _run(
            "SELECT id,title,rae,project,rev,axle,editor,status,starred,pinned,folder,sections,"
            "figures,thumb,sig,created,updated,viewed FROM rg_reports WHERE owner=%s ORDER BY updated DESC",
            (owner,), all_=True)
        return JSONResponse({"reports": [_pub(r) for r in rows]})

    @router.get("/reports/{rid}")
    def get_report(rid: str, request: Request):
        owner = _owner(require_user(request)); _check(rid)
        row = _own(owner, rid)
        _run("UPDATE rg_reports SET viewed=%s WHERE id=%s", (int(time.time() * 1000), rid))
        imgs = _run("SELECT image_id,kind,filename,mime FROM rg_images WHERE report_id=%s", (rid,), all_=True)
        out = _pub(row)
        out["snapshot"] = json.loads(row["snapshot"] or "{}")
        out["editor_states"] = json.loads(row["editor_states"] or "{}")
        out["images"] = list(imgs)
        return JSONResponse(out)

    @router.put("/reports/{rid}")
    async def save_report(rid: str, request: Request):
        user = require_user(request); require_csrf(request)
        owner = _owner(user); _check(rid)
        try:
            p = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid report data.")
        snapshot = json.dumps(p.get("snapshot") or {})
        states = json.dumps(p.get("editor_states") or {})
        if len(snapshot) + len(states) > MAX_JSON:
            raise HTTPException(status_code=413, detail="Report data is too large.")
        s = lambda k, n=200: str(p.get(k) or "")[:n]
        i = lambda k: max(0, int(p.get(k) or 0))
        thumb = str(p.get("thumb") or "")
        thumb = thumb if len(thumb) < 400_000 else ""
        now = int(time.time() * 1000)
        existing = _run("SELECT owner FROM rg_reports WHERE id=%s", (rid,), one=True)
        if existing and existing["owner"] != owner:
            raise HTTPException(status_code=404, detail="Report not found.")
        vals = (s("title", 255), s("rae", 120), s("project", 255), s("rev", 40), s("axle", 60), s("editor", 255),
                i("sections"), i("figures"), thumb, s("sig", 200000), snapshot, states, now)
        if existing:
            _run("UPDATE rg_reports SET title=%s,rae=%s,project=%s,rev=%s,axle=%s,editor=%s,sections=%s,"
                 "figures=%s,thumb=%s,sig=%s,snapshot=%s,editor_states=%s,updated=%s WHERE id=%s", vals + (rid,))
        else:
            _run("INSERT INTO rg_reports(title,rae,project,rev,axle,editor,sections,figures,thumb,sig,"
                 "snapshot,editor_states,updated,id,owner,created,viewed) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                 vals + (rid, owner, now, now))
        return JSONResponse({"ok": True, "updatedAt": now})

    @router.patch("/reports/{rid}")
    async def patch_report(rid: str, request: Request):
        owner = _owner(require_user(request)); require_csrf(request); _check(rid)
        p = await request.json()
        _own(owner, rid)
        sets, vals = [], []
        if "status" in p:
            if p["status"] not in STATUSES:
                raise HTTPException(status_code=400, detail="Invalid status.")
            sets.append("status=%s"); vals.append(p["status"])
        for key in ("starred", "pinned"):
            if key in p:
                sets.append(f"{key}=%s"); vals.append(1 if p[key] else 0)
        if "folder" in p:
            sets.append("folder=%s"); vals.append(str(p["folder"] or "")[:60])
        if sets:
            _run(f"UPDATE rg_reports SET {','.join(sets)} WHERE id=%s", tuple(vals) + (rid,))
        return JSONResponse({"ok": True})

    @router.delete("/reports/{rid}")
    def delete_report(rid: str, request: Request):
        owner = _owner(require_user(request)); require_csrf(request); _check(rid)
        _own(owner, rid)
        _run("DELETE FROM rg_images WHERE report_id=%s", (rid,))
        _run("DELETE FROM rg_reports WHERE id=%s", (rid,))
        shutil.rmtree(_dir(owner, rid), ignore_errors=True)
        return JSONResponse({"ok": True})

    @router.post("/reports/{rid}/duplicate")
    def duplicate(rid: str, request: Request):
        owner = _owner(require_user(request)); require_csrf(request); _check(rid)
        row = _own(owner, rid)
        new = uuid.uuid4().hex
        now = int(time.time() * 1000)
        _run("INSERT INTO rg_reports(id,owner,title,rae,project,rev,axle,editor,status,starred,pinned,folder,"
             "sections,figures,thumb,sig,snapshot,editor_states,created,updated,viewed) "
             "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,'draft',0,0,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
             (new, owner, (row["title"] or "Untitled report") + " (copy)", row["rae"], row["project"], row["rev"],
              row["axle"], row["editor"], row["folder"], row["sections"], row["figures"], row["thumb"],
              row["sig"], row["snapshot"], row["editor_states"], now, now, now))
        _run("INSERT INTO rg_images(report_id,image_id,kind,filename,mime) "
             "SELECT %s,image_id,kind,filename,mime FROM rg_images WHERE report_id=%s", (new, rid))
        src = _dir(owner, rid)
        if src.is_dir():
            shutil.copytree(src, _dir(owner, new))
        return JSONResponse(_pub(_own(owner, new)))

    # ---- photos ----------------------------------------------------------
    @router.put("/reports/{rid}/images/{iid}")
    async def put_image(rid: str, iid: str, request: Request, kind: str = "current", file: UploadFile = File(...)):
        owner = _owner(require_user(request)); require_csrf(request); _check(rid); _check(iid, "image id")
        if kind not in KINDS:
            raise HTTPException(status_code=400, detail="Invalid image kind.")
        _own(owner, rid)
        data = await file.read(MAX_IMG + 1)
        if not data or len(data) > MAX_IMG:
            raise HTTPException(status_code=413, detail="Image is empty or larger than 25 MB.")
        mime = file.content_type or ""
        if not mime.startswith("image/"):
            raise HTTPException(status_code=400, detail="Only image files can be stored.")
        folder = _dir(owner, rid); folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{kind}__{iid}").write_bytes(data)
        _run("REPLACE INTO rg_images(report_id,image_id,kind,filename,mime) VALUES(%s,%s,%s,%s,%s)",
             (rid, iid, kind, (file.filename or iid)[:120], mime[:100]))
        return JSONResponse({"ok": True})

    @router.get("/reports/{rid}/images/{iid}")
    def get_image(rid: str, iid: str, request: Request, kind: str = "current"):
        owner = _owner(require_user(request)); _check(rid); _check(iid, "image id")
        _own(owner, rid)
        row = _run("SELECT mime FROM rg_images WHERE report_id=%s AND image_id=%s AND kind=%s", (rid, iid, kind), one=True)
        path = _dir(owner, rid) / f"{kind}__{iid}"
        if not row or not path.is_file():
            raise HTTPException(status_code=404, detail="Image not found.")
        return Response(path.read_bytes(), media_type=row["mime"] or "application/octet-stream",
                        headers={"Cache-Control": "private, max-age=3600"})

    @router.delete("/reports/{rid}/images/{iid}")
    def delete_image(rid: str, iid: str, request: Request, kind: str = "current"):
        owner = _owner(require_user(request)); require_csrf(request); _check(rid); _check(iid, "image id")
        _own(owner, rid)
        _run("DELETE FROM rg_images WHERE report_id=%s AND image_id=%s AND kind=%s", (rid, iid, kind))
        (_dir(owner, rid) / f"{kind}__{iid}").unlink(missing_ok=True)
        return JSONResponse({"ok": True})

    # ---- folders ---------------------------------------------------------
    @router.get("/folders")
    def folders(request: Request):
        owner = _owner(require_user(request))
        rows = _run("SELECT name FROM rg_folders WHERE owner=%s ORDER BY name", (owner,), all_=True)
        return JSONResponse({"folders": [r["name"] for r in rows]})

    @router.post("/folders")
    async def add_folder(request: Request):
        owner = _owner(require_user(request)); require_csrf(request)
        name = str((await request.json()).get("name") or "").strip()[:60]
        if not name:
            raise HTTPException(status_code=400, detail="Enter a folder name.")
        _run("INSERT IGNORE INTO rg_folders(owner,name) VALUES(%s,%s)", (owner, name))
        return JSONResponse({"ok": True})

    @router.delete("/folders")
    def delete_folder(request: Request, name: str):
        owner = _owner(require_user(request)); require_csrf(request)
        _run("DELETE FROM rg_folders WHERE owner=%s AND name=%s", (owner, name))
        _run("UPDATE rg_reports SET folder='' WHERE owner=%s AND folder=%s", (owner, name))
        return JSONResponse({"ok": True})

    return router