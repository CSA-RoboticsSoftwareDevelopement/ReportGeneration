"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const COLORS = ["#000000", "#f84f63", "#fbbf24", "#38bdf8"];
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

/* ---------------- geometry / drawing helpers ---------------- */

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
  if (el.type === "arrow") return [{ name: "start", x: el.x, y: el.y }, { name: "end", x: el.x2, y: el.y2 }];
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

/* ---------------- UI atoms ---------------- */

const PATHS = {
  select: "M5 3l14 8-6.2 1.8L10.5 19z",
  arrow: "M5 19L19 5M9 5h10v10",
  rect: "M4 6h16v12H4z",
  oval: "M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  overlay: "M3 5h14v14H3zM3 15l4-4 4 4 3-3 3 3M19 3v6M16 6h6",
  crop: "M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  duplicate: "M9 9h11v11H9zM5 15V4h11",
  forward: "M12 19V6M6 12l6-6 6 6",
  backward: "M12 5v13M6 12l6 6 6-6",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  collapse: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  eraser: "M4 20h16M7 15l7-9 5 4-6 9z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  eyeoff: "M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.8 8.3 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4-.9",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  unlock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  fit: "M4 4h16v16H4zM9 9h6v6H9z",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12l5 5 9-10",
  ratio: "M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M9 12h6",
};

function Ic({ n, cls = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[n]} />
    </svg>
  );
}

function Tip({ label, side = "top", align = "center", children }) {
  const v = side === "top" ? "bottom-full mb-2" : "top-full mt-2";
  const h = align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2 -translate-x-1/2";
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-[100] whitespace-nowrap rounded-md border border-[#2f5b75] bg-[#061523] px-2 py-1 text-[11px] font-medium text-[#e3eef0] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 ${v} ${h}`}
      >
        {label}
      </span>
    </span>
  );
}

/* round icon button with hover tooltip */
function RB({ label, icon, onClick, active, disabled, danger, side = "top", align = "center", size = "h-10 w-10" }) {
  return (
    <Tip label={label} side={side} align={align}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={`${size} grid place-items-center rounded-full border transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ${
          active
            ? "border-[#f84f63] bg-[#f84f63] text-[#0a1f36]"
            : `border-[#2f5b75] bg-[#16415f] hover:bg-[#1c4d6f] ${danger ? "text-[#ff8e9c]" : "text-[#c6dce2]"}`
        }`}
      >
        <Ic n={icon} cls={size.includes("h-8") ? "h-4 w-4" : "h-[18px] w-[18px]"} />
      </button>
    </Tip>
  );
}

const Divider = () => <span className="mx-0.5 h-6 w-px bg-[#2a5068]" />;

const TOOLS = [
  { id: "select", label: "Select & move (V)", icon: "select" },
  { id: "arrow", label: "Arrow (A)", icon: "arrow" },
  { id: "rect", label: "Rectangle (R)", icon: "rect" },
  { id: "oval", label: "Oval (O)", icon: "oval" },
  { id: "text", label: "Text box (T)", icon: "text" },
];
const LABELS = { image: "Image", arrow: "Arrow", rect: "Box", oval: "Oval", text: "Text" };

/**
 * Props
 *  imageUrl      – URL (blob:/data:/same-origin) of the ORIGINAL base image
 *  initialState  – optional object returned earlier as `state` from onSave (restores layers)
 *  title         – optional heading, e.g. the figure caption
 *  onSave(file, state, dataUrl)
 *  onClose()
 */
export default function ImageEditor({ imageUrl, initialState, title, onSave, onClose }) {
  const canvasRef = useRef(null);
  const areaRef = useRef(null);
  const dockRef = useRef(null);
  const fileRef = useRef(null);
  const textInputRef = useRef(null);
  const elsRef = useRef([]);
  const hist = useRef({ stack: [], i: -1 });
  const drag = useRef(null);
  const layerCounter = useRef(2);
  const wantTextFocus = useRef(false);
  const rafRef = useRef(0);
  const cropRafRef = useRef(0);
  const cropPending = useRef(null);

  const [els, setEls] = useState([]);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState(COLORS[1]);
  const [fontSize, setFontSize] = useState(20);
  const [showLayers, setShowLayers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [crop, setCrop] = useState(null);
  const [full, setFull] = useState(false);
  const [avail, setAvail] = useState({ w: 700, h: 400, dock: 64 });
  const [, setTick] = useState(0);

  const unit = Math.max(0.5, size.w / 900);
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

  /* one React update per animation frame while dragging */
  const liveSet = (next) => {
    elsRef.current = next;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        setEls(elsRef.current);
      });
    }
  };
  const liveCrop = (rect) => {
    cropPending.current = rect;
    if (!cropRafRef.current) {
      cropRafRef.current = requestAnimationFrame(() => {
        cropRafRef.current = 0;
        const r = cropPending.current;
        setCrop((c) => (c && r ? { ...c, rect: r } : c));
      });
    }
  };

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (cropRafRef.current) cancelAnimationFrame(cropRafRef.current);
  }, []);

  /* ---------- load base image (+ saved layers) ---------- */
  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true);
      try {
        const base = await loadImage(imageUrl);
        const savedBase = initialState?.base || {};
        const list = [{
          id: "base", type: "image", isBase: true, name: "Base image", img: base,
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

  /* ---------- fit canvas to the available space ---------- */
  useEffect(() => {
    const measure = () => {
      const a = areaRef.current;
      if (!a) return;
      const dock = dockRef.current ? dockRef.current.offsetHeight : 0;
      setAvail({ w: Math.max(120, a.clientWidth - 32), h: Math.max(120, a.clientHeight - dock - 44), dock });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (areaRef.current) ro.observe(areaRef.current);
    if (dockRef.current) ro.observe(dockRef.current);
    return () => ro.disconnect();
  }, [full]);

  const scale = Math.min(avail.w / size.w, avail.h / size.h, full ? 4 : 2);
  const dispW = Math.max(40, Math.round(size.w * scale));
  const dispH = Math.max(30, Math.round(size.h * scale));

  /* ---------- drawing ---------- */
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

  /* panel opens by default in full screen, closed in the compact view; lock page scroll */
  useEffect(() => {
    setShowLayers(full);
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [full]);

  useEffect(() => {
    if (wantTextFocus.current && selected?.type === "text") {
      wantTextFocus.current = false;
      textInputRef.current?.focus();
      textInputRef.current?.select();
    }
  }, [selectedId, selected?.type]);

  /* ---------- helpers ---------- */
  const toLogical = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * cv.width) / r.width, y: ((e.clientY - r.top) * cv.height) / r.height, k: cv.width / r.width };
  };

  const patch = useCallback((id, p, record = true) => {
    setAll(elsRef.current.map((e) => (e.id === id ? withTextBox({ ...e, ...p }) : e)), record);
  }, [setAll]);

  const nextName = (type) => `Layer ${layerCounter.current++}: ${LABELS[type]}`;

  /* ---------- pointer interaction ---------- */
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
    if (d.mode === "cropresize") { liveCrop(resizeRect(d.orig, d.handle, p, d.box)); return; }
    if (d.mode === "cropmove") {
      const o = d.orig, b = d.box;
      liveCrop({
        ...o,
        x: Math.min(Math.max(o.x + dx, b.x), b.x + b.w - o.w),
        y: Math.min(Math.max(o.y + dy, b.y), b.y + b.h - o.h),
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
      if (el.type === "arrow") return d.handle === "start" ? { ...el, x: p.x, y: p.y } : { ...el, x2: p.x, y2: p.y };
      const west = d.handle.includes("w"), north = d.handle.includes("n");
      const ax = west ? o.x + o.w : o.x;
      const ay = north ? o.y + o.h : o.y;
      if (el.type === "text") {
        const sc = Math.max(0.2, Math.abs(p.y - ay) / o.h);
        const w = o.w * sc, h = o.h * sc;
        return { ...el, fontSize: Math.max(6, o.fontSize * sc), w, h, x: west ? ax - w : ax, y: north ? ay - h : ay };
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
    liveSet(list);
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try { canvasRef.current.releasePointerCapture(e.pointerId); } catch {}
    if (d.mode === "cropresize" || d.mode === "cropmove") {
      if (cropPending.current) setCrop((c) => (c ? { ...c, rect: cropPending.current } : c));
      return;
    }
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

  const onDoubleClick = (e) => {
    if (crop || tool !== "select") return;
    const p = toLogical(e);
    const hit = [...elsRef.current].reverse().find((x) => hitEl(x, p, p.k));
    if (hit && hit.type === "text") {
      setSelectedId(hit.id);
      setTimeout(() => { textInputRef.current?.focus(); textInputRef.current?.select(); }, 0);
    }
  };

  /* ---------- history ---------- */
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

  /* ---------- layer actions ---------- */
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
    if (i < 0 || j < 1 || j >= list.length) return;
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
    setTool("select");
  };

  const applyColor = (c) => {
    setColor(c);
    if (selected && !selected.isBase && selected.type !== "image") patch(selected.id, { color: c });
  };

  /* ---------- export ---------- */
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

  /* ---------- base / crop actions ---------- */
  const resetBase = () => {
    const b = elsRef.current.find((e) => e.isBase);
    if (!b) return;
    patch(b.id, { x: 0, y: 0, w: b.img.naturalWidth, h: b.img.naturalHeight, crop: null, w0: undefined, h0: undefined });
  };

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

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (crop) setCrop(null);
        else if (selectedId || tool !== "select") { setSelectedId(null); setTool("select"); }
        else if (full) setFull(false);
        return;
      }
      if (crop) return;
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSel(); return; }
      if (selected && !selected.locked && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) * unit;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        patch(selected.id, selected.type === "arrow"
          ? { x: selected.x + dx, y: selected.y + dy, x2: selected.x2 + dx, y2: selected.y2 + dy }
          : { x: selected.x + dx, y: selected.y + dy });
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const m = { v: "select", a: "arrow", r: "rect", o: "oval", t: "text" }[k];
        if (m) setTool(m);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const canUndo = hist.current.i > 0 && !crop;
  const canRedo = hist.current.i < hist.current.stack.length - 1 && !crop;
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
    if (!selected.w0) patch(selected.id, { w0: selected.w, h0: selected.h, fs0: selected.fontSize });
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
        disabled={!selected || selected.locked}
        onChange={(e) => setBox(key, e.target.value)}
        className="w-16 rounded-md border border-[#2f5b75] bg-[#0a1f36] px-1.5 py-1 text-xs text-white outline-none focus:border-[#f84f63] disabled:opacity-40"
      />
    </label>
  );

  const TEXT_BTN = "rounded-full border px-4 py-2 text-sm font-semibold transition active:scale-95 disabled:opacity-50";

  return (
    <div
      className={`flex flex-col overflow-hidden border border-[#2a5068] bg-[#071a2d] ${full ? "fixed inset-0 z-[90] h-screen" : "h-full rounded-2xl"}`}
      style={full ? { animation: "iePop .18s ease-out" } : undefined}
    >
      <style>{`@keyframes iePop{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}`}</style>

      {/* ---------------- top bar ---------------- */}
      <div className="flex items-center gap-2 border-b border-[#2a5068]/50 bg-[#0a2744]/80 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{title || "Image editor"}</p>
          <p className="hidden text-[11px] text-[#7f9fae] sm:block">{size.w} × {size.h}px · {Math.round(scale * 100)}% view</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <RB label="Export snapshot (.png)" icon="download" onClick={exportPng} side="bottom" size="h-9 w-9" />
          <RB label="Clear annotations" icon="eraser" onClick={clearAnnotations} side="bottom" size="h-9 w-9" />
          <RB label={full ? "Exit full screen (Esc)" : "Full screen"} icon={full ? "collapse" : "expand"} onClick={() => setFull((v) => !v)} side="bottom" size="h-9 w-9" />
          <button type="button" onClick={onClose} className={`${TEXT_BTN} border-[#2f5b75] text-[#b9d2d3] hover:bg-white/5`}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={loading || !!crop} className={`${TEXT_BTN} border-[#f84f63] bg-[#f84f63] text-[#0a1f36] hover:bg-[#ff667a]`}>
            Save
          </button>
        </div>
      </div>

      {/* ---------------- contextual bar ---------------- */}
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#2a5068]/50 bg-[#081c33] px-3 py-2">
        {crop ? (
          <>
            <span className="text-xs font-semibold text-[#fbbf24]">Cropping — drag the handles, then apply</span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={applyCrop} className="rounded-full bg-[#fbbf24] px-4 py-1.5 text-xs font-semibold text-[#0a1f36] transition active:scale-95 hover:bg-[#fcd34d]">Apply crop</button>
              <button type="button" onClick={() => setCrop(null)} className="rounded-full border border-[#2f5b75] px-4 py-1.5 text-xs font-semibold text-[#c6dce2] transition active:scale-95 hover:bg-white/5">Cancel</button>
            </div>
          </>
        ) : selected ? (
          <>
            <span className="max-w-[160px] truncate text-xs font-semibold text-[#38bdf8]">{selected.name}</span>
            {numInput("X", "x")}{numInput("Y", "y")}
            {selected.type !== "arrow" && <>{numInput("W", "w")}{numInput("H", "h")}</>}
            {selected.type !== "arrow" && (
              <label className="flex items-center gap-1 text-[11px] text-[#9bbcc0]">
                Scale %
                <input
                  type="number" value={scalePct} disabled={selected.locked}
                  onChange={(e) => setScale(e.target.value)}
                  className="w-16 rounded-md border border-[#2f5b75] bg-[#0a1f36] px-1.5 py-1 text-xs text-white outline-none focus:border-[#f84f63] disabled:opacity-40"
                />
              </label>
            )}
            <label className="flex items-center gap-1.5 text-[11px] text-[#9bbcc0]">
              Opacity
              <input
                type="range" min="10" max="100"
                value={Math.round((selected.opacity ?? 1) * 100)}
                onChange={(e) => patch(selected.id, { opacity: Number(e.target.value) / 100 }, false)}
                onPointerUp={() => setAll(elsRef.current, true)}
                className="w-24 accent-[#f84f63]"
              />
            </label>
            {selected.type === "text" && (
              <input
                ref={textInputRef}
                value={selected.text}
                onChange={(e) => patch(selected.id, { text: e.target.value }, false)}
                onBlur={() => setAll(elsRef.current, true)}
                placeholder="Type text…"
                className="min-w-[140px] flex-1 rounded-md border border-[#2f5b75] bg-[#0a1f36] px-2 py-1 text-xs text-white outline-none focus:border-[#f84f63]"
              />
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {selected.type === "image" && (
                <>
                  <RB size="h-8 w-8" side="bottom" label="Crop image" icon="crop" onClick={startCrop} disabled={selected.locked} />
                  {selected.crop && <RB size="h-8 w-8" side="bottom" label="Reset crop" icon="reset" onClick={resetCrop} />}
                  <RB size="h-8 w-8" side="bottom" label={selected.lockAspect ? "Aspect ratio locked" : "Aspect ratio free"} icon="ratio" active={!!selected.lockAspect} disabled={selected.locked} onClick={() => patch(selected.id, { lockAspect: !selected.lockAspect })} />
                </>
              )}
              {selected.isBase && (
                <>
                  <RB size="h-8 w-8" side="bottom" label="Reset image size" icon="reset" onClick={resetBase} />
                  <RB size="h-8 w-8" side="bottom" label="Fit canvas to image" icon="fit" onClick={fitCanvas} />
                </>
              )}
              {!selected.isBase && (
                <>
                  <RB size="h-8 w-8" side="bottom" label="Bring forward" icon="forward" onClick={() => moveLayer(1)} />
                  <RB size="h-8 w-8" side="bottom" label="Send backward" icon="backward" onClick={() => moveLayer(-1)} />
                  <RB size="h-8 w-8" side="bottom" align="end" label="Duplicate" icon="duplicate" onClick={duplicateSel} />
                  <RB size="h-8 w-8" side="bottom" align="end" label="Delete layer (Del)" icon="trash" danger onClick={removeSel} />
                </>
              )}
            </div>
          </>
        ) : (
          <span className="text-xs text-[#7f9fae]">Select a layer to edit it, or pick a tool below to annotate. Double-click text to rename it.</span>
        )}
      </div>

      {/* ---------------- canvas area ---------------- */}
      <div
        ref={areaRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[#0a2744]"
        style={{ backgroundImage: "radial-gradient(#16405c 1px, transparent 1px)", backgroundSize: "20px 20px" }}
      >
        <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: avail.dock + 20 }}>
          {loading && <p className="absolute text-sm text-[#9bbcc0]">Loading image…</p>}
          <canvas
            ref={canvasRef}
            width={size.w}
            height={size.h}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            style={{
              width: dispW, height: dispH, display: "block", touchAction: "none",
              cursor: crop ? "crosshair" : tool === "select" ? "default" : tool === "text" ? "text" : "crosshair",
            }}
            className="rounded-sm bg-[#06182b] shadow-[0_10px_40px_rgba(0,0,0,.45)] ring-1 ring-black"
          />
        </div>

        {/* layers card */}
        {showLayers && (
          <div
            className="absolute left-3 top-3 z-10 flex w-56 flex-col overflow-hidden rounded-2xl border border-[#2a5068] bg-[#061523]/90 shadow-2xl backdrop-blur"
            style={{ maxHeight: `calc(100% - ${avail.dock + 36}px)` }}
          >
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-sm font-semibold text-white">Layers</span>
              <span className="text-[11px] text-[#7f9fae]">{els.length}</span>
            </div>
            <ul className="space-y-1 overflow-y-auto px-2 pb-2">
              {[...els].reverse().map((el) => (
                <li
                  key={el.id}
                  onClick={() => { setCrop(null); setSelectedId(el.id); setTool("select"); }}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition ${
                    el.id === selectedId ? "border-[#38bdf8] bg-[#16415f]" : "border-transparent hover:bg-white/5"
                  }`}
                >
                  <button type="button" title="Show / hide" onClick={(ev) => { ev.stopPropagation(); patch(el.id, { visible: !el.visible }); }} className={el.visible ? "text-[#c6dce2]" : "text-[#58707c]"}>
                    <Ic n={el.visible ? "eye" : "eyeoff"} cls="h-4 w-4" />
                  </button>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/30" style={{ background: el.color || "#64748b" }} />
                  <span className={`min-w-0 flex-1 truncate ${el.visible ? "text-[#e3eef0]" : "text-[#58707c]"}`}>{el.name}</span>
                  <button type="button" title="Lock / unlock" onClick={(ev) => { ev.stopPropagation(); patch(el.id, { locked: !el.locked }); }} className={el.locked ? "text-[#ff8e9c]" : "text-[#7f9fae]"}>
                    <Ic n={el.locked ? "lock" : "unlock"} cls="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* bottom dock */}
        <div
          ref={dockRef}
          className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-[28px] border border-[#2a5068] bg-[#061523]/90 px-3 py-2.5 shadow-2xl backdrop-blur"
        >
          {TOOLS.map((t) => (
            <RB key={t.id} label={t.label} icon={t.icon} active={tool === t.id && !crop} disabled={!!crop} onClick={() => setTool(t.id)} />
          ))}
          <Divider />
          {COLORS.map((c) => (
            <Tip key={c} label={c === "#000000" ? "Black" : c === "#f84f63" ? "Coral" : c === "#fbbf24" ? "Amber" : "Sky blue"}>
              <button
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => applyColor(c)}
                style={{ background: c }}
                className={`h-7 w-7 rounded-full border-2 transition active:scale-90 ${color === c ? "scale-110 border-white" : "border-white/30 hover:border-white/70"}`}
              />
            </Tip>
          ))}
          <Tip label="Custom colour">
            <input type="color" value={color} onChange={(e) => applyColor(e.target.value)} className="h-7 w-7 cursor-pointer rounded-full border-2 border-white/30 bg-transparent p-0" />
          </Tip>
          <Divider />
          <RB size="h-8 w-8" label="Smaller text" icon="minus" onClick={() => setFontSize((v) => Math.max(8, v - 2))} />
          <span className="w-6 text-center text-xs font-semibold text-[#c6dce2]">{fontSize}</span>
          <RB size="h-8 w-8" label="Larger text" icon="plus" onClick={() => setFontSize((v) => v + 2)} />
          <Divider />
          <RB label="Add overlay image" icon="overlay" onClick={() => fileRef.current?.click()} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { addOverlay(e.target.files?.[0]); e.target.value = ""; }} />
          <RB label={showLayers ? "Hide layers" : "Show layers"} icon="layers" active={showLayers} onClick={() => setShowLayers((v) => !v)} />
          <RB label="Undo (Ctrl+Z)" icon="undo" onClick={undo} disabled={!canUndo} />
          <RB label="Redo (Ctrl+Y)" icon="redo" onClick={redo} disabled={!canRedo} />
        </div>
      </div>
    </div>
  );
}