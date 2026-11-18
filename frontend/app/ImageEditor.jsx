"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const COLORS = ["#f84f63", "#fbbf24", "#38bdf8"];
const HANDLE = 9;
const MAX_HISTORY = 50;

const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

function withTextBox(el) {
  if (el.type !== "text") return el;
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${el.fontSize}px sans-serif`;
  return { ...el, w: Math.max(ctx.measureText(el.text || " ").width, 10), h: el.fontSize * 1.25 };
}

function bbox(el) {
  if (el.type === "arrow") {
    return { x: Math.min(el.x, el.x2), y: Math.min(el.y, el.y2), w: Math.abs(el.x2 - el.x), h: Math.abs(el.y2 - el.y) };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

function handlesOf(el) {
  if (el.type === "arrow") {
    return [{ name: "start", x: el.x, y: el.y }, { name: "end", x: el.x2, y: el.y2 }];
  }
  return [
    { name: "nw", x: el.x, y: el.y },
    { name: "ne", x: el.x + el.w, y: el.y },
    { name: "sw", x: el.x, y: el.y + el.h },
    { name: "se", x: el.x + el.w, y: el.y + el.h },
  ];
}

function distToSegment(p, el) {
  const dx = el.x2 - el.x, dy = el.y2 - el.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - el.x) * dx + (p.y - el.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (el.x + t * dx), p.y - (el.y + t * dy));
}

function hitEl(el, p, k) {
  if (!el.visible || el.locked) return false;
  const tol = 8 * k;
  if (el.type === "arrow") return distToSegment(p, el) <= Math.max(tol, el.lineWidth);
  return p.x >= el.x - tol / 2 && p.x <= el.x + el.w + tol / 2 && p.y >= el.y - tol / 2 && p.y <= el.y + el.h + tol / 2;
}

function drawEl(ctx, el) {
  if (!el.visible) return;
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.strokeStyle = el.color || "#f84f63";
  ctx.fillStyle = el.color || "#f84f63";
  ctx.lineWidth = el.lineWidth || 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (el.type === "image") {
    if (el.img) {
      const c = el.crop;
      if (c) ctx.drawImage(el.img, c.sx, c.sy, c.sw, c.sh, el.x, el.y, el.w, el.h);
      else ctx.drawImage(el.img, el.x, el.y, el.w, el.h);
    }
  } else if (el.type === "rect") {
    ctx.strokeRect(el.x, el.y, el.w, el.h);
  } else if (el.type === "oval") {
    ctx.beginPath();
    ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (el.type === "arrow") {
    const head = Math.max(12, el.lineWidth * 4);
    const angle = Math.atan2(el.y2 - el.y, el.x2 - el.x);
    // stop the shaft slightly short so the head stays crisp
    const sx = el.x2 - Math.cos(angle) * head * 0.6;
    const sy = el.y2 - Math.sin(angle) * head * 0.6;
    ctx.beginPath();
    ctx.moveTo(el.x, el.y);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(el.x2, el.y2);
    ctx.lineTo(el.x2 - head * Math.cos(angle - Math.PI / 6), el.y2 - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(el.x2 - head * Math.cos(angle + Math.PI / 6), el.y2 - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  } else if (el.type === "text") {
    ctx.font = `${el.fontSize}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(el.text || "", el.x, el.y);
  }
  ctx.restore();
}

function drawSelection(ctx, el, k) {
  ctx.save();
  const b = bbox(el);
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 1.5 * k;
  ctx.setLineDash([6 * k, 4 * k]);
  if (el.type !== "arrow") ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  if (!el.locked) {
    for (const h of handlesOf(el)) {
      const s = HANDLE * k;
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(h.x - s / 2, h.y - s / 2, s, s);
      ctx.strokeStyle = "#0a1f36";
      ctx.lineWidth = k;
      ctx.strokeRect(h.x - s / 2, h.y - s / 2, s, s);
    }
  }
  ctx.restore();
}

/* ---------------- crop helpers ---------------- */

const CROP_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function cropHandles(r) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, x2 = r.x + r.w, y2 = r.y + r.h;
  const pos = { nw: [r.x, r.y], n: [cx, r.y], ne: [x2, r.y], e: [x2, cy], se: [x2, y2], s: [cx, y2], sw: [r.x, y2], w: [r.x, cy] };
  return CROP_HANDLES.map((name) => ({ name, x: pos[name][0], y: pos[name][1] }));
}

function resizeRect(rect, name, p, box) {
  const MIN = 10;
  let l = rect.x, t = rect.y, r = rect.x + rect.w, b = rect.y + rect.h;
  if (name.includes("w")) l = Math.min(Math.max(p.x, box.x), r - MIN);
  if (name.includes("e")) r = Math.max(Math.min(p.x, box.x + box.w), l + MIN);
  if (name.includes("n")) t = Math.min(Math.max(p.y, box.y), b - MIN);
  if (name.includes("s")) b = Math.max(Math.min(p.y, box.y + box.h), t + MIN);
  return { x: l, y: t, w: r - l, h: b - t };
}

function drawCropOverlay(ctx, box, rect, k) {
  ctx.save();
  ctx.fillStyle = "rgba(5,15,28,0.6)";
  ctx.fillRect(box.x, box.y, box.w, rect.y - box.y);
  ctx.fillRect(box.x, rect.y + rect.h, box.w, box.y + box.h - rect.y - rect.h);
  ctx.fillRect(box.x, rect.y, rect.x - box.x, rect.h);
  ctx.fillRect(rect.x + rect.w, rect.y, box.x + box.w - rect.x - rect.w, rect.h);
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 1.5 * k;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = k;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(rect.x + (rect.w * i) / 3, rect.y); ctx.lineTo(rect.x + (rect.w * i) / 3, rect.y + rect.h);
    ctx.moveTo(rect.x, rect.y + (rect.h * i) / 3); ctx.lineTo(rect.x + rect.w, rect.y + (rect.h * i) / 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const s = HANDLE * k;
  for (const h of cropHandles(rect)) {
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(h.x - s / 2, h.y - s / 2, s, s);
    ctx.strokeStyle = "#0a1f36";
    ctx.strokeRect(h.x - s / 2, h.y - s / 2, s, s);
  }
  ctx.restore();
}

const TOOLS = [
  { id: "select", label: "Select", glyph: "\u2196" },
  { id: "arrow", label: "Arrow", glyph: "\u2192" },
  { id: "rect", label: "Rectangle", glyph: "\u25A1" },
  { id: "oval", label: "Oval", glyph: "\u2B2D" },
  { id: "text", label: "Text", glyph: "T" },
];
const LABELS = { image: "Image", arrow: "Arrow", rect: "Box", oval: "Oval", text: "Text" };

const btn =
  "rounded-md border border-[#2f5b75] bg-[#16415f] px-2.5 py-1 text-xs font-semibold text-[#c6dce2] hover:bg-white/10 disabled:opacity-40";

/**
 * Props
 *  imageUrl      – URL (blob:/data:/same-origin) of the ORIGINAL base image
 *  initialState  – optional object returned earlier as `state` from onSave (restores layers)
 *  title         – optional heading, e.g. the figure caption
 *  onSave(file, state, dataUrl) – file: PNG File of the flattened result,
 *                  state: JSON-serialisable layers (store it to re-open editing later)
 *  onClose()     – cancel
 */
export default function ImageEditor({ imageUrl, initialState, title, onSave, onClose }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const fileRef = useRef(null);
  const textInputRef = useRef(null);
  const elsRef = useRef([]);
  const hist = useRef({ stack: [], i: -1 });
  const drag = useRef(null);
  const layerCounter = useRef(2);
  const wantTextFocus = useRef(false);

  const [els, setEls] = useState([]);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState(COLORS[0]);
  const [fontSize, setFontSize] = useState(20);
  const [full, setFull] = useState(false);
  const [showLayers, setShowLayers] = useState(true);
  const [loading, setLoading] = useState(true);
  const [crop, setCrop] = useState(null); // { id, rect: {x,y,w,h} } while cropping
  const [, setTick] = useState(0); // forces redraw / undo-state refresh

  const unit = Math.max(0.5, size.w / 900); // keeps line/text size sensible on big images
  const selected = els.find((e) => e.id === selectedId) || null;

  const setAll = useCallback((next, record) => {
    elsRef.current = next;
    setEls(next);
    if (record) {
      const h = hist.current;
      h.stack = h.stack.slice(0, h.i + 1);
      h.stack.push(next.map((e) => ({ ...e })));
      if (h.stack.length > MAX_HISTORY) h.stack.shift();
      h.i = h.stack.length - 1;
      setTick((t) => t + 1);
    }
  }, []);

  // ---------- load base image (+ saved layers) ----------
  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true);
      try {
        const base = await loadImage(imageUrl);
        const savedBase = initialState?.base || {};
        const list = [{
          id: "base", type: "image", isBase: true, name: "Layer 1: Base image", img: base,
          x: 0, y: 0, w: base.naturalWidth, h: base.naturalHeight,
          locked: false, visible: true, opacity: 1, lockAspect: true,
          ...savedBase,
        }];
        for (const s of initialState?.elements || []) {
          const el = { ...s };
          if (el.type === "image") el.img = await loadImage(el.src);
          list.push(withTextBox(el));
        }
        if (dead) return;
        layerCounter.current = list.length + 1;
        hist.current = { stack: [], i: -1 };
        setSize(initialState?.canvas || { w: base.naturalWidth, h: base.naturalHeight });
        setSelectedId(null);
        setCrop(null);
        setAll(list, true);
      } catch {
        /* image failed to load */
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // ---------- drawing ----------
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const el of els) drawEl(ctx, el);
    const r = cv.getBoundingClientRect();
    const k = r.width ? cv.width / r.width : 1;
    const cropEl = crop && els.find((e) => e.id === crop.id);
    if (cropEl) drawCropOverlay(ctx, { x: cropEl.x, y: cropEl.y, w: cropEl.w, h: cropEl.h }, crop.rect, k);
    else if (selected && selected.visible) drawSelection(ctx, selected, k);
  });

  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (wantTextFocus.current && selected?.type === "text") {
      wantTextFocus.current = false;
      textInputRef.current?.focus();
      textInputRef.current?.select();
    }
  }, [selectedId, selected?.type]);

  // ---------- helpers ----------
  const toLogical = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * cv.width) / r.width, y: ((e.clientY - r.top) * cv.height) / r.height, k: cv.width / r.width };
  };

  const patch = useCallback((id, p, record = true) => {
    setAll(elsRef.current.map((e) => (e.id === id ? withTextBox({ ...e, ...p }) : e)), record);
  }, [setAll]);

  const nextName = (type) => `Layer ${layerCounter.current++}: ${LABELS[type]}`;

  // ---------- pointer interaction ----------
  const onPointerDown = (e) => {
    if (loading) return;
    const cv = canvasRef.current;
    const p = toLogical(e);
    const list = elsRef.current;
    const sel = list.find((x) => x.id === selectedId);

    if (crop) {
      const el = list.find((x) => x.id === crop.id);
      if (!el) return;
      const box = { x: el.x, y: el.y, w: el.w, h: el.h };
      const r = crop.rect;
      const h = cropHandles(r).find((hh) => Math.hypot(hh.x - p.x, hh.y - p.y) <= (HANDLE + 4) * p.k);
      if (h) drag.current = { mode: "cropresize", handle: h.name, box, start: p, orig: { ...r } };
      else if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) drag.current = { mode: "cropmove", box, start: p, orig: { ...r } };
      else return;
      cv.setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "select") {
      if (sel && !sel.locked && sel.visible) {
        const h = handlesOf(sel).find((hh) => Math.hypot(hh.x - p.x, hh.y - p.y) <= (HANDLE + 4) * p.k);
        if (h) {
          drag.current = { mode: "resize", id: sel.id, handle: h.name, orig: { ...sel }, start: p, moved: false };
          cv.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = [...list].reverse().find((x) => hitEl(x, p, p.k));
      if (hit) {
        setSelectedId(hit.id);
        drag.current = { mode: "move", id: hit.id, orig: { ...hit }, start: p, moved: false };
        cv.setPointerCapture(e.pointerId);
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (tool === "text") {
      const el = withTextBox({
        id: uid("text"), type: "text", name: nextName("text"), x: p.x, y: p.y,
        text: "New text", fontSize: Math.round(fontSize * unit), color, opacity: 1, visible: true, locked: false,
      });
      setAll([...list, el], true);
      wantTextFocus.current = true;
      setSelectedId(el.id);
      setTool("select");
      return;
    }

    const base = {
      id: uid(tool), type: tool, name: nextName(tool), color, lineWidth: Math.round(3 * unit * 10) / 10,
      opacity: 1, visible: true, locked: false,
    };
    const el = tool === "arrow" ? { ...base, x: p.x, y: p.y, x2: p.x, y2: p.y } : { ...base, x: p.x, y: p.y, w: 0, h: 0 };
    setAll([...list, el], false);
    setSelectedId(el.id);
    drag.current = { mode: "create", id: el.id, start: p, moved: false };
    cv.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const p = toLogical(e);
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    d.moved = true;
    if (d.mode === "cropresize") {
      setCrop((c) => c && { ...c, rect: resizeRect(d.orig, d.handle, p, d.box) });
      return;
    }
    if (d.mode === "cropmove") {
      const o = d.orig, b = d.box;
      setCrop((c) => c && {
        ...c,
        rect: {
          ...o,
          x: Math.min(Math.max(o.x + dx, b.x), b.x + b.w - o.w),
          y: Math.min(Math.max(o.y + dy, b.y), b.y + b.h - o.h),
        },
      });
      return;
    }
    const list = elsRef.current.map((el) => {
      if (el.id !== d.id) return el;
      if (d.mode === "create") {
        if (el.type === "arrow") return { ...el, x2: p.x, y2: p.y };
        return { ...el, x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(dx), h: Math.abs(dy) };
      }
      const o = d.orig;
      if (d.mode === "move") {
        if (el.type === "arrow") return { ...el, x: o.x + dx, y: o.y + dy, x2: o.x2 + dx, y2: o.y2 + dy };
        return { ...el, x: o.x + dx, y: o.y + dy };
      }
      // resize
      if (el.type === "arrow") {
        return d.handle === "start" ? { ...el, x: p.x, y: p.y } : { ...el, x2: p.x, y2: p.y };
      }
      const west = d.handle.includes("w"), north = d.handle.includes("n");
      const ax = west ? o.x + o.w : o.x; // fixed (opposite) corner
      const ay = north ? o.y + o.h : o.y;
      if (el.type === "text") {
        const scale = Math.max(0.2, Math.abs(p.y - ay) / o.h);
        const w = o.w * scale, h = o.h * scale;
        return { ...el, fontSize: Math.max(6, o.fontSize * scale), w, h, x: west ? ax - w : ax, y: north ? ay - h : ay };
      }
      let nx = p.x, ny = p.y;
      if (el.lockAspect) {
        const aspect = o.w / o.h;
        const w = Math.max(8, Math.abs(nx - ax));
        const h = w / aspect;
        nx = ax + (nx >= ax ? w : -w);
        ny = ay + (ny >= ay ? h : -h);
      }
      return { ...el, x: Math.min(ax, nx), y: Math.min(ay, ny), w: Math.max(8, Math.abs(nx - ax)), h: Math.max(8, Math.abs(ny - ay)) };
    });
    setAll(list, false);
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try { canvasRef.current.releasePointerCapture(e.pointerId); } catch {}
    if (d.mode === "cropresize" || d.mode === "cropmove") return;
    let list = elsRef.current;
    if (d.mode === "create") {
      const el = list.find((x) => x.id === d.id);
      const tiny = el && (el.type === "arrow" ? Math.hypot(el.x2 - el.x, el.y2 - el.y) < 8 * unit : el.w < 6 && el.h < 6);
      if (tiny) {
        list = list.filter((x) => x.id !== d.id);
        setSelectedId(null);
      }
      setAll(list, true);
      setTool("select");
    } else if (d.moved) {
      setAll(list, true);
    }
  };

  // ---------- history ----------
  const undo = () => {
    const h = hist.current;
    if (h.i <= 0) return;
    h.i -= 1;
    setAll(h.stack[h.i].map((x) => ({ ...x })), false);
    setTick((t) => t + 1);
  };
  const redo = () => {
    const h = hist.current;
    if (h.i >= h.stack.length - 1) return;
    h.i += 1;
    setAll(h.stack[h.i].map((x) => ({ ...x })), false);
    setTick((t) => t + 1);
  };

  // ---------- layer actions ----------
  const removeSel = useCallback(() => {
    if (!selectedId || selectedId === "base") return;
    setAll(elsRef.current.filter((e) => e.id !== selectedId), true);
    setSelectedId(null);
  }, [selectedId, setAll]);

  const duplicateSel = () => {
    if (!selected || selected.isBase) return;
    const off = 20 * unit;
    const copy = { ...selected, id: uid(selected.type), name: nextName(selected.type), x: selected.x + off, y: selected.y + off };
    if (selected.type === "arrow") { copy.x2 = selected.x2 + off; copy.y2 = selected.y2 + off; }
    setAll([...elsRef.current, copy], true);
    setSelectedId(copy.id);
  };

  const moveLayer = (dir) => {
    const list = [...elsRef.current];
    const i = list.findIndex((e) => e.id === selectedId);
    const j = i + dir;
    if (i < 0 || j < 1 || j >= list.length) return; // index 0 stays the base layer
    [list[i], list[j]] = [list[j], list[i]];
    setAll(list, true);
  };

  const addOverlay = async (file) => {
    if (!file) return;
    const src = await fileToDataUrl(file);
    const img = await loadImage(src);
    const s = Math.min(1, (size.w * 0.3) / img.naturalWidth);
    const el = {
      id: uid("img"), type: "image", name: nextName("image"), src, img, lockAspect: true,
      x: size.w * 0.1, y: size.h * 0.1, w: img.naturalWidth * s, h: img.naturalHeight * s,
      opacity: 1, visible: true, locked: false,
    };
    setAll([...elsRef.current, el], true);
    setSelectedId(el.id);
  };

  const applyColor = (c) => {
    setColor(c);
    if (selected && !selected.isBase && selected.type !== "image") patch(selected.id, { color: c });
  };

  // ---------- export ----------
  const renderFlat = () => {
    const out = document.createElement("canvas");
    out.width = size.w;
    out.height = size.h;
    const ctx = out.getContext("2d");
    for (const el of elsRef.current) drawEl(ctx, el);
    return out;
  };

  const serialize = () => {
    const base = elsRef.current.find((e) => e.isBase);
    return {
      canvas: { w: size.w, h: size.h },
      base: base
        ? { x: base.x, y: base.y, w: base.w, h: base.h, crop: base.crop || null, visible: base.visible, opacity: base.opacity, lockAspect: base.lockAspect }
        : null,
      elements: elsRef.current.filter((e) => !e.isBase).map(({ img, ...rest }) => rest),
    };
  };

  const handleSave = () => {
    const out = renderFlat();
    out.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `edited_${Date.now()}.png`, { type: "image/png" });
      onSave?.(file, serialize(), out.toDataURL("image/png"));
    }, "image/png");
  };

  const exportPng = () => {
    renderFlat().toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "snapshot.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };

  const clearAnnotations = () => {
    setCrop(null);
    setAll(elsRef.current.filter((e) => e.isBase), true);
    setSelectedId(null);
  };

  // ---------- base / crop actions ----------
  const resetBase = () => {
    const b = elsRef.current.find((e) => e.isBase);
    if (!b) return;
    patch(b.id, { x: 0, y: 0, w: b.img.naturalWidth, h: b.img.naturalHeight, crop: null, w0: undefined, h0: undefined });
  };

  // Crops/grows the canvas to exactly the base image, shifting every layer with it.
  const fitCanvas = () => {
    const b = elsRef.current.find((e) => e.isBase);
    if (!b) return;
    const dx = -b.x, dy = -b.y;
    const next = elsRef.current.map((e) =>
      e.type === "arrow"
        ? { ...e, x: e.x + dx, y: e.y + dy, x2: e.x2 + dx, y2: e.y2 + dy }
        : { ...e, x: e.x + dx, y: e.y + dy }
    );
    setSize({ w: Math.max(20, Math.round(b.w)), h: Math.max(20, Math.round(b.h)) });
    setAll(next, true);
  };

  const startCrop = () => {
    if (!selected || selected.type !== "image" || selected.locked) return;
    setTool("select");
    setCrop({ id: selected.id, rect: { x: selected.x, y: selected.y, w: selected.w, h: selected.h } });
  };

  const applyCrop = () => {
    if (!crop) return;
    const el = elsRef.current.find((x) => x.id === crop.id);
    if (!el) { setCrop(null); return; }
    const c = el.crop || { sx: 0, sy: 0, sw: el.img.naturalWidth, sh: el.img.naturalHeight };
    const r = crop.rect;
    patch(el.id, {
      crop: {
        sx: c.sx + ((r.x - el.x) / el.w) * c.sw,
        sy: c.sy + ((r.y - el.y) / el.h) * c.sh,
        sw: (c.sw * r.w) / el.w,
        sh: (c.sh * r.h) / el.h,
      },
      x: r.x, y: r.y, w: r.w, h: r.h, w0: undefined, h0: undefined,
    });
    setCrop(null);
  };

  // brings the full image back at the current on-screen scale
  const resetCrop = () => {
    if (!selected || selected.type !== "image" || !selected.crop) return;
    const c = selected.crop, kx = selected.w / c.sw, ky = selected.h / c.sh;
    patch(selected.id, {
      crop: null,
      x: selected.x - c.sx * kx, y: selected.y - c.sy * ky,
      w: selected.img.naturalWidth * kx, h: selected.img.naturalHeight * ky,
      w0: undefined, h0: undefined,
    });
  };

  useEffect(() => {
    if (!full) return;
    const onEsc = (e) => { if (e.key === "Escape" && !crop) setFull(false); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [full, crop]);

  // ---------- keyboard (ignored while typing in inputs) ----------
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (crop) { if (e.key === "Escape") setCrop(null); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSel(); }
      else if (e.key === "Escape") { setSelectedId(null); setTool("select"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const canUndo = hist.current.i > 0;
  const canRedo = hist.current.i < hist.current.stack.length - 1;
  const num = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
  const box = selected ? bbox(selected) : null;

  const setBox = (key, value) => {
    if (!selected || selected.locked) return;
    const v = parseFloat(value);
    if (!Number.isFinite(v)) return;
    if (selected.type === "arrow") {
      const b = bbox(selected);
      const dx = key === "x" ? v - b.x : 0, dy = key === "y" ? v - b.y : 0;
      patch(selected.id, { x: selected.x + dx, y: selected.y + dy, x2: selected.x2 + dx, y2: selected.y2 + dy });
    } else if (selected.type === "text" && (key === "w" || key === "h")) {
      const f = key === "w" ? v / selected.w : v / selected.h;
      patch(selected.id, { fontSize: Math.max(6, selected.fontSize * f) });
    } else if (selected.lockAspect && (key === "w" || key === "h")) {
      const a = selected.w / selected.h;
      patch(selected.id, key === "w" ? { w: v, h: v / a } : { h: v, w: v * a });
    } else {
      patch(selected.id, { [key]: v });
    }
  };

  const setScale = (value) => {
    const pct = parseFloat(value);
    if (!selected || selected.locked || selected.type === "arrow" || !Number.isFinite(pct) || pct < 5) return;
    const f = pct / 100;
    if (!selected.w0) {
      patch(selected.id, { w0: selected.w, h0: selected.h, fs0: selected.fontSize });
    }
    const w0 = selected.w0 || selected.w, h0 = selected.h0 || selected.h;
    if (selected.type === "text") patch(selected.id, { fontSize: (selected.fs0 || selected.fontSize) * f });
    else patch(selected.id, { w: w0 * f, h: h0 * f });
  };
  const scalePct = selected && selected.w0 ? Math.round((selected.w / selected.w0) * 100) : 100;

  const numInput = (label, key) => (
    <label className="flex items-center gap-1 text-[11px] text-[#9bbcc0]">
      {label}
      <input
        type="number"
        value={box ? num(box[key]) : ""}
        disabled={!selected || selected.locked || !!crop}
        onChange={(e) => setBox(key, e.target.value)}
        className="w-16 rounded border border-[#2f5b75] bg-[#0a1f36] px-1.5 py-1 text-xs text-white disabled:opacity-40"
      />
    </label>
  );

  return (
      <div className={`flex flex-col overflow-hidden border border-[#2a5068] bg-[#0b2b47] ${full ? "fixed inset-0 z-[90] h-screen" : "h-full rounded-2xl"}`}>
      {/* tools */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#2a5068]/50 bg-[#0a2744]/60 p-3">
        <div className="flex gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={t.label}
              onClick={() => setTool(t.id)}
              className={`h-9 w-9 rounded-md border text-base font-semibold transition ${
                tool === t.id ? "border-[#f84f63] bg-[#f84f63]/20 text-[#f84f63]" : "border-[#2f5b75] bg-[#16415f] text-[#c6dce2] hover:bg-white/10"
              }`}
            >
              {t.glyph}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 pl-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => applyColor(c)}
              style={{ background: c }}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-white" : "border-transparent"}`}
              aria-label={`Colour ${c}`}
            />
          ))}
          <input type="color" value={color} onChange={(e) => applyColor(e.target.value)} className="h-6 w-6 cursor-pointer bg-transparent" />
        </div>
        <div className="flex items-center gap-1 pl-2 text-xs text-[#9bbcc0]">
          Text
          <button className={btn} onClick={() => setFontSize((v) => Math.max(8, v - 2))}>{"\u2212"}</button>
          <span className="w-6 text-center">{fontSize}</span>
          <button className={btn} onClick={() => setFontSize((v) => v + 2)}>+</button>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button className={btn} onClick={() => setShowLayers((v) => !v)}>Layers ({els.length})</button>
          <button className={btn} onClick={() => fileRef.current?.click()}>+ Add Overlay</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { addOverlay(e.target.files?.[0]); e.target.value = ""; }} />
          <button className={btn} onClick={undo} disabled={!canUndo || !!crop} title="Undo">{"\u21B6"}</button>
          <button className={btn} onClick={redo} disabled={!canRedo || !!crop} title="Redo">{"\u21B7"}</button>
          <button className={btn} onClick={() => setFull((v) => !v)} title={full ? "Exit full screen (Esc)" : "Full screen"} aria-label="Toggle full screen">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {full
                ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </svg>
          </button>
        </div>
      </div>

      {/* properties */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[#2a5068]/50 bg-[#081c33] px-3 py-2">
        <span className="max-w-[220px] truncate text-xs font-semibold text-[#38bdf8]">{selected ? selected.name : title || "No layer selected"}</span>
        {numInput("X", "x")}{numInput("Y", "y")}{numInput("W", "w")}{numInput("H", "h")}
        <label className="flex items-center gap-1 text-[11px] text-[#9bbcc0]">
          Scale %
          <input type="number" value={selected && selected.type !== "arrow" ? scalePct : ""} disabled={!selected || selected.locked || selected.type === "arrow" || !!crop}
            onChange={(e) => setScale(e.target.value)}
            className="w-16 rounded border border-[#2f5b75] bg-[#0a1f36] px-1.5 py-1 text-xs text-white disabled:opacity-40" />
        </label>
        {selected?.type === "text" && (
          <input
            ref={textInputRef}
            value={selected.text}
            onChange={(e) => patch(selected.id, { text: e.target.value }, false)}
            onBlur={() => setAll(elsRef.current, true)}
            placeholder="Type text…"
            className="min-w-[160px] flex-1 rounded border border-[#2f5b75] bg-[#0a1f36] px-2 py-1 text-xs text-white"
          />
        )}
        {selected?.type === "image" && !crop && (
          <>
            <button className={btn} onClick={startCrop} disabled={selected.locked}>Crop</button>
            {selected.crop && <button className={btn} onClick={resetCrop}>Reset crop</button>}
          </>
        )}
        {crop && (
          <>
            <button className="rounded-md bg-[#fbbf24] px-3 py-1 text-xs font-semibold text-[#0a1f36] hover:bg-[#fcd34d]" onClick={applyCrop}>Apply crop</button>
            <button className={btn} onClick={() => setCrop(null)}>Cancel crop</button>
          </>
        )}
        {selected?.type === "image" && (
          <label className="flex items-center gap-1 text-[11px] text-[#9bbcc0]">
            <input
              type="checkbox"
              checked={!!selected.lockAspect}
              disabled={selected.locked || !!crop}
              onChange={(e) => patch(selected.id, { lockAspect: e.target.checked })}
            />
            Lock ratio
          </label>
        )}
        {selected?.isBase && !crop && (
          <>
            <button className={btn} onClick={resetBase}>Reset size</button>
            <button className={btn} onClick={fitCanvas}>Fit canvas to image</button>
          </>
        )}
        {selected && !selected.isBase && !crop && (
          <div className="ml-auto flex gap-1">
            <button className={btn} onClick={() => moveLayer(1)} title="Bring forward">{"\u2191"}</button>
            <button className={btn} onClick={() => moveLayer(-1)} title="Send backward">{"\u2193"}</button>
            <button className={btn} onClick={duplicateSel}>Duplicate</button>
            <button className={`${btn} text-[#ff8e9c]`} onClick={removeSel}>Delete</button>
          </div>
        )}
      </div>

      {/* canvas + layers panel */}
      <div ref={wrapRef} className="relative flex-1 overflow-auto bg-[#0a2744] p-4">
        {loading && <p className="text-sm text-[#9bbcc0]">Loading image…</p>}
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            width: "100%",
            maxWidth: size.w,
            height: "auto",
            touchAction: "none",
            cursor: crop ? "crosshair" : tool === "select" ? "default" : tool === "text" ? "text" : "crosshair",
          }}
          className="mx-auto block rounded-lg border border-[#2a5068] bg-[#06182b]"
        />

        {showLayers && (
          <div className="absolute right-4 top-4 w-64 overflow-hidden rounded-xl border border-[#2a5068] bg-[#0b2b47]/95 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-[#2a5068]/60 px-3 py-2">
              <span className="text-sm font-semibold text-white">Overlay Layers</span>
              <button className="text-[#9bbcc0] hover:text-white" onClick={() => setShowLayers(false)}>{"\u2014"}</button>
            </div>
            <ul className="max-h-60 overflow-auto p-1.5">
              {[...els].reverse().map((el) => (
                <li
                  key={el.id}
                  onClick={() => { setCrop(null); setSelectedId(el.id); setTool("select"); }}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${
                    el.id === selectedId ? "border-[#38bdf8] bg-[#16415f]" : "border-transparent hover:bg-white/5"
                  }`}
                >
                  <button
                    title="Show / hide"
                    onClick={(ev) => { ev.stopPropagation(); patch(el.id, { visible: !el.visible }); }}
                    className={el.visible ? "text-[#c6dce2]" : "text-[#58707c]"}
                  >
                    {el.visible ? "\u25C9" : "\u25CB"}
                  </button>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: el.color || "#64748b" }} />
                  <span className={`flex-1 truncate ${el.visible ? "text-[#e3eef0]" : "text-[#58707c]"}`}>{el.name}</span>
                  <span className="text-[10px] text-[#8fa9b5]">{Math.round((el.opacity ?? 1) * 100)}%</span>
                  <button
                    title="Lock / unlock"
                    onClick={(ev) => { ev.stopPropagation(); patch(el.id, { locked: !el.locked }); }}
                    className={el.locked ? "text-[#ff8e9c]" : "text-[#8fa9b5]"}
                  >
                    {el.locked ? "\uD83D\uDD12" : "\uD83D\uDD13"}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 border-t border-[#2a5068]/60 px-3 py-2 text-xs text-[#9bbcc0]">
              Opacity
              <input
                type="range" min="10" max="100" disabled={!selected}
                value={selected ? Math.round((selected.opacity ?? 1) * 100) : 100}
                onChange={(e) => selected && patch(selected.id, { opacity: Number(e.target.value) / 100 }, false)}
                onPointerUp={() => setAll(elsRef.current, true)}
                className="flex-1"
              />
            </div>
          </div>
        )}
      </div>

      {/* footer */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[#2a5068]/50 bg-[#0a2744]/80 p-3">
        <button className="text-xs text-[#9bbcc0] hover:text-white" onClick={clearAnnotations}>Clear Annotations</button>
        <button className="text-xs text-[#9bbcc0] hover:text-white" onClick={exportPng}>Export Snapshot (.png)</button>
        <div className="ml-auto flex gap-2">
          <button onClick={onClose} className="rounded-md border border-[#2f5b75] px-4 py-2 text-sm font-semibold text-[#b9d2d3] hover:bg-white/5">
            Cancel
          </button>
          <button onClick={handleSave} disabled={loading || !!crop}
            className="rounded-md border border-[#f84f63] bg-[#f84f63] px-4 py-2 text-sm font-semibold text-[#0a1f36] hover:bg-[#ff667a] disabled:opacity-50">
            Save edited image
          </button>
        </div>
      </div>
    </div>
  );
}