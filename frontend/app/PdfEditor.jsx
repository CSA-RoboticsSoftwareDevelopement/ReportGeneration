"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FONT_FAMILIES, arrowHead, b64ToBytes, exportPdf, markSegments } from "./pdfExport";

/* ------------------------------------------------------------------ */
/*  Theme (matches ReportGenix): page #0a2744 · card #0e3250 ·         */
/*  well #061d31 · border #2f5b75 · coral #f84f63 · teal #81c9c2       */
/* ------------------------------------------------------------------ */

const SWATCHES = ["#000000", "#f84f63", "#fbbf24", "#38bdf8", "#4ade80", "#ffffff"];
const HL_COLORS = ["#fde047", "#86efac", "#f9a8d4", "#7dd3fc"];
const BOX_TYPES = new Set(["rect", "ellipse", "highlight", "underline", "strike", "whiteout", "redact", "link", "image", "text", "note", "check", "cross", "dot"]);
const RESIZABLE = new Set(["rect", "ellipse", "highlight", "underline", "strike", "whiteout", "redact", "link", "image", "text", "check", "cross", "dot"]);
const DRAG_TOOLS = new Set(["rect", "ellipse", "line", "arrow", "highlight", "underline", "strike", "whiteout", "redact", "link", "ink"]);
const MARKUP = new Set(["highlight", "underline", "strike"]);
const ONE_SHOT = new Set(["text", "note", "image", "sign", "initials", "link", "date", "check", "cross", "dot", "edittext"]);

const uid = () => `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const ICONS = {
  select: "M5 3l14 7-6 2-2 6z",
  text: "M4 6V4h16v2M12 4v16M9 20h6",
  edittext: "M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z",
  image: "M3 5h18v14H3zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 19",
  link: "M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1",
  highlight: "M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4",
  underline: "M6 3v7a6 6 0 0012 0V3M4 21h16",
  strike: "M16 4H9a3 3 0 00-2.8 4M14 12a4 4 0 010 8H6M4 12h16",
  ink: "M12 19l7-7 3 3-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.6 7.6",
  note: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  rect: "M3 5h18v14H3z",
  ellipse: "M3 12a9 6 0 1018 0 9 6 0 10-18 0",
  line: "M5 19L19 5",
  arrow: "M5 19L19 5M9 5h10v10",
  check: "M5 13l4 4L19 7",
  cross: "M6 6l12 12M18 6L6 18",
  dot: "M12 8a4 4 0 100 8 4 4 0 000-8z",
  date: "M4 5h16v16H4zM4 10h16M9 3v4M15 3v4",
  sign: "M3 17c3-6 5-10 7-8s-3 9 0 8 4-6 6-4 2 3 5 1",
  initials: "M4 19l5-14 5 14M6 14h6M17 5v14",
  whiteout: "M20 20H9l-5-5 10-10 7 7-6 6M7 12l5 5",
  redact: "M4 8h16v8H4z",
  rotL: "M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.7L3 8M3 3v5h5",
  rotR: "M21 12a9 9 0 11-9-9 9.7 9.7 0 016.7 2.7L21 8M21 3v5h-5",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  plus: "M12 5v14M5 12h14",
  undo: "M3 7v6h6M3 13a9 9 0 119 8",
  redo: "M21 7v6h-6M21 13a9 9 0 10-9 8",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  restore: "M3 12a9 9 0 109-9M3 3v6h6",
  eraser: "M18 6L6 18M6 6l12 12",
};

function Ico({ name, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={name === "dot" || name === "redact" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] || ""} />
    </svg>
  );
}

const BTN = "inline-flex items-center gap-1.5 rounded-md border border-[#2f5b75] bg-[#0e3250] px-2.5 py-1.5 text-xs font-medium text-[#c8dfe1] transition hover:border-[#f84f63] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const BTN_ON = "!border-[#f84f63] !bg-[#f84f63]/15 !text-white";
const FIELD = "rounded-md border border-[#2f5b75] bg-[#16415f] px-2 py-1 text-xs text-white outline-none focus:border-[#81c9c2]";

const TABS = [
  { id: "edit", label: "Edit", tools: [["select", "Select"], ["text", "Add text"], ["edittext", "Edit text"], ["image", "Add image"], ["link", "Link"]] },
  { id: "comment", label: "Comment", tools: [["highlight", "Highlight"], ["underline", "Underline"], ["strike", "Strikethrough"], ["ink", "Draw"], ["note", "Sticky note"]] },
  { id: "shapes", label: "Shapes", tools: [["rect", "Rectangle"], ["ellipse", "Ellipse"], ["line", "Line"], ["arrow", "Arrow"]] },
  { id: "sign", label: "Fill & Sign", tools: [["check", "Check"], ["cross", "Cross"], ["dot", "Dot"], ["date", "Date"], ["sign", "Signature"], ["initials", "Initials"]] },
  { id: "redact", label: "Redact", tools: [["whiteout", "Whiteout"], ["redact", "Redact"]] },
  { id: "pages", label: "Organize", tools: [] },
];

const HINTS = {
  select: "Click an item to move, resize or edit it. Double-click text to edit.",
  text: "Click on the page to add a text box.",
  edittext: "Click any existing text on the page to rewrite it.",
  image: "Click on the page to place the image.",
  link: "Drag a rectangle, then enter the URL.",
  highlight: "Drag across text (or click a text line) to highlight.",
  underline: "Drag across text (or click a text line) to underline.",
  strike: "Drag across text (or click a text line) to strike through.",
  ink: "Draw freehand on the page.",
  note: "Click to drop a sticky note.",
  rect: "Drag to draw a rectangle.",
  ellipse: "Drag to draw an ellipse.",
  line: "Drag to draw a line.",
  arrow: "Drag to draw an arrow.",
  check: "Click to stamp a check mark.",
  cross: "Click to stamp a cross.",
  dot: "Click to stamp a dot.",
  date: "Click to stamp today's date.",
  sign: "Click to place your signature.",
  initials: "Click to place your initials.",
  whiteout: "Drag to cover content with a solid box.",
  redact: "Drag over content to redact. Redacted pages are flattened on download so the text is really removed.",
};

/* ------------------------------------------------------------------ */
/*  pdf.js loader (client only)                                         */
/* ------------------------------------------------------------------ */

let pdfjsPromise = null;
const getPdfjs = () =>
  (pdfjsPromise ||= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  }));

const fileToDataUrl = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

const loadImg = (src) =>
  new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

function trimCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const d = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0, any = false;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (d[(y * width + x) * 4 + 3] > 10) { any = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (!any) return null;
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext("2d").drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

const todayText = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

const itemBBox = (it) => {
  if (it.type === "line" || it.type === "arrow") return { x: Math.min(it.x, it.x2), y: Math.min(it.y, it.y2), w: Math.abs(it.x2 - it.x), h: Math.abs(it.y2 - it.y) };
  if (it.type === "ink") {
    const xs = it.pts.map((p) => p[0]), ys = it.pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (it.type === "note") return { x: it.x, y: it.y, w: 18, h: 18 };
  if (it.type === "check" || it.type === "cross" || it.type === "dot") return { x: it.x, y: it.y, w: it.w, h: it.w };
  return { x: it.x, y: it.y, w: it.w, h: it.h };
};

/* ------------------------------------------------------------------ */
/*  Signature dialog                                                    */
/* ------------------------------------------------------------------ */

function SignatureDialog({ kind, onDone, onClose }) {
  const [mode, setMode] = useState("draw");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvasRef.current.width, y: ((e.clientY - r.top) / r.height) * canvasRef.current.height };
  };
  const down = (e) => {
    drawing.current = true;
    const c = canvasRef.current.getContext("2d");
    const p = pos(e);
    c.strokeStyle = "#0b1f6e"; c.lineWidth = 3; c.lineCap = "round"; c.lineJoin = "round";
    c.beginPath(); c.moveTo(p.x, p.y);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const c = canvasRef.current.getContext("2d");
    const p = pos(e);
    c.lineTo(p.x, p.y); c.stroke();
  };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current; c.getContext("2d").clearRect(0, 0, c.width, c.height); };

  const save = async () => {
    setError("");
    if (mode === "draw") {
      const url = trimCanvas(canvasRef.current);
      if (!url) return setError("Draw your " + kind + " first.");
      return onDone(url);
    }
    if (mode === "type") {
      if (!typed.trim()) return setError("Type your " + kind + " first.");
      const c = document.createElement("canvas");
      c.width = 900; c.height = 260;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#0b1f6e"; ctx.font = "italic 120px 'Brush Script MT','Segoe Script','Snell Roundhand',cursive"; ctx.textBaseline = "middle";
      ctx.fillText(typed, 20, 130);
      return onDone(trimCanvas(c));
    }
  };
  const upload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    onDone(await fileToDataUrl(f));
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#061523]/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#2f5b75] bg-[#0b2b47] p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">{kind === "initials" ? "Add initials" : "Add signature"}</p>
          <button type="button" onClick={onClose} className={BTN}>✕</button>
        </div>
        <div className="mt-3 flex gap-1.5">
          {["draw", "type", "upload"].map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`${BTN} ${mode === m ? BTN_ON : ""} capitalize`}>{m}</button>
          ))}
        </div>
        <div className="mt-3">
          {mode === "draw" && (
            <canvas ref={canvasRef} width={800} height={280} onPointerDown={down} onPointerMove={move} onPointerUp={up} className="h-36 w-full touch-none rounded-md border border-[#2f5b75] bg-white" />
          )}
          {mode === "type" && (
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={kind === "initials" ? "Your initials" : "Your name"} className={`${FIELD} w-full !bg-white !text-[#0b1f6e]`} style={{ fontFamily: "'Brush Script MT','Segoe Script',cursive", fontSize: 34, fontStyle: "italic" }} />
          )}
          {mode === "upload" && <input type="file" accept="image/*" onChange={upload} className="text-xs text-[#c8dfe1]" />}
        </div>
        {error && <p className="mt-2 text-xs text-[#f84f63]">{error}</p>}
        <div className="mt-3 flex justify-between">
          {mode === "draw" ? <button type="button" onClick={clear} className={BTN}>Clear</button> : <span />}
          {mode !== "upload" && <button type="button" onClick={save} className={`${BTN} !border-[#f84f63] !bg-[#f84f63] !text-white`}>Use {kind}</button>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Item renderers                                                      */
/* ------------------------------------------------------------------ */

function TextItem({ it, tool, selected, editing, api, pageKey }) {
  const ref = useRef(null);
  const style = {
    position: "absolute", left: it.x, top: it.y, width: it.w, minHeight: it.size * 1.25,
    fontSize: it.size, lineHeight: 1.25, color: it.color, fontFamily: FONT_FAMILIES[it.font] || FONT_FAMILIES.Helvetica,
    fontWeight: it.bold ? 700 : 400, fontStyle: it.italic ? "italic" : "normal", textAlign: it.align || "left",
    whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, padding: 0, border: 0, background: "transparent",
    pointerEvents: tool === "select" ? "auto" : "none", cursor: tool === "select" ? "move" : "default",
    outline: selected || editing ? "1px dashed #81c9c2" : "none", outlineOffset: 2, resize: "none", overflow: "visible", boxSizing: "border-box",
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = editing ? el.scrollHeight : el.offsetHeight;
    if (Math.abs(h - it.h) > 1) api.patch(pageKey, it.id, { h }, false);
  }, [it.text, it.size, it.w, it.font, it.bold, it.italic, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => { if (ref.current) { ref.current.focus(); if (editing.selectAll) ref.current.select(); } }, 40);
    return () => clearTimeout(t);
  }, [editing]);

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={it.text}
        onChange={(e) => api.patch(pageKey, it.id, { text: e.target.value }, false)}
        onBlur={() => api.stopEditing(pageKey, it)}
        onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); e.stopPropagation(); }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ ...style, pointerEvents: "auto", cursor: "text", height: Math.max(it.h, it.size * 1.5), minHeight: it.size * 1.5, padding: "2px 3px", border: "1px solid #81c9c2", background: "rgba(255,255,255,.96)", color: it.color, overflow: "auto", whiteSpace: "pre-wrap" }}
      />
    );
  }
  return (
    <div
      ref={ref}
      style={style}
      onPointerDown={(e) => api.startDrag(e, pageKey, it, "move")}
      onDoubleClick={() => tool === "select" && api.startEditing(it.id)}
    >
      {it.text || " "}
    </div>
  );
}

function NoteItem({ it, tool, selected, api, pageKey }) {
  const taRef = useRef(null);
  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(() => taRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [selected]);
  return (
    <>
      <div
        title={it.text || "Sticky note"}
        style={{ position: "absolute", left: it.x, top: it.y, width: 18, height: 18, background: it.color || "#fde047", border: "1px solid #7a5b00", borderRadius: 3, boxShadow: "1px 1px 2px rgba(0,0,0,.35)", pointerEvents: tool === "select" ? "auto" : "none", cursor: "move", outline: selected ? "1px dashed #81c9c2" : "none", outlineOffset: 2 }}
        onPointerDown={(e) => api.startDrag(e, pageKey, it, "move")}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#7a5b00" strokeWidth="2"><path d="M6 8h12M6 12h12M6 16h7" /></svg>
      </div>
      {selected && (
        <textarea
          ref={taRef}
          value={it.text}
          placeholder="Type your comment…"
          onChange={(e) => api.patch(pageKey, it.id, { text: e.target.value }, false)}
          onBlur={() => api.commitNow()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ position: "absolute", left: it.x + 24, top: it.y, width: 170, height: 70, fontSize: 11, padding: 5, background: "#fff8c5", color: "#222", border: "1px solid #7a5b00", borderRadius: 4, zIndex: 30, pointerEvents: "auto" }}
        />
      )}
    </>
  );
}

function ItemsLayer({ items, W, H, tool, selectedId, editing, api, pageKey, scale }) {
  const svgItems = items.filter((i) => !["text", "image", "note", "link"].includes(i.type));
  const sel = (it) => (tool === "select" ? { onPointerDown: (e) => api.startDrag(e, pageKey, it, "move"), style: { cursor: "move", pointerEvents: "all" } } : { style: { pointerEvents: "none" } });
  const hit = (it, children) => (
    <g key={it.id}>
      {children}
    </g>
  );

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none" }}>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
        {svgItems.map((it) => {
          const op = it.opacity ?? 1;
          const common = sel(it);
          switch (it.type) {
            case "rect":
              return hit(it, <rect x={it.x} y={it.y} width={it.w} height={it.h} fill={it.fill || "none"} fillOpacity={0.9 * op} stroke={it.color} strokeOpacity={op} strokeWidth={it.sw} {...common} style={{ ...common.style, pointerEvents: it.fill ? "all" : "stroke" }} />);
            case "ellipse":
              return hit(it, <ellipse cx={it.x + it.w / 2} cy={it.y + it.h / 2} rx={it.w / 2} ry={it.h / 2} fill={it.fill || "none"} fillOpacity={0.9 * op} stroke={it.color} strokeOpacity={op} strokeWidth={it.sw} {...common} style={{ ...common.style, pointerEvents: it.fill ? "all" : "stroke" }} />);
            case "line":
            case "arrow":
              return hit(it, <>
                <line x1={it.x} y1={it.y} x2={it.x2} y2={it.y2} stroke={it.color} strokeOpacity={op} strokeWidth={it.sw} strokeLinecap="round" style={{ pointerEvents: "none" }} />
                {it.type === "arrow" && arrowHead(it).map((s, i) => <line key={i} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke={it.color} strokeOpacity={op} strokeWidth={it.sw} strokeLinecap="round" style={{ pointerEvents: "none" }} />)}
                <line x1={it.x} y1={it.y} x2={it.x2} y2={it.y2} stroke="transparent" strokeWidth={Math.max(it.sw, 12)} {...common} style={{ ...common.style, pointerEvents: tool === "select" ? "stroke" : "none" }} />
              </>);
            case "ink": {
              const pts = it.pts.map((p) => p.join(",")).join(" ");
              return hit(it, <>
                <polyline points={pts} fill="none" stroke={it.color} strokeOpacity={op} strokeWidth={it.sw} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }} />
                <polyline points={pts} fill="none" stroke="transparent" strokeWidth={Math.max(it.sw, 12)} {...common} style={{ ...common.style, pointerEvents: tool === "select" ? "stroke" : "none" }} />
              </>);
            }
            case "highlight":
              return hit(it, <rect x={it.x} y={it.y} width={it.w} height={it.h} fill={it.color} fillOpacity={0.42 * op} {...common} />);
            case "underline":
              return hit(it, <>
                <line x1={it.x} y1={it.y + it.h - 0.5} x2={it.x + it.w} y2={it.y + it.h - 0.5} stroke={it.color} strokeWidth={1.2} style={{ pointerEvents: "none" }} />
                <rect x={it.x} y={it.y} width={it.w} height={it.h} fill="transparent" {...common} />
              </>);
            case "strike":
              return hit(it, <>
                <line x1={it.x} y1={it.y + it.h * 0.55} x2={it.x + it.w} y2={it.y + it.h * 0.55} stroke={it.color} strokeWidth={1.2} style={{ pointerEvents: "none" }} />
                <rect x={it.x} y={it.y} width={it.w} height={it.h} fill="transparent" {...common} />
              </>);
            case "whiteout":
              return hit(it, <rect x={it.x} y={it.y} width={it.w} height={it.h} fill={it.color || "#ffffff"} {...common} />);
            case "redact":
              return hit(it, <rect x={it.x} y={it.y} width={it.w} height={it.h} fill="#000" {...common} />);
            case "check":
            case "cross":
              return hit(it, <>
                {markSegments(it).map((s, i) => <line key={i} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke={it.color} strokeWidth={it.sw || 2} strokeLinecap="round" style={{ pointerEvents: "none" }} />)}
                <rect x={it.x} y={it.y} width={it.w} height={it.w} fill="transparent" {...common} />
              </>);
            case "dot":
              return hit(it, <circle cx={it.x + it.w / 2} cy={it.y + it.w / 2} r={it.w * 0.3} fill={it.color} {...common} />);
            default:
              return null;
          }
        })}
      </svg>

      {items.map((it) => {
        if (it.type === "text") return <TextItem key={it.id} it={it} tool={tool} selected={selectedId === it.id} editing={editing?.id === it.id ? editing : null} api={api} pageKey={pageKey} />;
        if (it.type === "note") return <NoteItem key={it.id} it={it} tool={tool} selected={selectedId === it.id} api={api} pageKey={pageKey} />;
        if (it.type === "image")
          return (
            <div key={it.id} style={{ position: "absolute", left: it.x, top: it.y, width: it.w, height: it.h, pointerEvents: "none" }}>
              <img src={it.src} alt="" draggable={false}
                style={{ width: "100%", height: "100%", opacity: it.opacity ?? 1, pointerEvents: tool === "select" ? "auto" : "none", cursor: "move", userSelect: "none" }}
                onPointerDown={(e) => api.startDrag(e, pageKey, it, "move")} />
              {selectedId === it.id && tool === "select" && (
                <button type="button" title="Edit image in image editor" aria-label="Edit image"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); api.editImage(pageKey, it); }}
                  style={{ position: "absolute", top: 5, right: 5, width: 28, height: 28, display: "grid", placeItems: "center", border: "1px solid #2f5b75", borderRadius: 7, background: "#f84f63", color: "#071f35", pointerEvents: "auto", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.35)" }}>
                  <Ico name="edit" size={14} />
                </button>
              )}
            </div>
          );
        if (it.type === "link")
          return (
            <div key={it.id} title={it.url}
              style={{ position: "absolute", left: it.x, top: it.y, width: it.w, height: it.h, border: "1.5px dashed #38bdf8", background: "rgba(56,189,248,.12)", pointerEvents: tool === "select" ? "auto" : "none", cursor: "move" }}
              onPointerDown={(e) => api.startDrag(e, pageKey, it, "move")}
              onDoubleClick={() => api.editLink(pageKey, it)} />
          );
        return null;
      })}

      {items.filter((i) => i.id === selectedId).map((it) => {
        const b = itemBBox(it);
        const hs = 10 / scale;
        const handles = [];
        if (it.type === "line" || it.type === "arrow") {
          handles.push({ n: "p1", x: it.x, y: it.y }, { n: "p2", x: it.x2, y: it.y2 });
        } else if (RESIZABLE.has(it.type)) {
          if (it.type === "text") handles.push({ n: "se", x: b.x + b.w, y: b.y + b.h });
          else handles.push({ n: "nw", x: b.x, y: b.y }, { n: "ne", x: b.x + b.w, y: b.y }, { n: "sw", x: b.x, y: b.y + b.h }, { n: "se", x: b.x + b.w, y: b.y + b.h });
        }
        return (
          <div key={`sel_${it.id}`} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 20 }}>
            {it.type !== "line" && it.type !== "arrow" && it.type !== "text" && <div style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, outline: `${1 / scale}px dashed #81c9c2`, outlineOffset: 2 / scale }} />}
            {handles.map((h) => (
              <div key={h.n} onPointerDown={(e) => api.startDrag(e, pageKey, it, h.n)}
                style={{ position: "absolute", left: h.x - hs / 2, top: h.y - hs / 2, width: hs, height: hs, background: "#f84f63", border: `${1 / scale}px solid #fff`, borderRadius: 2, pointerEvents: "auto", cursor: h.n === "nw" || h.n === "se" ? "nwse-resize" : h.n === "ne" || h.n === "sw" ? "nesw-resize" : "crosshair" }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One PDF page                                                        */
/* ------------------------------------------------------------------ */

function PageView({ pdf, pageNo, pageKey, label, size, blank, scale, rot, deleted, tool, items, selectedId, editing, api, query, active }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [textItems, setTextItems] = useState([]);
  const [draft, setDraft] = useState(null);
  const W = size.w, H = size.h;

  useEffect(() => {
    if (!pdf || blank) return;
    let dead = false, task = null;
    (async () => {
      const page = await pdf.getPage(pageNo);
      if (dead) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      const c = canvasRef.current;
      if (!c) return;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      task = page.render({ canvasContext: c.getContext("2d"), viewport: vp });
      try { await task.promise; } catch { /* cancelled */ }
    })();
    return () => { dead = true; try { task?.cancel(); } catch { /* noop */ } };
  }, [pdf, pageNo, scale, blank]);

  useEffect(() => {
    if (!pdf || blank) { setTextItems([]); return; }
    let dead = false;
    (async () => {
      const pdfjs = await getPdfjs();
      const page = await pdf.getPage(pageNo);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      if (dead) return;
      const out = [];
      content.items.forEach((t) => {
        if (!t.str || !t.str.trim()) return;
        const m = pdfjs.Util.transform(vp.transform, t.transform);
        const h = Math.hypot(m[2], m[3]);
        const fam = content.styles?.[t.fontName]?.fontFamily || "";
        out.push({ str: t.str, x: m[4], y: m[5] - h, w: Math.max(t.width * vp.scale, 2), h, font: /mono|courier/i.test(fam) ? "Courier" : /serif/i.test(fam) && !/sans/i.test(fam) ? "Times" : "Helvetica" });
      });
      setTextItems(out);
    })();
    return () => { dead = true; };
  }, [pdf, pageNo, blank]);

  const toPt = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const th = (rot * Math.PI) / 180;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const lx = dx * Math.cos(th) + dy * Math.sin(th);
    const ly = -dx * Math.sin(th) + dy * Math.cos(th);
    return { x: (lx + (W * scale) / 2) / scale, y: (ly + (H * scale) / 2) / scale };
  };
  api.toPtRef.current[pageKey] = toPt;

  const sampleBg = (ti) => {
    try {
      const c = canvasRef.current;
      const f = c.width / W;
      const ctx = c.getContext("2d");
      const d = ctx.getImageData(Math.max(0, Math.floor((ti.x - 2) * f)), Math.floor((ti.y + ti.h / 2) * f), 1, 1).data;
      return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    } catch { return "#ffffff"; }
  };

  const hitText = (rect) =>
    textItems.filter((t) => t.x < rect.x + rect.w && t.x + t.w > rect.x && t.y < rect.y + rect.h && t.y + t.h > rect.y);

  const buildDraft = (t, a, b, pts) => {
    const st = api.style;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const base = { id: "draft", type: t, color: st.color, sw: st.sw, opacity: st.opacity };
    if (t === "line" || t === "arrow") return { ...base, x: a.x, y: a.y, x2: b.x, y2: b.y };
    if (t === "ink") return { ...base, pts };
    if (t === "highlight") return { ...base, x, y, w, h, color: st.hlColor };
    if (t === "whiteout") return { ...base, x, y, w, h, color: st.fillWhite };
    if (t === "rect" || t === "ellipse") return { ...base, x, y, w, h, fill: st.fill };
    return { ...base, x, y, w, h };
  };

  const finishDrag = (t, a, b, pts) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (MARKUP.has(t)) {
      const hits = hitText({ x, y, w: Math.max(w, 1), h: Math.max(h, 1) });
      const col = t === "highlight" ? api.style.hlColor : api.style.color;
      if (hits.length) {
        api.addMany(pageKey, hits.map((ti) => ({ id: uid(), type: t, x: ti.x, y: ti.y, w: ti.w, h: ti.h, color: col, opacity: 1 })));
      } else if (w > 4 && h > 4) {
        api.addMany(pageKey, [{ id: uid(), type: t, x, y, w, h, color: col, opacity: 1 }]);
      }
      return;
    }
    const d = buildDraft(t, a, b, pts);
    if (t === "ink") { if (pts.length > 1) api.add(pageKey, { ...d, id: uid() }); return; }
    if (t === "line" || t === "arrow") { if (Math.hypot(w, h) > 4) api.add(pageKey, { ...d, id: uid() }); return; }
    if (w < 4 || h < 4) return;
    if (t === "link") {
      const url = window.prompt("Link URL", "https://");
      if (!url || url === "https://") return;
      api.add(pageKey, { ...d, id: uid(), url });
      api.afterOneShot("link");
      return;
    }
    api.add(pageKey, { ...d, id: uid() });
  };

  const onDown = (e) => {
    if (deleted || e.button !== 0) return;
    api.setActive(pageKey);
    const p = toPt(e);
    if (tool === "select") { api.select(null); return; }
    if (tool === "edittext") return;
    e.preventDefault();
    if (DRAG_TOOLS.has(tool)) {
      const pts = [[p.x, p.y]];
      setDraft(buildDraft(tool, p, p, pts));
      const move = (ev) => {
        const q = toPt(ev);
        if (tool === "ink") pts.push([q.x, q.y]);
        setDraft(buildDraft(tool, p, q, pts));
      };
      const up = (ev) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setDraft(null);
        finishDrag(tool, p, toPt(ev), pts);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    api.place(pageKey, tool, p, W, H);
  };

  const q = (query || "").trim().toLowerCase();
  const cursor = tool === "select" ? "default" : tool === "edittext" ? "text" : "crosshair";
  const outerW = rot % 180 ? H * scale : W * scale;
  const outerH = rot % 180 ? W * scale : H * scale;
  const shown = draft ? [...items, draft] : items;

  return (
    <div style={{ width: outerW, height: outerH, position: "relative", margin: "0 auto 22px" }} data-page-key={pageKey} onMouseEnter={() => api.setActive(pageKey)}>
      <p style={{ position: "absolute", top: -17, left: 0, fontSize: 10, color: active ? "#81c9c2" : "#7f9ba8" }}>{label}{deleted ? " · deleted" : ""}</p>
      <div
        ref={wrapRef}
        onPointerDown={onDown}
        style={{ position: "absolute", left: "50%", top: "50%", width: W * scale, height: H * scale, transform: `translate(-50%,-50%) rotate(${rot}deg)`, background: "#fff", boxShadow: active ? "0 0 0 2px #81c9c2, 0 6px 24px rgba(0,0,0,.45)" : "0 4px 18px rgba(0,0,0,.4)", cursor, touchAction: "none", opacity: deleted ? 0.3 : 1 }}
      >
        {!blank && <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />}

        {/* text layer: search, copy, edit-text and snap-to-text markup */}
        {!blank && (
          <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: ["select", "edittext", "highlight", "underline", "strike"].includes(tool) ? "auto" : "none" }}>
            {textItems.map((t, i) => {
              const match = q && t.str.toLowerCase().includes(q);
              return (
                <span
                  key={i}
                  {...(match ? { "data-match": "1" } : {})}
                  onPointerDown={(e) => {
                    if (tool === "edittext") { e.stopPropagation(); e.preventDefault(); api.editExisting(pageKey, t, sampleBg(t)); }
                  }}
                  className={tool === "edittext" ? "pdfed-hover" : ""}
                  style={{ position: "absolute", left: t.x, top: t.y, width: t.w, height: t.h, fontSize: t.h, lineHeight: 1, whiteSpace: "pre", color: "transparent", background: match ? "rgba(253,224,71,.55)" : "transparent", outline: match ? "1px solid #f59e0b" : "none", cursor: tool === "edittext" ? "text" : "auto", userSelect: tool === "select" ? "text" : "none", overflow: "hidden" }}
                >
                  {t.str}
                </span>
              );
            })}
          </div>
        )}

        <ItemsLayer items={shown} W={W} H={H} tool={deleted ? "none" : tool} selectedId={selectedId} editing={editing} api={api} pageKey={pageKey} scale={scale} />

        {deleted && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", transform: `rotate(${-rot}deg)` }}>
            <button type="button" className={BTN} onClick={() => api.setPage(pageKey, { deleted: false })}>Restore page</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Editor                                                              */
/* ------------------------------------------------------------------ */

const EMPTY = { items: {}, pages: {} };

export default function PdfEditor({ pdfBase64, pageNumbers, allPageKeys, title = "Section", edits, onEditsChange, onEditImage, loading }) {
  const [pdf, setPdf] = useState(null);
  const [sizes, setSizes] = useState({});
  const [tab, setTab] = useState("edit");
  const [tool, setTool] = useState("select");
  const [selected, setSelected] = useState(null); /* {key,id} */
  const [editing, setEditing] = useState(null); /* {id, selectAll} */
  const [activeKey, setActiveKey] = useState(null);
  const [zoom, setZoom] = useState("fit");
  const [fitScale, setFitScale] = useState(1);
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [matchIdx, setMatchIdx] = useState(0);
  const [sigDlg, setSigDlg] = useState(null);
  const [sigs, setSigs] = useState({ sign: null, initials: null });
  const [pendingImage, setPendingImage] = useState(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const DEFAULT_STYLE = { color: "#000000", fill: null, fillWhite: "#ffffff", sw: 2, size: 12, font: "Helvetica", bold: false, italic: false, align: "left", opacity: 1, hlColor: "#fde047" };
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [styleLoaded, setStyleLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rg_pdf_editor_style") || "null");
      if (saved && typeof saved === "object") setStyle((current) => ({ ...current, ...saved }));
    } catch { /* ignore invalid or unavailable saved settings */ }
    setStyleLoaded(true);
  }, []);

  useEffect(() => {
    if (!styleLoaded) return;
    try { localStorage.setItem("rg_pdf_editor_style", JSON.stringify(style)); } catch { /* storage unavailable */ }
  }, [style, styleLoaded]);

  const cur = edits || EMPTY;
  const editsRef = useRef(cur);
  editsRef.current = cur;
  const hist = useRef({ undo: [], redo: [] });
  const [, bump] = useState(0);
  const bytesRef = useRef(null);
  const docRef = useRef(null);
  const scrollRef = useRef(null);
  const rootRef = useRef(null);
  const toPtRef = useRef({});
  const fileRef = useRef(null);
  const clip = useRef(null);
  const styleRef = useRef(style);
  styleRef.current = style;

  /* ---------- load PDF ---------- */
  useEffect(() => {
    if (!pdfBase64) { setPdf(null); return; }
    let dead = false, doc = null;
    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const bytes = b64ToBytes(pdfBase64);
        bytesRef.current = bytes;
        doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        if (dead) { doc.destroy(); return; }
        const old = docRef.current;
        docRef.current = doc;
        setPdf(doc);
        if (old) setTimeout(() => { try { old.destroy(); } catch { /* noop */ } }, 2000);
      } catch (err) {
        setError(`Could not open PDF: ${err?.message || err}`);
      }
    })();
    return () => { dead = true; };
  }, [pdfBase64]);

  const pageKey = (n) => allPageKeys?.[n - 1] || `p${n}`;
  const pageNumsKey = (pageNumbers || []).join(",");

  useEffect(() => {
    if (!pdf) return;
    let dead = false;
    (async () => {
      const out = {};
      for (const n of pageNumbers || []) {
        const p = await pdf.getPage(n);
        const v = p.getViewport({ scale: 1 });
        out[n] = { w: v.width, h: v.height };
      }
      if (!dead) setSizes(out);
    })();
    return () => { dead = true; };
  }, [pdf, pageNumsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* signatures persisted locally */
  useEffect(() => {
    try {
      setSigs({ sign: localStorage.getItem("rg_pdf_sign"), initials: localStorage.getItem("rg_pdf_initials") });
    } catch { /* storage unavailable */ }
  }, []);

  /* Fit the complete PDF page inside the available editor viewport.
     This keeps both the page width and height compact instead of fitting
     width only and allowing portrait pages to extend below the visible area. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const calc = () => {
      const pageSizes = Object.values(sizes);
      const maxW = Math.max(...pageSizes.map((s) => s.w), 0) || 595;
      const maxH = Math.max(...pageSizes.map((s) => s.h), 0) || 842;
      const availableW = Math.max(el.clientWidth - 48, 240);
      const availableH = Math.max(el.clientHeight - 48, 240);
      const widthScale = availableW / maxW;
      const heightScale = availableH / maxH;
      setFitScale(clamp(Math.min(widthScale, heightScale), 0.3, 2.5));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sizes]);
  const scale = zoom === "fit" ? fitScale : zoom;

  /* ---------- edit state helpers ---------- */
  const commit = useCallback((next, record = true) => {
    if (record) {
      hist.current.undo.push(editsRef.current);
      if (hist.current.undo.length > 80) hist.current.undo.shift();
      hist.current.redo = [];
    }
    editsRef.current = next;
    onEditsChange(next);
    bump((n) => n + 1);
  }, [onEditsChange]);

  const snap = () => {
    hist.current.undo.push(editsRef.current);
    if (hist.current.undo.length > 80) hist.current.undo.shift();
    hist.current.redo = [];
    bump((n) => n + 1);
  };
  const undo = () => {
    const prev = hist.current.undo.pop();
    if (!prev) return;
    hist.current.redo.push(editsRef.current);
    editsRef.current = prev;
    onEditsChange(prev);
    setSelected(null); setEditing(null);
    bump((n) => n + 1);
  };
  const redo = () => {
    const nxt = hist.current.redo.pop();
    if (!nxt) return;
    hist.current.undo.push(editsRef.current);
    editsRef.current = nxt;
    onEditsChange(nxt);
    setSelected(null); setEditing(null);
    bump((n) => n + 1);
  };

  const mapItems = (key, fn, record) => {
    const c = editsRef.current;
    commit({ ...c, items: { ...c.items, [key]: fn(c.items?.[key] || []) } }, record);
  };

  const api = {
    toPtRef,
    get style() { return styleRef.current; },
    setActive: (k) => setActiveKey(k),
    select: (id, key) => { setSelected(id ? { key, id } : null); if (!id) setEditing(null); },
    add: (key, item) => { mapItems(key, (a) => [...a, item], true); setSelected({ key, id: item.id }); },
    addMany: (key, list) => { mapItems(key, (a) => [...a, ...list], true); },
    patch: (key, id, p, record = false) => mapItems(key, (a) => a.map((x) => (x.id === id ? { ...x, ...p } : x)), record),
    commitNow: () => {},
    setPage: (key, p) => { const c = editsRef.current; commit({ ...c, pages: { ...c.pages, [key]: { ...(c.pages?.[key] || {}), ...p } } }, true); },
    startEditing: (id) => setEditing({ id, selectAll: false }),
    stopEditing: (key, it) => {
      setEditing(null);
      if (!(it.text || "").trim()) mapItems(key, (a) => a.filter((x) => x.id !== it.id), false);
    },
    editLink: (key, it) => {
      const url = window.prompt("Link URL", it.url || "https://");
      if (url) mapItems(key, (a) => a.map((x) => (x.id === it.id ? { ...x, url } : x)), true);
    },
    afterOneShot: (t) => { if (ONE_SHOT.has(t)) setTool("select"); },
    editImage: (key, item) => onEditImage?.({ key, item }),

    editExisting: (key, ti, bg) => {
      const c = editsRef.current;
      const id = uid();
      const cover = { id: uid(), type: "whiteout", x: ti.x - 1, y: ti.y - 0.5, w: ti.w + 2, h: ti.h + 1, color: bg };
      const text = { id, type: "text", x: ti.x, y: ti.y, w: Math.max(ti.w * 1.08 + 8, 40), h: ti.h * 1.25, text: ti.str, size: Math.round(ti.h * 10) / 10, color: "#000000", font: ti.font, bold: false, italic: false, align: "left" };
      commit({ ...c, items: { ...c.items, [key]: [...(c.items?.[key] || []), cover, text] } }, true);
      setSelected({ key, id });
      setEditing({ id, selectAll: true });
      setTool("select");
    },

    place: (key, t, p, W, H) => {
      const st = styleRef.current;
      if (t === "text") {
        const id = uid();
        api.add(key, { id, type: "text", x: p.x, y: p.y, w: 170, h: st.size * 1.25, text: "", size: st.size, color: st.color, font: st.font, bold: st.bold, italic: st.italic, align: st.align });
        setEditing({ id, selectAll: false }); setTool("select");
      } else if (t === "note") {
        api.add(key, { id: uid(), type: "note", x: p.x, y: p.y, text: "", color: "#fde047" });
        setTool("select");
      } else if (t === "check" || t === "cross" || t === "dot") {
        api.add(key, { id: uid(), type: t, x: p.x - 9, y: p.y - 9, w: 18, h: 18, color: st.color, sw: Math.max(st.sw, 2) });
        setTool("select");
      } else if (t === "date") {
        const id = uid();
        api.add(key, { id, type: "text", x: p.x, y: p.y, w: 90, h: st.size * 1.25, text: todayText(), size: st.size, color: st.color, font: st.font, bold: st.bold, italic: st.italic, align: "left" });
        setTool("select");
      } else if (t === "sign" || t === "initials") {
        const src = sigs[t];
        if (!src) { setSigDlg({ kind: t, key, p }); return; }
        placeSignature(key, src, p, t);
      } else if (t === "image" && pendingImage) {
        const w = Math.min(220, W * 0.4);
        api.add(key, { id: uid(), type: "image", x: p.x - w / 2, y: p.y - (w * pendingImage.ratio) / 2, w, h: w * pendingImage.ratio, src: pendingImage.src, opacity: 1 });
        setPendingImage(null); setTool("select");
      }
    },

    startDrag: (e, key, it, mode) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      setActiveKey(key);
      setSelected({ key, id: it.id });
      const toPt = toPtRef.current[key];
      if (!toPt) return;
      const start = toPt(e);
      const orig = JSON.parse(JSON.stringify(it));
      if (orig.src) orig.src = it.src;
      let snapped = false;
      const move = (ev) => {
        const p = toPt(ev);
        const dx = p.x - start.x, dy = p.y - start.y;
        if (!snapped && Math.hypot(dx, dy) > 1) { snap(); snapped = true; }
        let patch = null;
        if (mode === "move") {
          if (orig.type === "line" || orig.type === "arrow") patch = { x: orig.x + dx, y: orig.y + dy, x2: orig.x2 + dx, y2: orig.y2 + dy };
          else if (orig.type === "ink") patch = { pts: orig.pts.map(([a, b]) => [a + dx, b + dy]) };
          else patch = { x: orig.x + dx, y: orig.y + dy };
        } else if (mode === "p1") patch = { x: p.x, y: p.y };
        else if (mode === "p2") patch = { x2: p.x, y2: p.y };
        else {
          const b = itemBBox(orig);
          let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
          if (mode.includes("w")) x1 = Math.min(p.x, x2 - 6);
          if (mode.includes("e")) x2 = Math.max(p.x, x1 + 6);
          if (mode.includes("n")) y1 = Math.min(p.y, y2 - 6);
          if (mode.includes("s")) y2 = Math.max(p.y, y1 + 6);
          if (orig.type === "text") patch = { x: x1, w: Math.max(30, x2 - x1) };
          else if (orig.type === "image") { const w = x2 - x1; patch = { x: x1, y: mode.includes("n") ? y2 - w * (orig.h / orig.w) : y1, w, h: w * (orig.h / orig.w) }; }
          else if (orig.type === "check" || orig.type === "cross" || orig.type === "dot") { const w = Math.max(x2 - x1, 8); patch = { x: x1, y: y1, w, h: w }; }
          else patch = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        }
        if (patch) mapItems(key, (a) => a.map((x) => (x.id === it.id ? { ...x, ...patch } : x)), false);
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
  };

  const placeSignature = async (key, src, p, kind) => {
    const img = await loadImg(src);
    const w = kind === "initials" ? 60 : 140;
    api.add(key, { id: uid(), type: "image", x: p.x - w / 2, y: p.y - (w * img.naturalHeight) / img.naturalWidth / 2, w, h: (w * img.naturalHeight) / img.naturalWidth, src, opacity: 1 });
    setTool("select");
  };

  /* ---------- selection / style sync ---------- */
  const selItem = useMemo(() => {
    if (!selected) return null;
    return (cur.items?.[selected.key] || []).find((x) => x.id === selected.id) || null;
  }, [selected, cur]);

  const applyStyle = (patch) => {
    setStyle((s) => ({ ...s, ...patch }));
    if (selItem) {
      const p = { ...patch };
      if ("hlColor" in p) { p.color = p.hlColor; delete p.hlColor; }
      if ("fillWhite" in p) { p.color = p.fillWhite; delete p.fillWhite; }
      const allowed = ["color", "fill", "sw", "size", "font", "bold", "italic", "align", "opacity"];
      const out = {};
      Object.keys(p).forEach((k) => { if (allowed.includes(k)) out[k] = p[k]; });
      if (Object.keys(out).length) { snap(); api.patch(selected.key, selected.id, out, false); }
    }
  };

  const deleteSelected = () => {
    if (!selected) return;
    mapItems(selected.key, (a) => a.filter((x) => x.id !== selected.id), true);
    setSelected(null); setEditing(null);
  };
  const duplicateSelected = () => {
    if (!selItem) return;
    const copy = { ...JSON.parse(JSON.stringify(selItem)), id: uid() };
    if (selItem.type === "image") copy.src = selItem.src;
    if (copy.pts) copy.pts = copy.pts.map(([a, b]) => [a + 12, b + 12]); else { copy.x += 12; copy.y += 12; if ("x2" in copy) { copy.x2 += 12; copy.y2 += 12; } }
    api.add(selected.key, copy);
  };

  const onKeyDown = (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelected(); }
    else if (mod && e.key.toLowerCase() === "c" && selItem) { clip.current = JSON.parse(JSON.stringify(selItem)); if (selItem.src) clip.current.src = selItem.src; }
    else if (mod && e.key.toLowerCase() === "v" && clip.current && activeKey) {
      e.preventDefault();
      const c = { ...clip.current, id: uid() };
      if (c.pts) c.pts = c.pts.map(([a, b]) => [a + 16, b + 16]); else { c.x += 16; c.y += 16; if ("x2" in c) { c.x2 += 16; c.y2 += 16; } }
      api.add(activeKey, c);
    }
    else if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); deleteSelected(); }
    else if (e.key === "Escape") { setTool("select"); setSelected(null); setPendingImage(null); }
    else if (selItem && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
      const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
      const patch = selItem.pts ? { pts: selItem.pts.map(([a, b]) => [a + dx, b + dy]) } : { x: selItem.x + dx, y: selItem.y + dy, ...("x2" in selItem ? { x2: selItem.x2 + dx, y2: selItem.y2 + dy } : {}) };
      mapItems(selected.key, (a) => a.map((x) => (x.id === selected.id ? { ...x, ...patch } : x)), true);
    }
  };

  /* ---------- tools ---------- */
  const chooseTool = (t) => {
    setSelected(null); setEditing(null);
    if (t === "image") { fileRef.current?.click(); return; }
    if ((t === "sign" || t === "initials") && !sigs[t]) { setSigDlg({ kind: t, key: null, p: null }); setTool(t); return; }
    setTool(t);
  };
  const onImageChosen = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const src = await fileToDataUrl(f);
    const img = await loadImg(src);
    setPendingImage({ src, ratio: img.naturalHeight / img.naturalWidth });
    setTool("image");
  };
  const onSignature = async (url) => {
    const d = sigDlg;
    setSigDlg(null);
    if (!url) return;
    setSigs((s) => ({ ...s, [d.kind]: url }));
    try { localStorage.setItem(d.kind === "sign" ? "rg_pdf_sign" : "rg_pdf_initials", url); } catch { /* quota */ }
    if (d.key && d.p) placeSignature(d.key, url, d.p, d.kind);
  };

  /* ---------- display list (real pages + inserted blanks) ---------- */
  const display = useMemo(() => {
    const out = [];
    (pageNumbers || []).forEach((n, idx) => {
      const key = pageKey(n);
      const size = sizes[n];
      if (!size) return;
      out.push({ key, n, size, blank: false, label: `Page ${n}` });
      const blanks = cur.pages?.[key]?.blanks || 0;
      for (let k = 1; k <= blanks; k++) out.push({ key: `${key}#b${k}`, n, size, blank: true, label: `Blank page after ${n}` });
    });
    return out;
  }, [pageNumsKey, sizes, cur.pages, allPageKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (display.length && !display.find((d) => d.key === activeKey)) setActiveKey(display[0].key);
  }, [display, activeKey]);

  const activeIdx = Math.max(0, display.findIndex((d) => d.key === activeKey));
  const activeDisp = display[activeIdx];
  const activeSt = (activeDisp && cur.pages?.[activeDisp.key]) || {};

  const rotate = (dir) => activeDisp && api.setPage(activeDisp.key, { rot: (((activeSt.rot || 0) + dir) % 360 + 360) % 360 });
  const toggleDelete = () => activeDisp && api.setPage(activeDisp.key, { deleted: !activeSt.deleted });
  const insertBlank = () => {
    if (!activeDisp) return;
    const base = activeDisp.blank ? pageKey(activeDisp.n) : activeDisp.key;
    api.setPage(base, { blanks: (cur.pages?.[base]?.blanks || 0) + 1 });
  };
  const clearPageEdits = () => {
    if (!activeDisp) return;
    const c = editsRef.current;
    commit({ ...c, items: { ...c.items, [activeDisp.key]: [] } }, true);
    setSelected(null);
  };
  const goTo = (i) => {
    const d = display[clamp(i, 0, display.length - 1)];
    if (!d) return;
    setActiveKey(d.key);
    scrollRef.current?.querySelector(`[data-page-key="${CSS.escape(d.key)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  /* ---------- search ---------- */
  useEffect(() => {
    const t = setTimeout(() => {
      const els = scrollRef.current?.querySelectorAll("[data-match]") || [];
      setMatchCount(els.length);
      setMatchIdx(0);
    }, 250);
    return () => clearTimeout(t);
  }, [query, display, pdf]);
  const stepMatch = (dir) => {
    const els = scrollRef.current?.querySelectorAll("[data-match]");
    if (!els?.length) return;
    const next = (matchIdx + dir + els.length) % els.length;
    els.forEach((e) => (e.style.outline = "1px solid #f59e0b"));
    els[next].style.outline = "2px solid #f84f63";
    els[next].scrollIntoView({ block: "center", behavior: "smooth" });
    setMatchIdx(next);
  };

  /* ---------- export ---------- */
  const flattenPage = async (pageNo, rects) => {
    const page = await pdf.getPage(pageNo);
    const S = 2.5;
    const vp = page.getViewport({ scale: S });
    const c = document.createElement("canvas");
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    ctx.fillStyle = "#000";
    rects.forEach((r) => ctx.fillRect(r.x * S, r.y * S, r.w * S, r.h * S));
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  };

  const download = async (scopeName) => {
    setMenu(false); setError(""); setBusy(scopeName);
    try {
      const keys = allPageKeys || [];
      const scope = scopeName === "section" ? new Set((pageNumbers || []).map(pageKey)) : null;
      const out = await exportPdf({ bytes: bytesRef.current, keys, edits: editsRef.current, scope, flattenPage });
      const blob = new Blob([out], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const name = `${(title || "report").replace(/[^\w\-]+/g, "_")}${scopeName === "section" ? "_edited" : "_full_edited"}.pdf`;
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy("");
    }
  };

  const openForPrint = async () => {
    setMenu(false); setError(""); setBusy("print");
    try {
      const scope = new Set((pageNumbers || []).map(pageKey));
      const out = await exportPdf({ bytes: bytesRef.current, keys: allPageKeys || [], edits: editsRef.current, scope, flattenPage });
      window.open(URL.createObjectURL(new Blob([out], { type: "application/pdf" })), "_blank");
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy("");
    }
  };

  /* ---------- derived UI ---------- */
  const ctxType = selItem?.type || tool;
  const showTextProps = ["text", "edittext", "date"].includes(ctxType);
  const showStroke = ["rect", "ellipse", "line", "arrow", "ink", "check", "cross", "dot"].includes(ctxType);
  const showFill = ["rect", "ellipse"].includes(ctxType);
  const showHl = ctxType === "highlight";
  const showColor = showTextProps || showStroke || ["underline", "strike", "sign"].includes(ctxType);
  const showOpacity = ["rect", "ellipse", "line", "arrow", "ink", "image", "highlight"].includes(ctxType);
  const undoCount = hist.current.undo.length;
  const redoCount = hist.current.redo.length;
  const tabDef = TABS.find((t) => t.id === tab);
  const editCount = Object.values(cur.items || {}).reduce((n, a) => n + a.length, 0);

  return (
    <div ref={rootRef} tabIndex={0} onKeyDown={onKeyDown} className="relative flex h-full w-full max-w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0a2744] outline-none">
      <style>{`
        .pdfed-hover:hover{background:rgba(248,79,99,.18)!important;outline:1px dashed #f84f63}
        .pdfed-horizontal-scroll {
          overflow-x: auto !important;
          overflow-y: hidden !important;
          flex-wrap: nowrap !important;
          white-space: nowrap;
          overscroll-behavior-x: contain;
          scrollbar-width: thin;
          scrollbar-color: #527b91 #0a2744;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x pan-y;
        }
        .pdfed-horizontal-scroll::-webkit-scrollbar {
          height: 7px;
        }
        .pdfed-horizontal-scroll::-webkit-scrollbar-track {
          background: #0a2744;
          border-radius: 999px;
        }
        .pdfed-horizontal-scroll::-webkit-scrollbar-thumb {
          background: #527b91;
          border: 1px solid #0a2744;
          border-radius: 999px;
        }
        .pdfed-horizontal-scroll::-webkit-scrollbar-thumb:hover {
          background: #f84f63;
        }
        .pdfed-horizontal-scroll > * {
          flex-shrink: 0;
        }
      `}</style>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImageChosen} />

      {/* header: title, page nav, zoom, undo/redo, search, download */}
      <div className="flex w-full max-w-full min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-[#2a5068]/60 bg-[#0a2744] px-2 py-2 sm:px-3">
        <div className="min-w-0 flex-1 basis-full xl:basis-auto">
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#f84f63]">PDF editor</p>
          <p className="truncate text-sm font-semibold text-white">{title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className={`${BTN} !px-2 !py-1.5`} disabled={activeIdx <= 0} onClick={() => goTo(activeIdx - 1)} aria-label="Previous page">‹</button>
          <span className="whitespace-nowrap px-1 text-xs text-[#9bbcc0]">{display.length ? `${activeIdx + 1} / ${display.length}` : "–"}</span>
          <button type="button" className={`${BTN} !px-2 !py-1.5`} disabled={activeIdx >= display.length - 1} onClick={() => goTo(activeIdx + 1)} aria-label="Next page">›</button>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 xl:flex-nowrap">
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className={`${BTN} !px-2 !py-1.5`} onClick={() => setZoom(clamp(+(scale - 0.15).toFixed(2), 0.3, 3))} aria-label="Zoom out">−</button>
            <button type="button" className={`${BTN} min-w-[48px] justify-center !px-2 !py-1.5`} onClick={() => setZoom("fit")} title="Fit to width">{Math.round(scale * 100)}%</button>
            <button type="button" className={`${BTN} !px-2 !py-1.5`} onClick={() => setZoom(clamp(+(scale + 0.15).toFixed(2), 0.3, 3))} aria-label="Zoom in">+</button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className={BTN} disabled={!undoCount} onClick={undo} title="Undo (Ctrl+Z)"><Ico name="undo" /></button>
            <button type="button" className={BTN} disabled={!redoCount} onClick={redo} title="Redo (Ctrl+Y)"><Ico name="redo" /></button>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1 sm:max-w-[220px]">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[#7f9ba8]"><Ico name="search" size={13} /></span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") stepMatch(e.shiftKey ? -1 : 1); e.stopPropagation(); }} placeholder="Find in PDF" className={`${FIELD} w-full min-w-0 !pl-7`} />
            </div>
            {query.trim() && (
              <>
                <span className="whitespace-nowrap text-[11px] text-[#9bbcc0]">{matchCount ? `${matchIdx + 1}/${matchCount}` : "0"}</span>
                <button type="button" className={BTN} onClick={() => stepMatch(-1)} disabled={!matchCount}>↑</button>
                <button type="button" className={BTN} onClick={() => stepMatch(1)} disabled={!matchCount}>↓</button>
              </>
            )}
          </div>
        </div>
        <div className="relative ml-auto flex shrink-0 justify-end">
          <button type="button" className={`${BTN} !border-[#f84f63] !bg-[#f84f63] !text-white`} disabled={!pdf || Boolean(busy)} onClick={() => setMenu((m) => !m)}>
            <Ico name="download" /> {busy ? "Working…" : "Download"}
          </button>
          {menu && (
            <div className="absolute right-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-lg border border-[#2f5b75] bg-[#0b2b47] shadow-2xl">
              <button type="button" className="block w-full px-3 py-2 text-left text-xs text-[#c8dfe1] hover:bg-[#f84f63]/15" onClick={() => download("section")}>This section — edited PDF</button>
              <button type="button" className="block w-full px-3 py-2 text-left text-xs text-[#c8dfe1] hover:bg-[#f84f63]/15" onClick={() => download("full")}>Full report — edited PDF</button>
              <button type="button" className="block w-full px-3 py-2 text-left text-xs text-[#c8dfe1] hover:bg-[#f84f63]/15" onClick={openForPrint}>Open / print this section</button>
            </div>
          )}
        </div>
      </div>

      {/* tabs */}
      <div className="pdfed-horizontal-scroll flex w-full min-w-0 shrink-0 gap-1 border-b border-[#2a5068]/60 bg-[#0b2b47] px-2 pt-2 sm:px-3">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => { setTab(t.id); if (t.id === "pages") setTool("select"); else if (t.tools.length && !t.tools.find((x) => x[0] === tool)) chooseTool(t.tools[0][0] === "image" ? "select" : t.tools[0][0]); }}
            className={`shrink-0 whitespace-nowrap rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-semibold transition ${tab === t.id ? "border-[#2f5b75] bg-[#0a2744] text-white" : "border-transparent text-[#9bbcc0] hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* tool row */}
      <div className="pdfed-horizontal-scroll flex w-full min-w-0 shrink-0 items-center gap-1.5 border-b border-[#2a5068]/60 bg-[#0a2744] px-2 py-2 sm:px-3">
        {tab !== "pages" && tabDef.tools.map(([id, label]) => (
          <button key={id} type="button" title={label} onClick={() => chooseTool(id)} className={`${BTN} shrink-0 ${tool === id ? BTN_ON : ""}`}>
            <Ico name={id} /> {label}
          </button>
        ))}
        {tab === "pages" && (
          <>
            <span className="mr-1 text-xs text-[#9bbcc0]">{activeDisp ? activeDisp.label : "No page"}:</span>
            <button type="button" className={BTN} onClick={() => rotate(-90)} disabled={!activeDisp}><Ico name="rotL" /> Rotate left</button>
            <button type="button" className={BTN} onClick={() => rotate(90)} disabled={!activeDisp}><Ico name="rotR" /> Rotate right</button>
            <button type="button" className={BTN} onClick={toggleDelete} disabled={!activeDisp}><Ico name={activeSt.deleted ? "restore" : "trash"} /> {activeSt.deleted ? "Restore page" : "Delete page"}</button>
            <button type="button" className={BTN} onClick={insertBlank} disabled={!activeDisp}><Ico name="plus" /> Insert blank page after</button>
            <button type="button" className={BTN} onClick={clearPageEdits} disabled={!activeDisp}><Ico name="eraser" /> Clear edits on page</button>
          </>
        )}
        {(tool === "sign" || tool === "initials") && (
          <button type="button" className={BTN} onClick={() => setSigDlg({ kind: tool, key: null, p: null })}>Change {tool}</button>
        )}
      </div>

      {/* properties row */}
      {tab !== "pages" && (showColor || showHl || showFill || showStroke || showTextProps || showOpacity || selItem) && (
        <div className="pdfed-horizontal-scroll flex w-full min-w-0 shrink-0 items-center gap-x-3 border-b border-[#2a5068]/60 bg-[#0b2b47]/70 px-2 py-2 text-[11px] text-[#9bbcc0] sm:px-3 sm:py-1.5">
          {showColor && (
            <div className="flex items-center gap-1">
              <span>Color</span>
              {SWATCHES.map((c) => (
                <button key={c} type="button" onClick={() => applyStyle({ color: c })} aria-label={c} className="h-5 w-5 rounded-full border" style={{ background: c, borderColor: (selItem?.color || style.color) === c ? "#f84f63" : "#2f5b75", borderWidth: (selItem?.color || style.color) === c ? 2 : 1 }} />
              ))}
              <input type="color" value={selItem?.color || style.color} onChange={(e) => applyStyle({ color: e.target.value })} className="h-5 w-6 cursor-pointer rounded border border-[#2f5b75] bg-transparent p-0" />
            </div>
          )}
          {showHl && (
            <div className="flex items-center gap-1">
              <span>Highlight</span>
              {HL_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => applyStyle({ hlColor: c })} className="h-5 w-5 rounded-full border" style={{ background: c, borderColor: (selItem?.color || style.hlColor) === c ? "#f84f63" : "#2f5b75", borderWidth: (selItem?.color || style.hlColor) === c ? 2 : 1 }} />
              ))}
            </div>
          )}
          {tool === "highlight" && !selItem && null}
          {showFill && (
            <div className="flex items-center gap-1">
              <span>Fill</span>
              <button type="button" onClick={() => applyStyle({ fill: null })} className={`${BTN} !px-2 !py-0.5 ${!(selItem ? selItem.fill : style.fill) ? BTN_ON : ""}`}>None</button>
              <input type="color" value={(selItem ? selItem.fill : style.fill) || "#fde047"} onChange={(e) => applyStyle({ fill: e.target.value })} className="h-5 w-6 cursor-pointer rounded border border-[#2f5b75] bg-transparent p-0" />
            </div>
          )}
          {showStroke && (
            <label className="flex items-center gap-1">Width
              <input type="range" min="1" max="12" value={selItem?.sw || style.sw} onChange={(e) => applyStyle({ sw: +e.target.value })} className="w-20 accent-[#f84f63]" />
            </label>
          )}
          {showOpacity && (
            <label className="flex items-center gap-1">Opacity
              <input type="range" min="0.1" max="1" step="0.05" value={selItem?.opacity ?? style.opacity} onChange={(e) => applyStyle({ opacity: +e.target.value })} className="w-20 accent-[#f84f63]" />
            </label>
          )}
          {showTextProps && (
            <div className="flex flex-wrap items-center gap-1.5">
              <select value={selItem?.font || style.font} onChange={(e) => applyStyle({ font: e.target.value })} className={FIELD}>
                <option>Helvetica</option><option>Times</option><option>Courier</option>
              </select>
              <input type="number" min="6" max="96" value={Math.round((selItem?.size || style.size) * 10) / 10} onChange={(e) => applyStyle({ size: clamp(+e.target.value || 12, 6, 96) })} className={`${FIELD} w-14`} />
              <button type="button" onClick={() => applyStyle({ bold: !(selItem ? selItem.bold : style.bold) })} className={`${BTN} !px-2 !py-0.5 font-bold ${(selItem ? selItem.bold : style.bold) ? BTN_ON : ""}`}>B</button>
              <button type="button" onClick={() => applyStyle({ italic: !(selItem ? selItem.italic : style.italic) })} className={`${BTN} !px-2 !py-0.5 italic ${(selItem ? selItem.italic : style.italic) ? BTN_ON : ""}`}>I</button>
              {["left", "center", "right"].map((a) => (
                <button key={a} type="button" onClick={() => applyStyle({ align: a })} className={`${BTN} !px-2 !py-0.5 ${(selItem?.align || style.align) === a ? BTN_ON : ""}`}>{a[0].toUpperCase()}</button>
              ))}
            </div>
          )}
          {selItem && (
            <div className="ml-auto flex items-center gap-1">
              <button type="button" className={BTN} onClick={duplicateSelected} title="Duplicate (Ctrl+D)"><Ico name="copy" /> Duplicate</button>
              <button type="button" className={`${BTN} hover:!border-[#f84f63]`} onClick={deleteSelected} title="Delete"><Ico name="trash" /> Delete</button>
            </div>
          )}
        </div>
      )}

      {/* hint */}
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 bg-[#082944] px-2 py-1 text-[10px] text-[#7f9ba8] sm:gap-3 sm:px-3 sm:text-[11px]">
        <span className="truncate">{pendingImage ? HINTS.image : HINTS[tool] || ""}</span>
        <span className="shrink-0">{editCount ? `${editCount} edit${editCount > 1 ? "s" : ""}` : "No edits yet"}</span>
      </div>
      {error && (
        <div className="flex shrink-0 items-center justify-between gap-2 bg-[#f84f63]/15 px-3 py-1.5 text-xs text-[#ffb3bd]">
          <span>{error}</span><button type="button" onClick={() => setError("")} className="font-bold">✕</button>
        </div>
      )}

      {/* pages (no left sidebar — full width canvas) */}
      <div ref={scrollRef} className="h-full w-full min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-[#061d31] px-2 pb-6 pt-3 sm:px-4 sm:pb-8 sm:pt-6" onPointerDown={() => rootRef.current?.focus({ preventScroll: true })}>
        {!pdfBase64 || !pdf ? (
          <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-[#9bbcc0]">{loading || pdfBase64 ? "Rendering preview…" : "No preview available yet. Fill the section to generate it."}</div>
        ) : (
          <div className="mx-auto w-max min-w-full max-w-none" style={{ width: "max-content", minWidth: "100%" }}>
            {display.map((d) => (
              <PageView
                key={d.key}
                pdf={pdf} pageNo={d.n} pageKey={d.key} label={d.label} size={d.size} blank={d.blank}
                scale={scale} rot={cur.pages?.[d.key]?.rot || 0} deleted={Boolean(cur.pages?.[d.key]?.deleted)}
                tool={tool} items={cur.items?.[d.key] || []} selectedId={selected?.key === d.key ? selected.id : null}
                editing={selected?.key === d.key ? editing : null} api={api} query={query} active={d.key === activeKey}
              />
            ))}
          </div>
        )}
      </div>

      {sigDlg && <SignatureDialog kind={sigDlg.kind} onDone={onSignature} onClose={() => setSigDlg(null)} />}
    </div>
  );
}
