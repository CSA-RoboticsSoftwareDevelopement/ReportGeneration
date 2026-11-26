"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PageSurface from "./studio/PageSurface";
import { api, downloadUrl } from "./studio/api";
import { Btn, Icon, INPUT, LABEL } from "./studio/ui";

/* A4 in PDF points: the report engine always builds A4 pages, and it reports image positions in points. */
const PAGE_W = 595.2756;
const PAGE_H = 841.8898;

const Glyph = ({ children, className = "h-[18px] w-[18px]" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>
);
const ImagePlusIcon = (p) => <Glyph {...p}><path d="M14 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M4 16l4.5-4.5 3.5 3.5 2-2" /><path d="M18 3v6M15 6h6" /></Glyph>;
const PencilIcon = (p) => <Glyph {...p}><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></Glyph>;
const SwapIcon = (p) => <Glyph {...p}><path d="M4 8h13l-3-3M20 16H7l3 3" /></Glyph>;
const TrashIcon = (p) => <Glyph {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Glyph>;
const TableIcon = (p) => <Glyph {...p}><path d="M3 3h18v18H3zM3 7h18M3 11h18M3 15h18M7 3v18M11 3v18M15 3v18" /></Glyph>;
const MoveIcon = (p) => <Glyph {...p}><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></Glyph>;
const SparkleIcon = (p) => <Glyph {...p}><path d="M10 4l1.8 4.9L16.7 10.7l-4.9 1.8L10 17.4l-1.8-4.9L3.3 10.7l4.9-1.8zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" /></Glyph>;

const GLASS_PANEL = {
  background: "linear-gradient(90deg, rgba(160,175,188,.92) 0%, rgba(58,82,104,.82) 22%, rgba(14,34,54,.9) 52%, rgba(8,24,40,.94) 100%)",
  backdropFilter: "blur(18px) saturate(140%)",
  WebkitBackdropFilter: "blur(18px) saturate(140%)",
  border: "1px solid rgba(255,255,255,.22)",
  boxShadow: "0 24px 70px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.18)",
};
const GLASS_CARD = {
  background: "linear-gradient(90deg, rgba(96,112,126,.62) 0%, rgba(30,52,72,.6) 45%, rgba(14,34,54,.55) 100%)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,.12)",
  borderTopColor: "rgba(255,255,255,.28)",
  boxShadow: "0 8px 22px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.12)",
};

const PANEL_W = 500;
const PANEL_H = 610;

function AiSuggestions({ anchor, result, status, error, onRegenerate, onDiscard, onApprove, onClose }) {
  const [vp, setVp] = useState(() => ({ w: typeof window === "undefined" ? 1280 : window.innerWidth, h: typeof window === "undefined" ? 800 : window.innerHeight }));
  const [caption, setCaption] = useState("");
  const [description, setDescription] = useState("");
  const [observations, setObservations] = useState("");
  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    setCaption(result?.suggestions?.caption || "");
    setDescription(result?.suggestions?.description || "");
    setObservations((result?.suggestions?.observations || []).join("\n"));
  }, [result]);

  if (typeof document === "undefined") return null;

  const mobile = vp.w < 640;
  const scale = Math.min(1, (vp.w - 24) / PANEL_W, (vp.h - 24) / PANEL_H);
  const w = PANEL_W * scale, h = PANEL_H * scale, gap = 16;
  let left = (vp.w - w) / 2;
  if (anchor) {
    if (vp.w - anchor.right - gap - 12 >= w) left = anchor.right + gap;
    else if (anchor.left - gap - 12 >= w) left = anchor.left - gap - w;
  }
  /* like the design: the sparkle button sits near the bottom of the panel */
  let top = anchor ? anchor.bottom + 100 * scale - h : (vp.h - h) / 2;
  top = Math.max(12, Math.min(top, vp.h - h - 12));

  const header = (
    <div className="relative mb-3 flex h-9 shrink-0 items-center justify-center gap-2 text-[#d3e0ea]">
      <h4 className={`font-semibold tracking-tight ${mobile ? "text-xl" : "text-[24px]"}`}>AI Suggestions</h4>
      <SparkleIcon className="h-5 w-5" />
      <button type="button" onClick={onClose} aria-label="Close AI suggestions"
        className="absolute right-0 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/5 text-lg leading-none text-white/80 hover:bg-white/15">×</button>
    </div>
  );
  const cards = AI_SUGGESTIONS.slice(0, 3).map((text, i) => (
    <div key={i} style={{ animationDelay: `${150 + i * 90}ms` }} className={`rg-rise flex flex-col ${mobile ? "" : "min-h-0 flex-1"}`}>
      <p className={`mb-2 ml-1 shrink-0 font-semibold text-white/95 ${mobile ? "text-[12px]" : "text-[13px]"}`}>Suggestion {i + 1}</p>
      <button type="button" title={text} onClick={(e) => { e.stopPropagation(); onPick(text); }} style={GLASS_CARD}
        className={`flex w-full items-center justify-center text-center text-[#f3f8f7] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f84f63] ${mobile ? "min-h-[110px] rounded-[22px] px-5 py-4 text-sm leading-5" : "min-h-0 flex-1 rounded-[22px] px-6 text-[14px] leading-[1.35]"}`}>
        <span style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: mobile ? 8 : 4, overflow: "hidden" }}>{text}</span>
      </button>
    </div>
  ));
  const extracted = Object.entries(result?.extracted_values || {});
  const review = result ? (
    <div className="studio-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-left text-xs">
      {result.analysis_type ? <p className="rounded-xl border border-cyan-200/15 bg-cyan-200/10 px-3 py-2 text-[#d7e9ec]"><b>Detected:</b> {result.analysis_type}</p> : null}
      <label className="block"><span className="mb-1 block font-semibold text-white/90">Suggested caption</span><input value={caption} onChange={(e) => setCaption(e.target.value)} className="w-full rounded-lg border border-white/20 bg-[#061d31]/70 px-3 py-2 text-white outline-none focus:border-[#8ec5ff]" /></label>
      <label className="block"><span className="mb-1 block font-semibold text-white/90">Engineering description</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full resize-y rounded-lg border border-white/20 bg-[#061d31]/70 px-3 py-2 text-white outline-none focus:border-[#8ec5ff]" /></label>
      <label className="block"><span className="mb-1 block font-semibold text-white/90">Observations (one per line)</span><textarea value={observations} onChange={(e) => setObservations(e.target.value)} rows={3} className="w-full resize-y rounded-lg border border-white/20 bg-[#061d31]/70 px-3 py-2 text-white outline-none focus:border-[#8ec5ff]" /></label>
      {extracted.length ? <div style={GLASS_CARD} className="rounded-xl p-3"><p className="mb-2 font-semibold text-white/90">Extracted values <span className="font-normal text-amber-200">(unverified)</span></p>{extracted.map(([name, value]) => <p key={name} className="mb-1 text-[#e5f2f3]"><b>{name}:</b> {value?.value ?? "Unreadable"}{value?.unit ? ` ${value.unit}` : ""}</p>)}</div> : null}
      {(result.warnings || []).map((warning, i) => <p key={i} className="rounded-lg border border-amber-200/20 bg-amber-200/10 px-3 py-2 text-amber-100">{warning}</p>)}
    </div>
  ) : (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#d7e9ec]">{status === "loading" ? "Analysing the image locally with Ollama…" : error || "No suggestions are available yet."}</div>
  );

  /* grow from the side the sparkle button is on */
  const originX = anchor && left < anchor.left ? "100%" : "0%";

  const panel = mobile ? (
    <div data-img-ui role="dialog" aria-modal="true" aria-label="AI Suggestions"
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
      className="rg-sheet pointer-events-auto fixed inset-x-3 bottom-3 z-[130] max-h-[80dvh] overflow-y-auto rounded-[28px] px-4 pb-5 pt-4 text-white"
      style={GLASS_PANEL}>
      {header}{review}
      <div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" onClick={onDiscard} className="rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold hover:bg-white/10">Discard</button><button type="button" onClick={onRegenerate} disabled={status === "loading"} className="rounded-lg border border-[#8ec5ff]/60 px-3 py-2 text-xs font-semibold text-[#d7e9ec] disabled:opacity-50">{status === "loading" ? "Analysing…" : "Regenerate"}</button>{result ? <button type="button" onClick={() => onApprove({ caption, description, observations: observations.split("\n").map((item) => item.trim()).filter(Boolean) })} className="rounded-lg bg-[#f84f63] px-3 py-2 text-xs font-bold text-white hover:bg-[#ff6377]">Approve and insert</button> : null}</div>
    </div>
  ) : (
    /* outer box: position and size only. middle box: the spring animation. inner box: your existing scaled glass panel. */
    <div data-img-ui className="pointer-events-none fixed z-[130]" style={{ left, top, width: w, height: h }}>
      <div className="rg-pop pointer-events-auto h-full w-full" style={{ "--rg-origin": `${originX} 100%` }}>
        <div data-img-ui role="dialog" aria-label="AI Suggestions"
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
          className="flex flex-col rounded-[30px] px-6 pb-5 pt-5 text-white"
          style={{ ...GLASS_PANEL, width: PANEL_W, height: PANEL_H, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          {header}
          <div className="flex min-h-0 flex-1 flex-col gap-3">{cards}</div>
        </div>
      </div>
    </div>
  );

  return createPortal(
    mobile ? <div data-img-ui className="rg-fade fixed inset-0 z-[125] bg-[#03121f]/60" onPointerDown={onClose}>{panel}</div> : panel,
    document.body
  );
}

/* A thumbnail that only renders once it scrolls near the viewport, so long reports stay fast. */
function LazyThumb({ pdf, number, scale, height, version, active, onClick }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <button ref={ref} type="button" data-thumb={number} onClick={onClick} aria-label={`Go to page ${number}`} aria-current={active ? "page" : undefined}
      className={`relative block w-full overflow-hidden rounded-sm border-2 bg-white transition ${active ? "border-[#f84f63] shadow-[0_0_0_2px_rgba(248,79,99,.25)]" : "border-transparent hover:border-[#7fd3c9]/70"}`}
      style={{ minHeight: seen ? undefined : height }}>
      {seen ? <PageSurface pdf={pdf} pageNumber={number} scale={scale} tool="thumb" version={version} /> : null}
      <span className={`absolute bottom-1 left-1 rounded px-1 text-[9px] font-bold ${active ? "bg-[#f84f63] text-[#081f35]" : "bg-[#081f35]/85 text-[#d7e9ec]"}`}>{number}</span>
    </button>
  );
}

const AlignIcon = ({ kind, ...p }) => {
  const d = { left: "M4 6h16M4 10h10M4 14h16M4 18h10", center: "M4 6h16M7 10h10M4 14h16M7 18h10", right: "M4 6h16M10 10h10M4 14h16M10 18h10", justify: "M4 6h16M4 10h16M4 14h16M4 18h16" }[kind];
  return <Glyph {...p}><path d={d} /></Glyph>;
};
const ALIGNS = [["left", "Align left"], ["center", "Align centre"], ["right", "Align right"], ["justify", "Justify"]];
const readTb = (v) => { try { const o = typeof v === "string" ? JSON.parse(v) : v; return o && typeof o === "object" ? o : null; } catch { return null; } };
const readSubsections = (v) => { try { const o = JSON.parse(String(v || "[]")); return Array.isArray(o) ? o : []; } catch { return []; } };
const r1 = (v) => Math.round(v * 10) / 10;

const TOOLS = [
  { id: "select", label: "Select (V)", icon: "cursor", hint: "Click a grey [ placeholder ] to enter its value. Click an image, text or table to select it; drag to move and use arrow keys to nudge." },
  { id: "edit-text", label: "Edit text (T)", icon: "textCursor", hint: "Click a line of text to rewrite it. Values update their linked field." },
  { id: "textbox", label: "Add text (A)", icon: "text", hint: "Click where the text should go, then type. It uses the report's own font, size and margins." },
  { id: "table", label: "Add table", icon: "table", hint: "Drag on the page to size a table. Click any cell to type; Tab moves to the next cell and adds a row at the end." },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PH = /\[ ([^\]]+?) \]/g;

/* ---- tables ----
   Stored in the report data as JSON under `tbl__<id>`:
   { sec, rel, page, top, x, w, h, rows, cols, headerRow, cellText[][], title, style }
   `style` is saved with the table so the report engine can draw it the same way the editor shows it:
   a light-blue bold header row, thin dark-blue borders and white body cells. */

  const TABLE_STYLE = {
  headerFill: "#ffffff",
  bodyFill: "#ffffff",
  border: "#000000",
  borderW: 0.5, /* points */
  text: "#000000",
  fontSize: 10, /* points */
  fontFamily: "Calibri, Carlito, Arial, sans-serif",
  align: "center",
  headerBold: false,
};
const TABLE_ROW_PT = 16; /* height of one row (points): a single line of text plus a little padding */
const normTbl = (t) => {
  const rows = Math.max(1, Math.round(Number(t?.rows)) || 1);
  const cols = Math.max(1, Math.round(Number(t?.cols)) || 1);
  const cellText = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => String(t?.cellText?.[r]?.[c] ?? "")));
  return { ...t, rows, cols, cellText, style: { ...TABLE_STYLE } };
};

/* The table as it appears in the PDF, drawn live on top of the page so it can be edited like a Word table. */
function TableOverlay({ t, pxPerPt, rowPx, active, onDraft, onBlurCell, onKeyCell }) {
  const st = { ...(t.style || {}), ...TABLE_STYLE }; /* the current look always wins, so older tables follow it too */
  const fs = Math.max(6, st.fontSize * pxPerPt);
  const lh = fs * 1.25;
  const bw = Math.max(1, st.borderW * pxPerPt);
  const padTop = Math.max(1, (rowPx - lh) / 2);
  const line = `${bw}px solid ${st.border}`;
  const cells = [];
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      const head = !!t.headerRow && r === 0;
      const isActive = !!active && active.r === r && active.c === c;
      const val = t.cellText[r][c];
      cells.push(
        <div key={`${r}-${c}`} className="relative min-h-0 min-w-0 overflow-hidden"
          style={{
            background: head ? st.headerFill : st.bodyFill,
            borderRight: c < t.cols - 1 ? line : "none",
            borderBottom: r < t.rows - 1 ? line : "none",
            fontWeight: head && st.headerBold ? 700 : 400,
          }}>
          {isActive ? (
            <textarea autoFocus defaultValue={val}
              className={`pointer-events-auto absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent px-1 outline-none ${st.align === "left" ? "text-left" : st.align === "right" ? "text-right" : "text-center"}`}
              style={{ paddingTop: padTop, lineHeight: `${lh}px`, fontFamily: "inherit", fontSize: "inherit", fontWeight: "inherit", color: "inherit", boxShadow: "inset 0 0 0 2px #2f80ff" }}
              onPointerDown={(e) => e.stopPropagation()}
              onFocus={(e) => { const n = e.target.value.length; e.target.setSelectionRange(n, n); }}
              onChange={(e) => onDraft(r, c, e.target.value)}
              onBlur={() => onBlurCell()}
              onKeyDown={(e) => onKeyCell(e, r, c)} />
          ) : (
            <div className="flex h-full items-center justify-center overflow-hidden whitespace-pre-wrap break-words px-1 text-center" style={{ lineHeight: `${lh}px` }}>{val}</div>
          )}
        </div>
      );
    }
  }
  return (
    <div className="pointer-events-none absolute inset-0 grid bg-white"
      style={{
        gridTemplateColumns: `repeat(${t.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${t.rows}, minmax(0, 1fr))`,
        border: line, color: st.text, fontFamily: st.fontFamily, fontSize: fs,
      }}>
      {cells}
    </div>
  );
}

const normaliseFieldName = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function fieldForPlaceholder(text, section) {
  const fields = Array.isArray(section?.fields) ? section.fields : [];
  const raw = String(text || "");
  const labels = [...raw.matchAll(PH)].map((match) => normaliseFieldName(match[1]));
  // Some PDF readers return an individual grey text span without its square
  // brackets. Treat that span itself as a field label.
  if (!labels.length && raw.trim()) labels.push(normaliseFieldName(raw));
  for (const label of labels) {
    const exact = fields.find((field) => normaliseFieldName(field.label) === label);
    if (exact) return exact;
    // PDF text extraction occasionally joins a unit or surrounding wording to
    // a grey value.  Retain exact matching first, then accept a unique label
    // contained in that extracted line (for example "Overall length ... mm").
    const contained = fields.filter((field) => {
      const name = normaliseFieldName(field.label);
      return name && (label.includes(name) || name.includes(label));
    });
    if (contained.length === 1) return contained[0];
    if (label.includes("stress")) return fields.find((field) => /_stress$/i.test(field.id));
    if (label.includes("deformation")) return fields.find((field) => /_def$/i.test(field.id));
    if (label.includes("location")) return fields.find((field) => /_loc$/i.test(field.id));
  }
  return null;
}

/* ---- map an edited line back to report fields ---- */
function mapEdit(oldT, newT, secId, schema, data) {
  const secs = schema.sections;
  const own = secs.find((s) => s.id === secId)?.fields || [];
  const fields = [...own, ...schema.general, ...secs.flatMap((s) => s.fields)];
  const byLabel = new Map();
  fields.forEach((f) => { if (!byLabel.has(f.label)) byLabel.set(f.label, f); });
  const byId = new Map(fields.map((f) => [f.id, f]));
  const m = /^a(\d)$/.exec(secId || "");
  if (m) {
    byLabel.set("stress", byId.get(`a${m[1]}_stress`));
    byLabel.set("deformation", byId.get(`a${m[1]}_def`));
  }
  const out = [];
  const push = (f, raw) => {
    if (!f) return;
    let v = String(raw || "").trim();
    if (!v || /^\[ .* \]$/.test(v)) return;
    if (f.type === "date") {
      const d = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
      if (d) v = `${d[3]}-${d[2]}-${d[1]}`;
    }
    if (f.type === "number") {
      v = v.replace(/[,\s]/g, "");
      if (v === "" || Number.isNaN(Number(v))) return;
    }
    if (!out.some((o) => o.id === f.id)) out.push({ id: f.id, label: f.label, from: data[f.id] ?? "", to: v });
  };

  const labels = [], lit = [];
  let last = 0, mm;
  PH.lastIndex = 0;
  while ((mm = PH.exec(oldT))) { lit.push(oldT.slice(last, mm.index)); labels.push(mm[1]); last = mm.index + mm[0].length; }
  lit.push(oldT.slice(last));
  if (labels.length) {
    const r = new RegExp("^" + lit.map(esc).join("(.*?)") + "$", "s").exec(newT);
    if (r) labels.forEach((l, i) => push(byLabel.get(l), r[i + 1] || ""));
    return out;
  }

  // filled value: find the changed token and match it to a stored value
  const a = oldT, b = newT;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  let os = i, oe = a.length - j, ns = i, ne = b.length - j;
  while (os > 0 && !/\s/.test(a[os - 1])) { os--; ns--; }
  while (oe < a.length && !/\s/.test(a[oe])) { oe++; ne++; }
  const strip = (t) => t.replace(/^[(\[]+|[.,;:)\]]+$/g, "");
  const oldTok = strip(a.slice(os, oe));
  const newTok = strip(b.slice(ns, ne));
  if (!oldTok || !newTok) return out;
  for (const f of fields) {
    let v = String(data[f.id] ?? "").trim();
    if (!v || v.length > 40) continue;
    if (f.type === "date") {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (d) v = `${d[3]}-${d[2]}-${d[1]}`;
    }
    if (v === oldTok) { push(f, newTok); break; }
  }
  return out;
}

export default function SectionPdfEditor({
  section, sections, schema, data, setData, csrf, buildForm, reportSig,
  onBack, onNext, fieldsPanel, imageApi, onUndoChange, onRedoChange, canUndoChange, canRedoChange,
}) {
  const [docId, setDocId] = useState("");
  const [info, setInfo] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [version, setVersion] = useState(0);
  const [sectionPages, setSectionPages] = useState({});
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.35);
  const [autoFit, setAutoFit] = useState(true); /* page follows the available width (e.g. when the sidebar collapses) until the user zooms manually */
  const [tool, setTool] = useState("select");
  const [ocr, setOcr] = useState(null); /* null = closed, else { languages, available, lang, force, text, loading } */
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState(null);
  const [dlg, setDlg] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); /* { x, y, p, page } - right-click tools menu */
  const [subDlg, setSubDlg] = useState(null);
  const [log, setLog] = useState([]);
  const [drag, setDrag] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [dockW, setDockW] = useState(700);

  const docRef = useRef("");
  const taskRef = useRef(null);
  const seqRef = useRef(0);
  const buildAbortRef = useRef(null);
  const disposedRef = useRef(false);
  const overlayRef = useRef(null);
  const scrollRef = useRef(null);
  const thumbsRef = useRef(null);
  const blobRef = useRef(null); /* the latest built report PDF, kept so click-to-edit can open it as an editable document */
  const fitAuto = useRef(false); /* the page opens at 210%; the fit button turns auto-fit on */
  const fitRef = useRef(null);
  const csrfRef = useRef(csrf);
  csrfRef.current = csrf;
  const [imgDlg, setImgDlg] = useState(null); /* { id, title } - "add a title" prompt after an image is added */
  const addRef = useRef(null);
  const replaceRef = useRef(null);
  const pickTarget = useRef(null);
  const focusImage = useRef(null);
  const [sel, setSel] = useState(null); /* { kind: "img" | "txt" | "tbl", id } */
  const [live, setLive] = useState(null); /* { key, x, top, w, h } while dragging / resizing (PDF points, top-left origin) */
  const [pending, setPending] = useState({}); /* key -> rect already saved but not yet in the rebuilt PDF */
  const layerRef = useRef(null);
  const [aiFor, setAiFor] = useState(null); /* image id whose AI suggestion list is open */
  const [aiAnchor, setAiAnchor] = useState(null); /* DOMRect of the sparkle button, used to position the glass panel */
  const [aiSuggestions, setAiSuggestions] = useState({}); /* image id -> local, unapproved AI review */
  const gesture = useRef(null);
  const commitSeq = useRef(0); /* numbers every saved move so a finished rebuild only clears what it already contains */
  const [ghosts, setGhosts] = useState({}); /* `${version}:${imageId}` -> snapshot of the image, shown instantly while the PDF rebuilds */
  const [cell, setCell] = useState(null); /* { id, r, c } - the table cell being typed in */
  const cellDraft = useRef(null); /* { id, r, c, value } - text typed in the active cell, saved on blur / Tab / Enter */
  const [removed, setRemoved] = useState({}); /* deleted tables: white cover over the old PDF until the rebuild finishes */
  const [rebuildTick, setRebuildTick] = useState(0);

  const notify = useCallback((text, kind = "info") => setToast({ text, kind }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const resolve = (p) => (p.startsWith("/api/") ? p : `/api/pdf/${docRef.current}${p}`);
  const get = (p) => api(resolve(p), { csrf: csrfRef.current });
  const post = (p, body) => {
    const form = body instanceof FormData;
    return api(resolve(p), { csrf: csrfRef.current, method: "POST", body: form ? undefined : body, form: form ? body : undefined });
  };
  /* Reads the text under a click. If the preview document isn't editable on the server, open the same PDF as an editable
     document once and retry, so click-to-enter-value keeps working. */
  const textHit = async (payload) => {
    try {
      return await post("/text/hit", payload);
    } catch (e) {
      if (![404, 405, 410].includes(e?.status) || !blobRef.current) throw e;
      const f = new FormData();
      f.append("file", new File([blobRef.current], "Report.pdf", { type: "application/pdf" }));
      const d = await api("/api/pdf/open", { csrf: csrfRef.current, method: "POST", form: f });
      docRef.current = d.info.doc_id;
      return post("/text/hit", payload);
    }
  };

  /* Opening a PDF and showing it are separate steps so a rebuild that has been superseded can be thrown away
     before it touches the screen (otherwise a slow, older build could overwrite a newer one). */
  const openPdf = useCallback(async (id) => {
    const r = await fetch(`/api/pdf/${id}/file`, { credentials: "include", cache: "no-store" });
    if (!r.ok) throw new Error("The PDF could not be loaded.");
    const buf = await r.arrayBuffer();
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({ data: new Uint8Array(buf), cMapUrl: "/cmaps/", cMapPacked: true, standardFontDataUrl: "/standard_fonts/" });
    const proxy = await task.promise;
    return { task, proxy };
  }, []);
  const showPdf = useCallback(({ task, proxy }) => {
    const prev = taskRef.current;
    taskRef.current = task;
    setPdf(proxy);
    Promise.resolve(prev?.destroy?.()).catch(() => { /* already gone */ });
  }, []);
  const loadPdf = useCallback(async (id) => { showPdf(await openPdf(id)); }, [openPdf, showPdf]);

  /* build the working PDF from the report data */
  const rebuild = useCallback(async () => {
    const seq = ++seqRef.current;
    const upto = commitSeq.current;
    buildAbortRef.current?.abort();
    const controller = new AbortController();
    buildAbortRef.current = controller;
    setBusy("Applying changes…");
    try {
      const res = await fetch("/api/generate", { method: "POST", headers: { "X-CSRF-Token": csrfRef.current }, body: buildForm(), credentials: "include", cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error("The report could not be built.");
      let sp = {};
      try { sp = JSON.parse(decodeURIComponent(res.headers.get("X-Section-Pages") || "{}")); } catch { /* none */ }
      const blob = await res.blob();
      blobRef.current = blob;
      if (seq !== seqRef.current) return;
      const previewForm = (id = "") => {
        const form = new FormData();
        form.append("file", new File([blob], "Report.pdf", { type: "application/pdf" }));
        form.append("revision", String(seq));
        if (id) form.append("doc_id", id);
        return form;
      };
      let d;
      try {
        d = await api("/api/pdf/preview", { csrf: csrfRef.current, method: "POST", form: previewForm(docRef.current) });
      } catch (error) {
        if (!docRef.current || error?.status !== 404) throw error;
        docRef.current = "";
        d = await api("/api/pdf/preview", { csrf: csrfRef.current, method: "POST", form: previewForm() });
      }
      docRef.current = d.info.doc_id;
      if (disposedRef.current) {
        fetch(`/api/pdf/preview/${d.info.doc_id}`, {
          method: "DELETE",
          headers: { "X-CSRF-Token": csrfRef.current },
          credentials: "include",
          keepalive: true,
        }).catch(() => { /* server expiry is the fallback */ });
        return;
      }
      setDocId(d.info.doc_id);
      setInfo(d.info);
      if (seq !== seqRef.current) return;
      const loaded = await openPdf(d.info.doc_id);
      if (seq !== seqRef.current) { /* a newer rebuild started while this PDF was loading: drop this one */
        Promise.resolve(loaded.task.destroy?.()).catch(() => { /* ignore */ });
        return;
      }
      showPdf(loaded);
      setSectionPages(sp);
      setVersion((v) => v + 1);
      setTimeout(() => setPending((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v.n > upto))), 350);
    } catch (e) {
      if (e?.name === "AbortError") return;
      setPending({});
      notify(e.message || "Something went wrong.", "error");
    } finally {
      if (buildAbortRef.current === controller) buildAbortRef.current = null;
      if (seq === seqRef.current) setBusy("");
    }
  }, [buildForm, openPdf, showPdf, notify]);

  const first = useRef(true);
  useEffect(() => {
    const t = setTimeout(rebuild, first.current ? 0 : 500);
    first.current = false;
    return () => clearTimeout(t);
  }, [reportSig]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Table edits ask for a rebuild directly, so the PDF is refreshed even when `reportSig` does not track `tbl__` keys. */
  const rebuildRef = useRef(rebuild);
  rebuildRef.current = rebuild;
  const requestRebuild = () => setRebuildTick((n) => n + 1);
  useEffect(() => {
    if (!rebuildTick) return undefined;
    const t = setTimeout(() => rebuildRef.current(), 400);
    return () => clearTimeout(t);
  }, [rebuildTick]);
  useEffect(() => { setRemoved({}); }, [version]);

  useEffect(() => {
    disposedRef.current = false;
    const removePreview = () => {
      const id = docRef.current;
      if (!id) return;
      fetch(`/api/pdf/preview/${id}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrfRef.current },
        credentials: "include",
        keepalive: true,
      }).catch(() => { /* the one-hour server expiry is the fallback */ });
    };
    window.addEventListener("beforeunload", removePreview);
    return () => {
      disposedRef.current = true;
      buildAbortRef.current?.abort();
      Promise.resolve(taskRef.current?.destroy?.()).catch(() => { /* already gone */ });
      window.removeEventListener("beforeunload", removePreview);
      removePreview();
    };
  }, []);

  /* section page range */
  const startOf = sectionPages[section?.id];
  const pageCount = info?.page_count || 0;
  const endOf = (() => {
    if (!startOf) return pageCount;
    const nx = Object.values(sectionPages).filter((p) => typeof p === "number" && p > startOf).sort((a, b) => a - b)[0];
    return nx ? nx - 1 : pageCount;
  })();
  const sectionStartPage = startOf || 1;
  const sectionEndPage = endOf || Math.max(1, pageCount);
  const sectionPageCount = Math.max(1, sectionEndPage - sectionStartPage + 1);
  const sectionPageNumber = Math.min(sectionPageCount, Math.max(1, page - sectionStartPage + 1));
  const hasPreviousPage = page > sectionStartPage;
  const hasNextPage = page < sectionEndPage;
  useEffect(() => { if (startOf) setPage(startOf); }, [section?.id, startOf]);

  const imageBoxes = sectionPages.__images || {}; /* { [imageId]: { page, x, y, w, h, filled } } in PDF points */
  useEffect(() => {
    const id = focusImage.current;
    const box = id ? sectionPages.__images?.[id] : null;
    if (box) { setPage(box.page); focusImage.current = null; }
  }, [sectionPages]);

  /* snapshot the selected image from the rendered page so moving / resizing can show it instantly */
  useEffect(() => {
    if (!pdf || !sel || sel.kind !== "img") return undefined;
    const box = imageBoxes[sel.id];
    if (!box || !box.filled) return undefined;
    const key = `${version}:${sel.id}`;
    if (ghosts[key]) return undefined;
    let dead = false;
    (async () => {
      try {
        const pg = await pdf.getPage(box.page);
        const base = pg.getViewport({ scale: 1 });
        const sc = Math.min(3, Math.sqrt(6e6 / (base.width * base.height)));
        const vp = pg.getViewport({ scale: sc });
        const full = document.createElement("canvas");
        full.width = Math.ceil(vp.width); full.height = Math.ceil(vp.height);
        await pg.render({ canvasContext: full.getContext("2d"), viewport: vp }).promise;
        const k = vp.width / base.width;
        const top = base.height - (box.y + box.h);
        const out = document.createElement("canvas");
        out.width = Math.max(1, Math.round(box.w * k)); out.height = Math.max(1, Math.round(box.h * k));
        out.getContext("2d").drawImage(full, box.x * k, top * k, box.w * k, box.h * k, 0, 0, out.width, out.height);
        const url = out.toDataURL("image/png");
        if (!dead) setGhosts((g) => ({ ...Object.fromEntries(Object.entries(g).filter(([kk]) => kk.startsWith(`${version}:`))), [key]: url }));
      } catch { /* the outline alone still works */ }
    })();
    return () => { dead = true; };
  }, [pdf, sel, version, sectionPages]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tool !== "select") setSel(null); }, [tool]);
  useEffect(() => { if (aiFor && !(sel?.kind === "img" && sel.id === aiFor)) setAiFor(null); }, [sel, aiFor]);
  /* leaving a table (clicking elsewhere) saves the cell being typed in and closes the editor */
  useEffect(() => {
    if (cell && !(sel?.kind === "tbl" && sel.id === cell.id)) { flushCell(); setCell(null); }
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const sectionOfPage = (p) => {
    const entries = Object.entries(sectionPages).filter(([, v]) => typeof v === "number" && v <= p).sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] || section?.id;
  };

  /* session mutate (tools / unlinked edits) */
  const mutate = useCallback(async (path, body, method = "POST") => {
    const form = body instanceof FormData;
    const d = await api(resolve(path), { csrf: csrfRef.current, method, body: form ? undefined : body, form: form ? body : undefined });
    if (d?.info) {
      setInfo(d.info);
      await loadPdf(docRef.current);
      setVersion((v) => v + 1);
    }
    return d;
  }, [loadPdf]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (label, fn) => {
    setBusy(label);
    try { return await fn(); } catch (e) { notify(e?.message || "Something went wrong.", "error"); return null; } finally { setBusy(""); }
  }, [notify]);

  const undo = () => {
    if (canUndoChange) { onUndoChange?.(); notify("Reverted the last report change.", "info"); return; }
    return run("Undoing…", () => mutate("/undo", {}));
  };
  const redo = () => {
    if (canRedoChange) { onRedoChange?.(); notify("Restored the report change.", "info"); return; }
    return run("Redoing…", () => mutate("/redo", {}));
  };

  useEffect(() => {
    const h = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || "")) return;
      const k = e.key.toLowerCase();
      if (k === "escape") { setSel(null); return; }
      if (sel && tool === "select" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (k.startsWith("arrow")) {
          const r = rectOf(sel.kind, sel.id);
          if (r && r.filled) {
            e.preventDefault();
            const st = e.shiftKey ? 10 : 1;
            commitRect(sel.kind, sel.id, r, clampRect({ ...r, x: r.x + (k === "arrowleft" ? -st : k === "arrowright" ? st : 0), top: r.top + (k === "arrowup" ? -st : k === "arrowdown" ? st : 0) }));
          }
          return;
        }
        if (sel.kind === "txt" && (k === "delete" || k === "backspace")) { e.preventDefault(); removeText(sel.id); return; }
        if (sel.kind === "tbl" && (k === "delete" || k === "backspace")) { e.preventDefault(); removeTable(sel.id); return; }
      }
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === "v") setTool("select");
      else if (k === "t") setTool("edit-text");
      else if (k === "a") setTool("textbox");
      else if (k === "g") setTool("table");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- canvas interaction ---- */
  const point = (e) => {
    const r = overlayRef.current.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };

  const openContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!overlayRef.current) return;
    setContextMenu({
      x: clamp(event.clientX, 8, window.innerWidth - 232),
      y: clamp(event.clientY, 8, window.innerHeight - 230),
      p: point(event),
      page,
    });
  };
  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeOutside = (event) => { if (!event.target?.closest?.("[data-pdf-context-menu]")) setContextMenu(null); };
    const closeOnEscape = (event) => { if (event.key === "Escape") setContextMenu(null); };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOutside, true);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOutside, true);
    };
  }, [contextMenu]);
  const menuEditText = async ({ p, page: targetPage }) => {
    setTool("edit-text");
    const d = await run("Reading text…", () => textHit({ page: targetPage, x: p.x, y: p.y }));
    if (!d) return;
    if (!d.hit) { notify("No editable text there. Use Add text for a new box.", "error"); return; }
    setDlg({ mode: "edit", ...d.hit, original: d.hit.text });
  };
  const menuAddText = ({ p, page: targetPage }) => {
    const height = info?.pages?.[targetPage - 1]?.height || PAGE_H;
    setTool("textbox");
    setDlg({ mode: "tb", id: null, page: targetPage, top: p.y * height, text: "", size: "", bold: false, italic: false });
  };
  const menuAddTable = ({ p, page: targetPage }) => {
    const width = info?.pages?.[targetPage - 1]?.width || PAGE_W;
    const height = info?.pages?.[targetPage - 1]?.height || PAGE_H;
    const x = clamp(p.x * width, 0, Math.max(0, width - 140));
    setTool("table");
    setDlg({ mode: "tbl", id: null, page: targetPage, top: p.y * height, x, w: Math.min(width - x - 20, Math.max(140, width * 0.6)), h: 60, rows: 3, cols: 4, headerRow: true, title: "" });
  };

  const openPlaceholderValue = async (p) => {
    const d = await run("Reading value…", () => textHit({ page, x: p.x, y: p.y }));
    if (!d?.hit) {
      notify("Click directly on the grey [ value ] text to enter it.", "error");
      return false;
    }
    const hitText = d?.hit?.placeholder_text || d?.hit?.text;
    const owner = sections.find((x) => x.id === sectionOfPage(d.hit.page));
    const field =
      (owner && fieldForPlaceholder(hitText, owner)) ||
      fieldForPlaceholder(hitText, section) ||
      sections.map((x) => fieldForPlaceholder(hitText, x)).find(Boolean) ||
      fieldForPlaceholder(hitText, { fields: schema.general });
    if (!field) {
      notify("That text is not a section input. Click a grey value in this section.", "error");
      return false;
    }
    setDlg({
      mode: "field",
      field,
      page: d.hit.page,
      value: data[field.id] ?? field.default ?? "",
    });
    return true;
  };
  const down = async (e) => {
    if (e.button !== 0) return;
    if (busy) { notify("Still applying your last change. Try again in a moment.", "info"); return; }
    const p = point(e);
    if (tool === "select") {
      await openPlaceholderValue(p);
      return;
    }
    if (tool === "edit-text") {
      const d = await run("Reading text…", () => textHit({ page, x: p.x, y: p.y }));
      if (!d) return;
      if (!d.hit) { notify("No editable text there. Use Add text for a new box.", "error"); return; }
      setDlg({ mode: "edit", ...d.hit, original: d.hit.text });
      return;
    }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setDrag({ start: p, end: p });
  };
  const move = (e) => { if (drag) setDrag({ ...drag, end: point(e) }); };
  const up = (e) => {
    if (!drag) return;
    const end = point(e), s = drag.start;
    setDrag(null);
    const rect = { x: Math.min(s.x, end.x), y: Math.min(s.y, end.y), w: Math.abs(s.x - end.x), h: Math.abs(s.y - end.y) };
    const hh = info?.pages?.[page - 1]?.height || PAGE_H;
    if (tool === "table") {
      if (rect.w * pw < 40 || rect.h * ph < 40) { setDrag(null); notify("Draw a larger rectangle for the table.", "error"); return; }
      setDlg({ mode: "tbl", id: null, page, top: rect.y * hh, x: rect.x * pw, w: rect.w * pw, h: rect.h * ph, rows: 3, cols: 4, headerRow: true, title: "" });
      setDrag(null);
      return;
    }
    setDlg({ mode: "tb", id: null, page, top: rect.y * hh, text: "", size: "", bold: false, italic: false });
  };

  /* ---- save the text dialog ---- */
  const applyDialog = async () => {
    if (!dlg) return;
    if (dlg.mode === "field") {
      const field = dlg.field;
      const value = String(dlg.value ?? "").trim();
      if (!value) { notify(`Enter a value for ${field.label}.`, "error"); return; }
      if (field.type === "number" && Number.isNaN(Number(value))) {
        notify(`${field.label} must be a number.`, "error");
        return;
      }
      const from = data[field.id] ?? field.default ?? "";
      setData((current) => ({ ...current, [field.id]: value }));
      setLog((entries) => [{ id: field.id, label: field.label, from, to: value, at: Date.now() }, ...entries]);
      setDlg(null);
      notify(`Saved ${field.label}. The preview and dependent calculations are updating.`, "success");
      return;
    }
    if (dlg.mode === "tb") {
      if (!dlg.text.trim()) { notify("Type the text first.", "error"); return; }
      const id = dlg.id || `tb${Date.now().toString(36)}`;
      const prev = dlg.id ? readTb(data[`txt__${dlg.id}`]) : null;
      const startPage = sectionPages[sectionOfPage(dlg.page)];
      const box = {
        ...(prev || {}), sec: sectionOfPage(dlg.page), rel: typeof startPage === "number" ? dlg.page - startPage : null, page: dlg.page,
        top: prev ? prev.top : r1(dlg.top), x: prev ? prev.x : null, w: prev ? prev.w : null,
        text: dlg.text, size: dlg.size ? Number(dlg.size) : null, bold: !!dlg.bold, italic: !!dlg.italic,
      };
      setData((c) => ({ ...c, [`txt__${id}`]: JSON.stringify(box) }));
      setSel({ kind: "txt", id });
      setTool("select");
      setDlg(null);
      if (!dlg.id) notify("Text added with the report's body font and margins. Drag it to move; use the toolbar beside it to align.", "info");
      return;
    }
    if (dlg.mode === "tbl") {
      const rows = clamp(Math.round(Number(dlg.rows)) || 3, 1, 50);
      const cols = clamp(Math.round(Number(dlg.cols)) || 4, 1, 20);
      const id = `tbl${Date.now().toString(36)}`;
      const startPage = sectionPages[sectionOfPage(dlg.page)];
      const box = {
        sec: sectionOfPage(dlg.page), rel: typeof startPage === "number" ? dlg.page - startPage : null, page: dlg.page,
        top: r1(dlg.top), x: r1(dlg.x), w: r1(dlg.w), h: r1(rows * TABLE_ROW_PT),
        rows, cols, headerRow: !!dlg.headerRow,
        cellText: Array.from({ length: rows }, () => new Array(cols).fill("")),
        title: String(dlg.title || "").trim(),
        style: { ...TABLE_STYLE },
      };
      setData((c) => ({ ...c, [`tbl__${id}`]: JSON.stringify(box) }));
      setSel({ kind: "tbl", id });
      setCell({ id, r: 0, c: 0 });
      setTool("select");
      setDlg(null);
      requestRebuild();
      notify("Table added. Type in any cell; Tab moves to the next cell and adds a row after the last one.", "info");
      return;
    }
    if (dlg.mode === "tbset") {
      const cur = readTb(data[`tbl__${dlg.id}`]);
      if (!cur) { setDlg(null); notify("Table not found.", "error"); return; }
      const rows = clamp(Math.round(Number(dlg.rows)) || 1, 1, 50);
      const cols = clamp(Math.round(Number(dlg.cols)) || 1, 1, 20);
      updateTable(dlg.id, (t) => ({
        ...t, rows, cols, headerRow: !!dlg.headerRow, title: String(dlg.title || "").trim(),
        cellText: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => t.cellText[r]?.[c] ?? "")),
        h: clamp((t.h * rows) / t.rows, 20, Math.max(20, ph - t.top)),
      }));
      touchTable(dlg.id);
      setDlg(null);
      notify("Table updated.", "success");
      return;
    }
    const changes = mapEdit(dlg.original, dlg.text, sectionOfPage(dlg.page), schema, data);
    if (changes.length) {
      setData((cur) => {
        const next = { ...cur };
        changes.forEach((c) => { next[c.id] = c.to; });
        return next;
      });
      setLog((l) => [...changes.map((c) => ({ ...c, at: Date.now() })), ...l]);
      notify(`Saved to ${changes.map((c) => c.label).join(", ")} and applied everywhere it is used.`, "success");
      setDlg(null);
      return;
    }
    const ok = await run("Updating text…", () => mutate("/text/edit", {
      page: dlg.page, rect: dlg.rect, text: dlg.text, font_size: Number(dlg.size) || 11,
      color: dlg.color || "#111111", font: dlg.font || "Helvetica", bold: !!dlg.bold, italic: !!dlg.italic,
    }));
    if (ok) {
      setDlg(null);
      notify("Edited in the working PDF only. This text isn't linked to a field, so a rebuild will restore it.", "info");
    }
  };

  const revert = (entry) => {
    setData((cur) => ({ ...cur, [entry.id]: entry.from }));
    setLog((l) => l.filter((x) => x !== entry));
  };

  const search = async () => {
    if (!searchQuery.trim() || !docRef.current) return;
    setSearchBusy(true);
    try {
      const d = await get(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchResults(d?.results || []);
      if (d?.results?.length) setPage(d.results[0].page);
      else notify("No matches found.", "error");
    } catch (e) { notify(e.message, "error"); } finally { setSearchBusy(false); }
  };

    /* ---- images: add from the toolbar, replace / edit / remove from the floating controls ---- */
  const onAddFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !imageApi) return;
    const id = imageApi.add(file);
    focusImage.current = id;
    setImgDlg({ id, title: "" });
  };
  const onReplaceFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file && pickTarget.current && imageApi) {
      clearAiSuggestion(pickTarget.current);
      imageApi.replace(pickTarget.current, file);
    }
  };
  const saveImageTitle = () => {
    const title = imgDlg?.title.trim();
    if (title) setData((cur) => ({ ...cur, [`cap__${imgDlg.id}`]: title }));
    setImgDlg(null);
  };
  const pageImages = Object.entries(imageBoxes).filter(([, b]) => b && b.page === page);
  const textRects = sectionPages.__texts || {}; /* { [id]: { page, x, top, w, h, align } } in PDF points, top-left origin */
  const pageTexts = Object.entries(textRects).filter(([, t]) => t && t.page === page);
  const tableRects = sectionPages.__tables || {}; /* { [id]: { page, x, top, w, h, rows, cols, headerRow, cellText } } as drawn in the PDF, top-left origin */
  /* A table exists while its `tbl__<id>` data exists, so deleting the data removes it straight away. */
  const storedTables = Object.keys(data || {})
    .filter((k) => k.startsWith("tbl__"))
    .map((k) => [k.slice(5), readTb(data[k])])
    .filter(([, t]) => t);
  const pageTables = storedTables.filter(([id, t]) => (tableRects[id]?.page ?? t.page) === page);
  const pw = info?.pages?.[page - 1]?.width || PAGE_W;
  const ph = info?.pages?.[page - 1]?.height || PAGE_H;

  /* one rect shape for both kinds: { page, x, top, w, h, filled } */
  const baseRect = (kind, id) => {
    if (kind === "img") {
      const b = imageBoxes[id];
      return b ? { page: b.page, x: b.x, top: ph - (b.y + b.h), w: b.w, h: b.h, filled: !!b.filled } : null;
    }
    if (kind === "tbl") {
      const stored = readTb(data[`tbl__${id}`]);
      const drawn = tableRects[id];
      const g = stored && Number.isFinite(Number(stored.x)) && Number.isFinite(Number(stored.top)) ? stored : drawn;
      return g ? { page: drawn?.page ?? stored?.page, x: Number(g.x), top: Number(g.top), w: Number(g.w), h: Number(g.h), filled: true } : null;
    }
    const t = textRects[id];
    return t ? { page: t.page, x: t.x, top: t.top, w: t.w, h: t.h, filled: true } : null;
  };
  /* where the item currently sits in the PDF image itself (used to white-out the old position while a rebuild runs) */
  const drawnRect = (kind, id) => {
    if (kind === "tbl") {
      const t = tableRects[id];
      return t ? { x: t.x, top: t.top, w: t.w, h: t.h } : null;
    }
    return baseRect(kind, id);
  };
  const rectOf = (kind, id) => {
    const key = `${kind}:${id}`;
    const b = baseRect(kind, id);
    if (!b) return null;
    if (live?.key === key) return { ...b, x: live.x, top: live.top, w: live.w, h: live.h };
    if (pending[key]) return { ...b, ...pending[key] };
    return b;
  };
  const clampRect = (r) => ({ ...r, x: clamp(r.x, 0, Math.max(0, pw - r.w)), top: clamp(r.top, 0, Math.max(0, ph - r.h)) });

  /* save a move / resize. Images: offsets + scale from the flowed position. Text: absolute position. The PDF is then rebuilt. */
  function commitRect(kind, id, from, to) {
    const dx = to.x - from.x, dy = to.top - from.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(to.w - from.w) < 0.5 && Math.abs(to.h - from.h) < 0.5) return;
    if (kind === "img") {
      const f = from.w > 0 ? to.w / from.w : 1;
      setData((c) => ({
        ...c,
        [`img_dx__${id}`]: r1((Number(c[`img_dx__${id}`]) || 0) + dx),
        [`img_dy__${id}`]: r1((Number(c[`img_dy__${id}`]) || 0) + dy),
        [`img_scale__${id}`]: Math.round((Number(c[`img_scale__${id}`]) || 1) * f * 10000) / 10000,
      }));
    } else if (kind === "tbl") {
      setData((c) => {
        const t = readTb(c[`tbl__${id}`]);
        if (!t) return c;
        return { ...c, [`tbl__${id}`]: JSON.stringify({ ...t, x: r1(to.x), top: r1(to.top), w: r1(to.w), h: r1(to.h) }) };
      });
      requestRebuild();
    } else {
      setData((c) => {
        const t = readTb(c[`txt__${id}`]);
        return t ? { ...c, [`txt__${id}`]: JSON.stringify({ ...t, x: r1(to.x), top: r1(to.top), w: r1(to.w) }) } : c;
      });
    }
    setPending((p) => ({ ...p, [`${kind}:${id}`]: { ...(p[`${kind}:${id}`] || {}), x: to.x, top: to.top, w: to.w, h: to.h, n: ++commitSeq.current } }));
  }
  function removeText(id) {
    setData((c) => { const n = { ...c }; delete n[`txt__${id}`]; return n; });
    setSel(null);
  }

  /* ---- tables: Word-style editing ---- */
  function removeTable(id) {
    const t = tableRects[id];
    if (t) setRemoved((m) => ({ ...m, [id]: { page: t.page, x: t.x, top: t.top, w: t.w, h: t.h } }));
    cellDraft.current = null;
    setData((c) => { const n = { ...c }; delete n[`tbl__${id}`]; return n; });
    setPending((p) => { const n = { ...p }; delete n[`tbl:${id}`]; return n; });
    setCell(null);
    setSel(null);
    requestRebuild();
  }
  /* change a table's stored data (fn gets the normalised table and returns the new one, or null for no change) */
  const updateTable = (id, fn) => {
    setData((c) => {
      const raw = readTb(c[`tbl__${id}`]);
      if (!raw) return c;
      const next = fn(normTbl(raw));
      if (!next) return c;
      return { ...c, [`tbl__${id}`]: JSON.stringify(next) };
    });
    requestRebuild();
  };
  /* mark a table as changed so its old PDF position is covered until the rebuilt PDF arrives */
  const touchTable = (id) => {
    const n = ++commitSeq.current;
    setPending((p) => ({ ...p, [`tbl:${id}`]: { ...(p[`tbl:${id}`] || {}), n } }));
  };
  /* save the text typed in the active cell */
  const flushCell = () => {
    const d = cellDraft.current;
    cellDraft.current = null;
    if (!d) return;
    const cur = readTb(data[`tbl__${d.id}`]);
    if (!cur) return;
    if (String(normTbl(cur).cellText[d.r]?.[d.c] ?? "") === d.value) return;
    updateTable(d.id, (t) => {
      const ct = t.cellText.map((row) => [...row]);
      if (ct[d.r] && d.c < t.cols) ct[d.r][d.c] = d.value;
      return { ...t, cellText: ct };
    });
    touchTable(d.id);
  };
  const activateCell = (id, r, c) => {
    if (cell && cell.id === id && cell.r === r && cell.c === c) return;
    flushCell();
    setCell({ id, r, c });
  };
  /* Tab / Shift+Tab: next / previous cell; Tab in the last cell adds a row, like Word */
  const navCell = (id, r, c, dir) => {
    flushCell();
    const cur = readTb(data[`tbl__${id}`]);
    if (!cur) return;
    const t = normTbl(cur);
    let i = r * t.cols + c + dir;
    if (i < 0) i = 0;
    if (i >= t.rows * t.cols) {
      updateTable(id, (tt) => {
        const ct = tt.cellText.map((row) => [...row]);
        ct.push(new Array(tt.cols).fill(""));
        return { ...tt, rows: tt.rows + 1, cellText: ct, h: Math.min(tt.h + tt.h / tt.rows, Math.max(20, ph - tt.top)) };
      });
      touchTable(id);
    }
    setCell({ id, r: Math.floor(i / t.cols), c: i % t.cols });
  };
  const onTblKey = (e, id, r, c) => {
    if (e.key === "Tab") { e.preventDefault(); navCell(id, r, c, e.shiftKey ? -1 : 1); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); flushCell(); setCell(null); }
    else if (e.key === "Escape") { e.preventDefault(); cellDraft.current = null; setCell(null); }
  };
  /* click on a table: select it and put the cursor in the clicked cell */
  const tblPointerDown = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSel({ kind: "tbl", id });
    const t = normTbl(readTb(data[`tbl__${id}`]) || {});
    const bb = e.currentTarget.getBoundingClientRect();
    const c = clamp(Math.floor(((e.clientX - bb.left) / bb.width) * t.cols), 0, t.cols - 1);
    const r = clamp(Math.floor(((e.clientY - bb.top) / bb.height) * t.rows), 0, t.rows - 1);
    activateCell(id, r, c);
  };
  /* row / column commands from the table toolbar, applied at the active cell (or the last row / column) */
  const tblOp = (id, op) => {
    const cur = readTb(data[`tbl__${id}`]);
    if (!cur) return;
    const n = normTbl(cur);
    const a = cell && cell.id === id ? cell : null;
    const r = a ? a.r : n.rows - 1, c = a ? a.c : n.cols - 1;
    if (op === "delRow" && n.rows <= 1) { notify("A table needs at least one row. Use the bin to delete the whole table.", "error"); return; }
    if (op === "delCol" && n.cols <= 1) { notify("A table needs at least one column. Use the bin to delete the whole table.", "error"); return; }
    updateTable(id, (t) => {
      const rowH = t.h / t.rows, colW = t.w / t.cols;
      const ct = t.cellText.map((row) => [...row]);
      if (op === "addRow") { ct.splice(r + 1, 0, new Array(t.cols).fill("")); return { ...t, rows: t.rows + 1, cellText: ct, h: Math.min(t.h + rowH, Math.max(20, ph - t.top)) }; }
      if (op === "addCol") { ct.forEach((row) => row.splice(c + 1, 0, "")); return { ...t, cols: t.cols + 1, cellText: ct, w: Math.min(t.w + colW, Math.max(40, pw - t.x)) }; }
      if (op === "delRow") { ct.splice(r, 1); return { ...t, rows: t.rows - 1, cellText: ct, h: Math.max(20, t.h - rowH) }; }
      if (op === "delCol") { ct.forEach((row) => row.splice(c, 1)); return { ...t, cols: t.cols - 1, cellText: ct, w: Math.max(40, t.w - colW) }; }
      return null;
    });
    touchTable(id);
    if (a) {
      if (op === "addRow") setCell({ id, r: r + 1, c });
      else if (op === "addCol") setCell({ id, r, c: c + 1 });
      else if (op === "delRow") setCell({ id, r: Math.min(r, n.rows - 2), c });
      else setCell({ id, r, c: Math.min(c, n.cols - 2) });
    }
  };
  const setTextAlign = (id, align) => {
    setData((c) => {
      const t = readTb(c[`txt__${id}`]);
      return t ? { ...c, [`txt__${id}`]: JSON.stringify({ ...t, align }) } : c;
    });
    const r = rectOf("txt", id);
    if (r) setPending((p) => ({ ...p, [`txt:${id}`]: { x: r.x, top: r.top, w: r.w, h: r.h, align, n: ++commitSeq.current } }));
  };
  const editText = (id) => {
    const t = readTb(data[`txt__${id}`]);
    if (t) setDlg({ mode: "tb", id, page: textRects[id]?.page || t.page, text: t.text || "", size: t.size || "", bold: !!t.bold, italic: !!t.italic });
  };
  /* table settings: heading, rows, columns, header row (existing cell text is kept) */
  const editTable = (id) => {
    const stored = readTb(data[`tbl__${id}`]);
    if (!stored) { notify("Could not find this table's data.", "error"); return; }
    const t = normTbl(stored);
    setDlg({ mode: "tbset", id, page: t.page, title: t.title || "", rows: t.rows, cols: t.cols, headerRow: !!t.headerRow });
  };
  const clearAiSuggestion = (id) => setAiSuggestions((current) => {
    const next = { ...current };
    delete next[id];
    return next;
  });
  const requestAiSuggestion = async (id) => {
    const image = imageApi.getFile?.(id);
    if (!image) {
      setAiSuggestions((current) => ({ ...current, [id]: { status: "error", error: "The original image is unavailable. Replace or upload it before requesting suggestions." } }));
      return;
    }
    setAiSuggestions((current) => ({ ...current, [id]: { status: "loading", result: current[id]?.result || null, error: "" } }));
    try {
      const form = new FormData();
      form.append("image", image, image.name || `${id}.png`);
      form.append("report_id", reportId || "");
      form.append("section_id", section?.id || "");
      form.append("image_id", id);
      form.append("section_context", JSON.stringify({ section_title: section?.title || "", caption: data[`cap__${id}`] || "", fields: (section?.fields || []).map((field) => field.label) }));
      const result = await api("/api/ai/suggestions", { csrf: csrfRef.current, method: "POST", form });
      setAiSuggestions((current) => ({ ...current, [id]: { status: "ready", result, error: "" } }));
    } catch (error) {
      setAiSuggestions((current) => ({ ...current, [id]: { status: "error", result: current[id]?.result || null, error: error?.message || "AI suggestions could not be generated." } }));
    }
  };
  const approveAiSuggestion = (id, approved) => {
    const caption = String(approved.caption || "").trim();
    const narrative = [String(approved.description || "").trim(), ...(approved.observations || [])].filter(Boolean).join("\n");
    const currentCaption = String(data[`cap__${id}`] || "").trim();
    const bodyKey = `body__${section?.id || ""}`;
    const currentBody = String(data[bodyKey] || "").trim();
    if (caption && currentCaption && currentCaption !== caption && !window.confirm("Replace the current image caption with the approved AI caption?")) return;
    if (narrative && currentBody && !currentBody.includes(narrative) && !window.confirm("Append the approved AI description to this section's existing narrative?")) return;
    setData((current) => ({
      ...current,
      ...(caption ? { [`cap__${id}`]: caption, [`cap_style__${id}`]: "inherit" } : {}),
      ...(narrative && !String(current[bodyKey] || "").includes(narrative) ? { [bodyKey]: [String(current[bodyKey] || "").trim(), narrative].filter(Boolean).join("\n\n") } : {}),
    }));
    setAiFor(null);
    notify("Approved AI text was inserted. Review all extracted values before issuing the report.", "success");
  };
  const removeImage = (id) => {
    setSel(null);
    clearAiSuggestion(id);
    setData((c) => { const n = { ...c }; delete n[`img_dx__${id}`]; delete n[`img_dy__${id}`]; delete n[`img_scale__${id}`]; return n; });
    imageApi.remove(id);
  };

  /* aspect-locked corner resize; the opposite corner stays fixed */
  const resizeRect = (f, corner, rx, ry) => {
    const sx = corner.includes("e") ? 1 : -1, sy = corner.includes("s") ? 1 : -1;
    const ratio = f.h / f.w;
    const availW = sx > 0 ? pw - f.x : f.x + f.w;
    const availH = sy > 0 ? ph - f.top : f.top + f.h;
    const w = clamp(((f.w + sx * rx) + (f.h + sy * ry) / ratio) / 2, 20, Math.max(20, Math.min(availW, availH / ratio)));
    const h = w * ratio;
    return { ...f, w, h, x: sx > 0 ? f.x : f.x + f.w - w, top: sy > 0 ? f.top : f.top + f.h - h };
  };
  /* tables resize freely (width and height separately) */
  const resizeFree = (f, corner, rx, ry) => {
    const sx = corner.includes("e") ? 1 : -1, sy = corner.includes("s") ? 1 : -1;
    const availW = sx > 0 ? pw - f.x : f.x + f.w;
    const availH = sy > 0 ? ph - f.top : f.top + f.h;
    const w = clamp(f.w + sx * rx, 40, Math.max(40, availW));
    const h = clamp(f.h + sy * ry, 20, Math.max(20, availH));
    return { ...f, w, h, x: sx > 0 ? f.x : f.x + f.w - w, top: sy > 0 ? f.top : f.top + f.h - h };
  };

  const startGesture = (e, mode, kind, id, corner) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSel({ kind, id });
    const from = rectOf(kind, id);
    if (busy || !from || !from.filled || !layerRef.current) return;
    const lr = layerRef.current.getBoundingClientRect();
    gesture.current = { mode, kind, id, corner, x0: e.clientX, y0: e.clientY, k: pw / lr.width, from, last: from, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const moveGesture = (e) => {
    const g = gesture.current;
    if (!g) return;
    const rx = (e.clientX - g.x0) * g.k, ry = (e.clientY - g.y0) * g.k;
    if (!g.moved && Math.hypot(rx, ry) / g.k < 4) return; /* a plain click only selects */
    g.moved = true;
    g.last = g.mode === "move"
      ? clampRect({ ...g.from, x: g.from.x + rx, top: g.from.top + ry })
      : (g.kind === "tbl" ? resizeFree : resizeRect)(g.from, g.corner, rx, ry);
    setLive({ key: `${g.kind}:${g.id}`, x: g.last.x, top: g.last.top, w: g.last.w, h: g.last.h });
  };
  const endGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    setLive(null);
    if (g?.moved) commitRect(g.kind, g.id, g.from, g.last);
  };
  const layerItems = [...pageImages.map(([id]) => ["img", id]), ...pageTexts.map(([id]) => ["txt", id]), ...pageTables.map(([id]) => ["tbl", id])];
  const pxPerPt = (layerRef.current?.clientWidth || pw * zoom) / pw;
  const FONT_CSS = { he: "Helvetica, Arial, sans-serif", ti: "'Times New Roman', Times, serif", co: "'Courier New', monospace" };
  const fb = "grid h-8 w-8 place-items-center rounded-full border shadow-lg transition";
  const tbBtn = "h-7 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold text-[#d7e9ec] hover:bg-white/10";

  const langCode = (l) => (typeof l === "string" ? l : l?.code ?? l?.id ?? "");
  const langName = (l) => (typeof l === "string" ? l : l?.name ?? l?.label ?? langCode(l));
  const openOcr = async () => {
    if (ocr) { setOcr(null); return; }
    if (!docRef.current) return;
    setOcr({ languages: [], available: true, lang: "eng", force: false, text: null, loading: false });
    try {
      const d = await get("/ocr/languages");
      const languages = d?.languages || [];
      const codes = languages.map(langCode);
      setOcr((o) => o && ({ ...o, languages, available: d?.available !== false, lang: codes.includes("eng") ? "eng" : codes[0] || "eng" }));
    } catch (e) { notify(e.message || "Could not load OCR languages.", "error"); }
  };
  const runOcr = async () => {
    if (!ocr) return;
    setOcr((o) => ({ ...o, loading: true }));
    const d = await run("Running OCR…", () => mutate("/ocr", { language: ocr.lang, force: ocr.force, pages: "all" }));
    const text = (d?.result?.text || []).map((t) => `--- Page ${t.page} ---\n${t.text}`).join("\n\n");
    setOcr((o) => o && ({ ...o, loading: false, text: d ? (text || "No text was recognised.") : o.text }));
    if (d) notify("OCR finished.", "success");
  };

  const idx = sections.findIndex((x) => x.id === section?.id);
  const pageSection = sections.find((x) => x.id === sectionOfPage(page)) || section;

  const analysisNumber = sections.filter((item) => item.dynamicAnalysis).findIndex((item) => item.id === pageSection?.id) + 1;
  const subsectionKey = `subsections__${pageSection?.id || ""}`;
  const saveSubsection = () => {
    const title = String(subDlg?.title || "").trim();
    if (!title) { notify("Enter a subsection title.", "error"); return; }
    setData((current) => ({
      ...current,
      [subsectionKey]: JSON.stringify([...readSubsections(current[subsectionKey]), { title, body: String(subDlg?.body || "").trim() }]),
    }));
    setSubDlg(null);
    notify(`Added subsection 5.${analysisNumber}.${readSubsections(data[subsectionKey]).length + 1}.`, "success");
  };
  const removeSubsection = (i) => setData((c) => ({
  ...c,
  [subsectionKey]: JSON.stringify(readSubsections(c[subsectionKey]).filter((_, k) => k !== i)),
}));
  /* Scrolling past the top / bottom edge of a page moves to the previous / next page of this section.
     Scrolling up from a section's first page goes to the previous section.
     The NEXT section is never opened by scrolling - only by the "Next section" button. */
  const wheelAcc = useRef(0);
  const wheelLock = useRef(0);
  const scrollAfterNav = useRef(null);
  const onCanvasWheel = (e) => {
    if (e.ctrlKey || e.metaKey || busy || dlg || subDlg || imgDlg || aiFor) return;
    const el = scrollRef.current;
    if (!el || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    const now = Date.now();
    if (now < wheelLock.current) return;
    const up = e.deltaY < 0;
    const atTop = el.scrollTop <= 1;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if (!((up && atTop) || (!up && atBottom))) { wheelAcc.current = 0; return; }
    wheelAcc.current += e.deltaY;
    if (Math.abs(wheelAcc.current) < 80) return; /* needs a deliberate scroll, not a trackpad flick */
    wheelAcc.current = 0;
    if (up) {
      if (hasPreviousPage) { scrollAfterNav.current = "bottom"; wheelLock.current = now + 700; setPage((p) => p - 1); }
      else if (idx > 0) { wheelLock.current = now + 900; onBack(); }
    } else if (hasNextPage) {
      scrollAfterNav.current = "top"; wheelLock.current = now + 700; setPage((p) => p + 1);
    }
  };
  useEffect(() => {
    const where = scrollAfterNav.current;
    if (!where) return undefined;
    scrollAfterNav.current = null;
    const t = setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = where === "bottom" ? el.scrollHeight : 0;
    }, 60);
    return () => clearTimeout(t);
  }, [page]);

  const hits = searchResults.filter((r) => r.page === page);
  const dragRect = drag && {
    left: `${Math.min(drag.start.x, drag.end.x) * 100}%`, top: `${Math.min(drag.start.y, drag.end.y) * 100}%`,
    width: `${Math.abs(drag.start.x - drag.end.x) * 100}%`, height: `${Math.abs(drag.start.y - drag.end.y) * 100}%`,
  };

  const fit = () => {
    const el = scrollRef.current;
    const pg = info?.pages?.[page - 1];
    if (!el || !pg) return;
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const zw = (el.clientWidth - padX) / pg.width;
    const zh = (el.clientHeight - padY) / pg.height;
    const next = clamp(Math.min(zw, zh) * 0.99, 0.3, 3.5);
    setZoom((z) => (Math.abs(z - next) < 0.005 ? z : next));
  };
  fitRef.current = fit;
  const zoomBy = (fn) => { fitAuto.current = false; setZoom(fn); };
  const fitNow = () => { fitAuto.current = true; fit(); };

  useEffect(() => { if (fitAuto.current) fitRef.current?.(); }, [info, page, pdf]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (fitAuto.current) fitRef.current?.(); });
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [pdf]);
  useEffect(() => {
    thumbsRef.current?.querySelector(`[data-thumb="${page}"]`)?.scrollIntoView({ block: "nearest" });
  }, [page, info]);
  const ob = "grid h-8 w-8 place-items-center rounded-md text-[#c9dfe3] hover:bg-white/10 disabled:opacity-30";
  const navBtn = "pointer-events-auto grid h-14 w-14 place-items-center rounded-full border border-[#0b2a41] bg-[#16415f] text-[#bccbd9] shadow-lg shadow-black/30 transition hover:bg-[#1c4f72] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f84f63]";
  const isTableDlg = !!dlg && (dlg.mode === "tbl" || dlg.mode === "tbset");

  return (
    <div className="studio-root flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[#234b63] bg-[#071f35]">
      {/* options bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#234b63] bg-[#081f35] px-3 py-2">
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-semibold text-white">{section?.title}</p>
        </div>
        {pageSection?.dynamicAnalysis ? <button type="button" onClick={() => setSubDlg({ title: "", body: "" })} className="rounded-md border border-[#2f5b75] px-2.5 py-1.5 text-[11px] font-semibold text-[#c9dfe3] hover:border-[#f84f63] hover:bg-white/5">+ Add subsection {`5.${analysisNumber}.${readSubsections(data[subsectionKey]).length + 1}`}</button> : null}
        <span className="whitespace-nowrap px-1 text-[11px] font-semibold text-[#d7e9ec] tabular-nums">
          Page {sectionPageNumber} of {sectionPageCount}
        </span>
        <span className="h-5 w-px bg-[#234b63]" />
        <button type="button" className={ob} onClick={() => { fitAuto.current = false; setZoom((z) => clamp(z - 0.15, 0.3, 3.5)); }} aria-label="Zoom out"><Icon name="zoomOut" /></button>
        <button type="button" className="min-w-[44px] text-[11px] font-semibold text-[#d7e9ec]" onClick={() => { fitAuto.current = false; setZoom(1); }} title="Reset to 100%">{Math.round(zoom * 100)}%</button>
        <button type="button" className={ob} onClick={() => { fitAuto.current = false; setZoom((z) => clamp(z + 0.15, 0.3, 3.5)); }} aria-label="Zoom in"><Icon name="zoomIn" /></button>
        <button type="button" className={ob} onClick={() => { fitAuto.current = true; fit(); }} aria-label="Fit page to screen" title="Fit page to screen"><Icon name="fit" /></button>
        <span className="h-5 w-px bg-[#234b63]" />
        <button type="button" className={ob} onClick={undo} disabled={(!canUndoChange && !info?.can_undo) || !!busy} aria-label="Undo last change" title="Undo last change"><Icon name="undo" /></button>
        <button type="button" className={ob} onClick={redo} disabled={(!canRedoChange && !info?.can_redo) || !!busy} aria-label="Redo last change" title="Redo last change"><Icon name="redo" /></button>
        <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Find in PDF" className="h-8 w-36 rounded-md border border-[#2d5871] bg-[#103a55] px-2 text-xs text-white outline-none focus:border-[#f84f63]" />
        {docId ? <a href={downloadUrl(docId)} download className="rounded-md border border-[#f84f63] bg-[#f84f63] px-3 py-1.5 text-xs font-bold text-[#081f35] hover:bg-[#ff6377]">Download</a> : null}
        <span className="h-5 w-px bg-[#234b63]" />
        <div className="relative">
          <button type="button" onClick={openOcr} disabled={!info || !!busy} aria-expanded={!!ocr} title="Recognise text in scanned pages (OCR)"
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold disabled:opacity-30 ${ocr ? "bg-white/10 text-white" : "text-[#c9dfe3] hover:bg-white/10"}`}>
            <Icon name="text" className="h-4 w-4" /> OCR
          </button>
          {ocr ? (
            <div className="absolute right-0 top-full z-[80] mt-2 w-[340px] rounded-xl border border-[#2f5b75] bg-[#0e3250] p-3 text-white shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8faebb]">OCR</p>
                <button type="button" onClick={() => setOcr(null)} aria-label="Close OCR" className="grid h-6 w-6 place-items-center rounded-full text-base text-[#c9dfe3] hover:bg-white/10">×</button>
              </div>
              {!ocr.available ? <p className="mb-2 rounded-lg border border-[#f84f63]/50 bg-[#3a1620] p-2 text-[11px] text-[#ffd5da]">OCR is not installed on the server.</p> : null}
              <label className="block"><span className={LABEL}>Language</span>
                <select className={INPUT} value={ocr.lang} onChange={(e) => setOcr({ ...ocr, lang: e.target.value })}>
                  {ocr.languages.length ? ocr.languages.map((l) => <option key={langCode(l)} value={langCode(l)}>{langName(l)}</option>) : <option value="eng">English</option>}
                </select>
              </label>
              <label className="mt-2 flex items-center gap-2 text-[11px] text-[#c9dfe3]">
                <input type="checkbox" className="accent-[#f84f63]" checked={ocr.force} onChange={(e) => setOcr({ ...ocr, force: e.target.checked })} />
                Re-run on pages that already have text
              </label>
              <Btn size="sm" variant="primary" className="mt-3 w-full" onClick={runOcr} disabled={!ocr.available || ocr.loading || !!busy}>{ocr.loading ? "Recognising…" : "Run OCR on all pages"}</Btn>
              {ocr.text ? (
                <>
                  <textarea readOnly className={`${INPUT} mt-3 h-40 resize-y text-[11px]`} value={ocr.text} />
                  <button type="button" onClick={() => navigator.clipboard?.writeText(ocr.text)} className="mt-1.5 text-[10px] font-bold uppercase text-[#f84f63] hover:underline">Copy text</button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* left toolbar */}
        <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-r border-[#234b63] bg-[#081f35] py-2">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}
              className={`grid h-9 w-9 place-items-center rounded-lg border transition ${tool === t.id ? "border-[#f84f63] bg-[#f84f63] text-[#081f35]" : "border-transparent text-[#c9dfe3] hover:bg-white/10"}`}>
              <Icon name={t.icon} className="h-[18px] w-[18px]" />
            </button>
          ))}
          {imageApi ? (
            <>
              <span className="my-1 h-px w-6 bg-[#234b63]" />
              <button type="button" title="Add image" aria-label="Add image" onClick={() => addRef.current?.click()}
                className="grid h-9 w-9 place-items-center rounded-lg border border-transparent text-[#c9dfe3] transition hover:bg-white/10">
                <ImagePlusIcon />
              </button>
              <input ref={addRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={onAddFile} />
              <input ref={replaceRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={onReplaceFile} />
            </>
          ) : null}
        </div>

        {/* page thumbnails */}
        {pdf && info ? (
          <aside style={{ flex: "0 0 130px", width: 130, minWidth: 130, maxWidth: 130 }}
            className="hidden flex-col border-r border-[#234b63] bg-[#071f35] lg:flex">
            <div ref={thumbsRef} className="studio-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
              {info.pages.map((p) => {
                const sc = 90 / Math.max(1, p.width);
                return (
                  <LazyThumb key={p.number} pdf={pdf} number={p.number} scale={sc} height={p.height * sc} version={version}
                    active={p.number === page} onClick={() => setPage(p.number)} />
                );
              })}
            </div>
          </aside>
        ) : null}       

        {/* canvas */}
        <div ref={scrollRef} onPointerDown={(e) => { if (!e.target.closest?.("[data-img-ui]")) setSel(null); }} className="studio-scroll relative min-w-0 flex-1 overflow-auto bg-[#061a2c] p-6">
          {/* section navigation, floating at the top corners of the page area */}
          <div className="sticky top-0 z-[60] h-0">
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between">
              <button type="button" onClick={onBack} className={navBtn} aria-label="Previous section" title="Previous section">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
              </button>
              <button type="button" onClick={onNext} className={navBtn} aria-label="Next section" title="Next section">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>          
          {!pdf ? (
            <p className="mt-24 text-center text-sm text-[#7f9dab]">{busy || "Preparing the editor…"}</p>
          ) : (
            <div className="mx-auto w-fit" onContextMenu={openContextMenu}>
              <PageSurface pdf={pdf} pageNumber={clamp(page, 1, pageCount || 1)} scale={zoom} tool={tool} version={version}>
                <div ref={overlayRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
                  className={`absolute inset-0 z-20 touch-none ${tool === "select" ? "cursor-pointer" : tool === "edit-text" ? "cursor-text" : "cursor-crosshair"}`}>
                  {hits.map((h, i) => (
                    <div key={i} className="pointer-events-none absolute border border-[#ffd54a] bg-[#ffd54a]/30"
                      style={{ left: `${h.rect.x * 100}%`, top: `${h.rect.y * 100}%`, width: `${h.rect.w * 100}%`, height: `${h.rect.h * 100}%` }} />
                  ))}
                  {dragRect ? <div className="pointer-events-none absolute border-2 border-dashed border-[#f84f63] bg-[#f84f63]/15" style={dragRect} /> : null}
                </div>

                {/* selection, move / resize handles and the controls that float next to the selected item */}
                {imageApi ? (
                  <div ref={layerRef} className="pointer-events-none absolute inset-0 z-[50]">
                    {/* deleted tables: hide the old PDF drawing until the rebuilt PDF arrives */}
                    {Object.entries(removed).filter(([, b]) => b.page === page).map(([id, b]) => (
                      <div key={`removed-${id}`} className="absolute bg-white"
                        style={{ left: `${((b.x - 1) / pw) * 100}%`, top: `${((b.top - 1) / ph) * 100}%`, width: `${((b.w + 2) / pw) * 100}%`, height: `${((b.h + 2) / ph) * 100}%` }} />
                    ))}
                    {layerItems.map(([kind, id]) => {
                      const key = `${kind}:${id}`;
                      const b = live?.key === key || pending[key] ? drawnRect(kind, id) : null;
                      return b ? (
                        <div key={`cover-${key}`} className="absolute bg-white"
                          style={{ left: `${((b.x - 1) / pw) * 100}%`, top: `${((b.top - 1) / ph) * 100}%`, width: `${((b.w + 2) / pw) * 100}%`, height: `${((b.h + 2) / ph) * 100}%` }} />
                      ) : null;
                    })}
                    {layerItems.map(([kind, id]) => {
                      const r = rectOf(kind, id);
                      if (!r) return null;
                      const key = `${kind}:${id}`;
                      const selected = sel?.kind === kind && sel.id === id && tool === "select";
                      const isLive = live?.key === key;
                      const left = (r.x / pw) * 100, top = (r.top / ph) * 100, wPct = (r.w / pw) * 100, hPct = (r.h / ph) * 100;
                      const isImg = kind === "img";
                      const isTbl = kind === "tbl";
                      const td = isTbl ? normTbl(readTb(data[`tbl__${id}`]) || {}) : null;
                      let tbPos;
                      if (isImg) {
                        const roomRight = r.x + r.w <= pw - 44, roomLeft = r.x >= 44;
                        tbPos = roomRight ? { left: `calc(${left + wPct}% + 8px)`, top: `${top}%` }
                          : roomLeft ? { right: `calc(${100 - left}% + 8px)`, top: `${top}%` }
                          : { left: `calc(${left + wPct}% - 40px)`, top: `calc(${top}% + 8px)` };
                      } else {
                        tbPos = r.top >= 76 ? { left: `${left}%`, top: `calc(${top}% - 68px)` } : { left: `${left}%`, top: `calc(${top + hPct}% + 8px)` };
                      }
                      const tx = !isImg && !isTbl ? textRects[id] : null;
                      const cursor = isTbl ? "cursor-text" : r.filled ? (isLive ? "cursor-grabbing" : "cursor-move") : "cursor-pointer";
                      return (
                        <div key={key}>
                          <div data-img-ui
                            onPointerDown={(e) => (isTbl ? tblPointerDown(e, id) : startGesture(e, "move", kind, id))} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture}
                            title={isTbl ? "Click a cell to type. Drag the square at the top-left to move the table." : r.filled ? "Click to select, drag to move" : "Click to select"}
                            className={`absolute ${isTbl ? "" : "touch-none"} ${tool === "select" ? "pointer-events-auto" : "pointer-events-none"} ${cursor} ${selected ? "" : "hover:outline hover:outline-1 hover:outline-[#2f80ff]/70"}`}
                            style={{
                              left: `${left}%`, top: `${top}%`, width: `${wPct}%`, height: `${hPct}%`,
                              ...(selected ? { outline: "2px solid #2f80ff", outlineOffset: 0, background: isTbl ? undefined : "rgba(47,128,255,0.08)" } : null),
                            }}>
                            {isImg && (isLive || pending[key]) && ghosts[`${version}:${id}`] ? (
                              <img src={ghosts[`${version}:${id}`]} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none" />
                            ) : null}
                            {tx && (isLive || pending[key]) ? (
                              <div className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap bg-white"
                                style={{
                                  fontFamily: FONT_CSS[tx.family] || FONT_CSS.he, fontSize: `${tx.size * pxPerPt}px`, lineHeight: `${tx.lead * pxPerPt}px`,
                                  fontWeight: tx.bold ? 700 : 400, fontStyle: tx.italic ? "italic" : "normal", color: tx.color,
                                  textAlign: pending[key]?.align || tx.align,
                                }}>
                                {readTb(data[`txt__${id}`])?.text}
                              </div>
                            ) : null}
                            {isTbl && td && (selected || isLive || pending[key]) ? (
                              <TableOverlay t={td} pxPerPt={pxPerPt} rowPx={(r.h / td.rows) * pxPerPt}
                                active={cell && cell.id === id ? cell : null}
                                onDraft={(rr, cc, v) => { cellDraft.current = { id, r: rr, c: cc, value: v }; }}
                                onBlurCell={flushCell}
                                onKeyCell={(e, rr, cc) => onTblKey(e, id, rr, cc)} />
                            ) : null}
                            {selected && isTbl && r.filled ? (
                              <span data-img-ui title="Drag to move the table" aria-label="Move table"
                                onPointerDown={(e) => startGesture(e, "move", kind, id)} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture}
                                className="absolute grid h-5 w-5 cursor-move touch-none place-items-center rounded-[3px] border border-[#2f80ff] bg-white text-[#2f80ff] shadow"
                                style={r.x >= 30 ? { left: -26, top: 0 } : { left: 0, top: -24 }}>
                                <MoveIcon className="h-3.5 w-3.5" />
                              </span>
                            ) : null}
                            {selected && (isImg || isTbl) && r.filled ? ["nw", "ne", "sw", "se"].map((c) => (
                              <span key={c} data-img-ui
                                onPointerDown={(e) => startGesture(e, "resize", kind, id, c)} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture}
                                className={`absolute h-2.5 w-2.5 touch-none rounded-[2px] border-2 border-[#2f80ff] bg-white ${c === "nw" || c === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize"}`}
                                style={{ left: c.includes("w") ? 0 : "100%", top: c.includes("n") ? 0 : "100%", transform: "translate(-50%, -50%)" }} />
                            )) : null}
                          </div>
                          {selected && !isLive ? (
                            <div data-img-ui className={`pointer-events-auto absolute flex gap-1.5 ${isImg ? "flex-col" : "flex-row items-center rounded-full border border-[#2d5871] bg-[#0c2b44]/95 p-1 shadow-lg"}`} style={tbPos}>
                              {isImg ? (
                                <>
                                  {r.filled ? (
                                    <button type="button" title="Edit image" aria-label="Edit image" onClick={() => imageApi.edit(id)}
                                      className={`${fb} border-[#f84f63] bg-[#f84f63] text-[#081f35] hover:bg-[#ff6377]`}><PencilIcon className="h-4 w-4" /></button>
                                  ) : null}
                                  <button type="button" title={r.filled ? "Replace image" : "Upload image"} aria-label={r.filled ? "Replace image" : "Upload image"}
                                    onClick={() => { pickTarget.current = id; replaceRef.current?.click(); }}
                                    className={`${fb} border-[#2d5871] bg-[#0c2b44]/95 text-[#d7e9ec] hover:border-[#f84f63]`}>
                                    {r.filled ? <SwapIcon className="h-4 w-4" /> : <ImagePlusIcon className="h-4 w-4" />}
                                  </button>
                                  {r.filled ? (
                                    <button type="button" title="Remove image" aria-label="Remove image" onClick={() => removeImage(id)}
                                      className={`${fb} border-[#2d5871] bg-[#0c2b44]/95 text-[#ff9da9] hover:border-[#ff8e9c] hover:bg-[#ff8e9c]/20`}><TrashIcon className="h-4 w-4" /></button>
                                  ) : null}
                                  {r.filled ? (
                                    <button type="button" title="AI suggestions" aria-label="AI suggestions" aria-expanded={aiFor === id}
                                      onClick={(e) => {
                                        if (aiFor === id) { setAiFor(null); return; }
                                        setAiAnchor(e.currentTarget.getBoundingClientRect());
                                        setAiFor(id);
                                        if (!aiSuggestions[id]?.result && aiSuggestions[id]?.status !== "loading") requestAiSuggestion(id);
                                      }}
                                      className={`${fb} ${aiFor === id ? "border-[#8ec5ff] bg-[#1d4a78] text-white" : "border-[#2d5871] bg-[#0c2b44]/95 text-[#d7e9ec] hover:border-[#8ec5ff]"}`}><SparkleIcon className="h-4 w-4" /></button>
                                  ) : null}
                                </>
                              ) : isTbl ? (
                                <>
                                  {[["addRow", "+ Row", "Insert a row below the current cell"], ["addCol", "+ Col", "Insert a column to the right of the current cell"],
                                    ["delRow", "− Row", "Delete the current row"], ["delCol", "− Col", "Delete the current column"]].map(([op, label, tip]) => (
                                    <button key={op} type="button" title={tip} aria-label={tip}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => { e.stopPropagation(); tblOp(id, op); }}
                                      className={tbBtn}>{label}</button>
                                  ))}
                                  <span className="mx-0.5 h-4 w-px bg-[#2d5871]" />
                                  <button type="button" title="Table settings (heading, rows, columns)" aria-label="Table settings"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => { e.stopPropagation(); editTable(id); }}
                                    className="grid h-7 w-7 place-items-center rounded-full text-[#d7e9ec] hover:bg-white/10"><PencilIcon className="h-4 w-4" /></button>
                                  <button type="button" title="Delete table" aria-label="Delete table"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => { e.stopPropagation(); removeTable(id); }}
                                    className="grid h-7 w-7 place-items-center rounded-full text-[#ff9da9] hover:bg-[#ff8e9c]/20"><TrashIcon className="h-4 w-4" /></button>
                                </>
                              ) : (
                                <>
                                  {ALIGNS.map(([a, label]) => (
                                    <button key={a} type="button" title={label} aria-label={label} aria-pressed={(pending[key]?.align || tx?.align) === a} onClick={() => setTextAlign(id, a)}
                                      className={`grid h-7 w-7 place-items-center rounded-full transition ${(pending[key]?.align || tx?.align) === a ? "bg-[#2f80ff] text-white" : "text-[#d7e9ec] hover:bg-white/10"}`}><AlignIcon kind={a} className="h-4 w-4" /></button>
                                  ))}
                                  <span className="mx-0.5 h-4 w-px bg-[#2d5871]" />
                                  <button type="button" title="Edit text" aria-label="Edit text" onClick={() => editText(id)}
                                    className="grid h-7 w-7 place-items-center rounded-full text-[#d7e9ec] hover:bg-white/10"><PencilIcon className="h-4 w-4" /></button>
                                  <button type="button" title="Delete text" aria-label="Delete text" onClick={() => removeText(id)}
                                    className="grid h-7 w-7 place-items-center rounded-full text-[#ff9da9] hover:bg-[#ff8e9c]/20"><TrashIcon className="h-4 w-4" /></button>
                                </>
                              )}
                            </div>
                          ) : null}
                          {selected && !isLive && isImg && aiFor === id ? <AiSuggestions
                            anchor={aiAnchor}
                            result={aiSuggestions[id]?.result}
                            status={aiSuggestions[id]?.status}
                            error={aiSuggestions[id]?.error}
                            onRegenerate={() => requestAiSuggestion(id)}
                            onDiscard={() => { clearAiSuggestion(id); setAiFor(null); }}
                            onApprove={(approved) => approveAiSuggestion(id, approved)}
                            onClose={() => setAiFor(null)}
                          /> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </PageSurface>
            </div>
          )}
          {busy && pdf ? (
            <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2 rounded-full border border-[#2d5871] bg-[#081f35]/95 px-3 py-1.5 text-[11px] font-semibold text-[#d7e9ec]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#f84f63]" />{busy}
            </div>
          ) : null}
        </div>

        {/* right dock */}
        {/* right panel: Fields */}
        {/* right panel: Fields */}
        <aside style={{ flex: `0 0 ${dockW}px`, width: dockW, minWidth: 340 }}
          className="relative hidden flex-col border-l border-[#234b63] bg-[#081f35] lg:flex">
          <div
            title="Drag to resize"
            className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none hover:bg-[#f84f63]/40"
            onPointerDown={(e) => {
              e.preventDefault();
              const startX = e.clientX, startW = dockW;
              const mv = (ev) => setDockW(clamp(startW + (startX - ev.clientX), 340, 1000));
              const upH = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", upH); };
              window.addEventListener("pointermove", mv);
              window.addEventListener("pointerup", upH);
            }} />
          <div className="flex shrink-0 items-center justify-between border-b border-[#234b63] px-4 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-white">Fields</span>
            {log.length ? <span className="rounded-full bg-[#f84f63]/15 px-2 py-0.5 text-[10px] font-bold text-[#ff9da9]">{log.length} linked edit{log.length > 1 ? "s" : ""}</span> : null}
          </div>
          <div className="studio-scroll min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-3">
            {fieldsPanel}
            <div>
              {pageSection?.dynamicAnalysis && readSubsections(data[subsectionKey]).length ? (
                  <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#8faebb]">Subsections</p>
                  <ul className="space-y-1.5">
                    {readSubsections(data[subsectionKey]).map((s, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-[#2d5871] bg-[#103a55] px-2.5 py-1.5 text-[11px] text-[#c9dfe3]">
                        <span className="truncate">5.{analysisNumber}.{i + 1} {s.title}</span>
                        <button type="button" onClick={() => removeSubsection(i)} aria-label="Delete subsection" className="text-[#ff9da9] hover:text-white">×</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#8faebb]">Linked edits from the PDF</p>
              {log.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[#2d5871] p-3 text-center text-xs leading-5 text-[#8faebb]">
                  Click a grey [ placeholder ] directly in the PDF, enter its value, then press Enter. It is saved to the linked variable and reused everywhere.
                </p>
              ) : (
                <ul className="space-y-2">
                  {log.map((c, i) => (
                    <li key={i} className="rounded-lg border border-[#2d5871] bg-[#103a55] p-2.5 text-[11px] text-[#c9dfe3]">
                      <p className="font-semibold text-white">{c.label}</p>
                      <p className="mt-0.5 text-[#8faebb]">{String(c.from) || "(empty)"} → <b className="text-[#8ed0c9]">{c.to}</b></p>
                      <button type="button" onClick={() => revert(c)} className="mt-1.5 text-[10px] font-bold uppercase text-[#f84f63] hover:underline">Revert</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* image title prompt */}
      {imgDlg ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#03121f]/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#2d5871] bg-[#0c2b44] p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">Add a title for this image</h3>
            <p className="mt-1 text-[11px] leading-4 text-[#8faebb]">The title is placed directly below the image with a 20px margin.</p>
            <input autoFocus className={`${INPUT} mt-3`} placeholder="e.g. Figure 3 - Von Mises stress plot" value={imgDlg.title}
              onChange={(e) => setImgDlg({ ...imgDlg, title: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") saveImageTitle(); }} />
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setImgDlg(null)}>Skip</Btn>
              <Btn variant="primary" icon="check" onClick={saveImageTitle}>Add title</Btn>
            </div>
          </div>
        </div>
      ) : null}

      {subDlg ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#03121f]/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#2d5871] bg-[#0c2b44] p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">+ Add subsection {`5.${analysisNumber}.${readSubsections(data[subsectionKey]).length + 1}`}</h3>
            <p className="mt-1 text-[11px] leading-4 text-[#8faebb]">This subsection is added under the current Analysis and appears automatically in the Report Index.</p>
            <label className="mt-4 block"><span className={LABEL}>Subsection title</span>
              <input autoFocus className={`${INPUT} mt-1`} value={subDlg.title} onChange={(e) => setSubDlg({ ...subDlg, title: e.target.value })} placeholder="e.g. Load case assumptions" />
            </label>
            <label className="mt-3 block"><span className={LABEL}>Content</span>
              <textarea className={`${INPUT} mt-1 h-32 resize-y`} value={subDlg.body} onChange={(e) => setSubDlg({ ...subDlg, body: e.target.value })} placeholder="Add the subsection text…" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setSubDlg(null)}>Cancel</Btn>
              <Btn variant="primary" icon="check" onClick={saveSubsection}>Add subsection</Btn>
            </div>
          </div>
        </div>
      ) : null}

      {/* text / field / table dialog */}
      {dlg ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#03121f]/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#2d5871] bg-[#0c2b44] p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">
              {dlg.mode === "field" ? `Enter ${dlg.field.label}` : dlg.mode === "tb" ? (dlg.id ? "Edit text" : "Add text") : dlg.mode === "tbl" ? "Add table" : dlg.mode === "tbset" ? "Table settings" : `Edit line on page ${dlg.page}`}
            </h3>
            <p className="mt-1 text-[11px] leading-4 text-[#8faebb]">
              {dlg.mode === "field" ? (dlg.field.type === "textarea" ? `Variable: ${dlg.field.id}. Enter project-specific text, then press Ctrl+Enter or Save to update the preview.` : `Variable: ${dlg.field.id}. Press Enter to save and update the preview.`)
                : dlg.mode === "tb" ? "Uses the same font, size, colour and margins as the report text. Leave size empty to match."
                : isTableDlg ? "Give the table a heading and choose its size. Afterwards click any cell to type in it; Tab moves to the next cell and adds a row after the last one."
                : "Type a value in place of a [ placeholder ] or change a value. It is saved to its field."}
            </p>
            {isTableDlg ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="col-span-2 block"><span className={LABEL}>Table heading</span>
                  <input autoFocus className={`${INPUT} mt-1`} value={dlg.title || ""} placeholder="e.g. Table 1 - Revision history"
                    onChange={(e) => setDlg({ ...dlg, title: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyDialog(); } }} /></label>
                <label className="block"><span className={LABEL}>Rows</span>
                  <input type="number" min={1} max={50} className={INPUT} value={dlg.rows} onChange={(e) => setDlg({ ...dlg, rows: e.target.value })} /></label>
                <label className="block"><span className={LABEL}>Columns</span>
                  <input type="number" min={1} max={20} className={INPUT} value={dlg.cols} onChange={(e) => setDlg({ ...dlg, cols: e.target.value })} /></label>
                <label className="col-span-2 flex items-center gap-2 text-[11px] text-[#c9dfe3]">
                  <input type="checkbox" className="accent-[#f84f63]" checked={!!dlg.headerRow} onChange={(e) => setDlg({ ...dlg, headerRow: e.target.checked })} />Header row (bold, shaded)
                </label>
              </div>
            ) : dlg.mode === "field" ? (
              dlg.field.type === "select" ? (
                <select autoFocus className={`${INPUT} mt-3`} value={dlg.value} onChange={(e) => setDlg({ ...dlg, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyDialog(); } }}>
                  {dlg.field.opts.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : dlg.field.type === "textarea" ? (
                <textarea autoFocus className={`${INPUT} mt-3 h-36 resize-y`} value={dlg.value} onChange={(e) => setDlg({ ...dlg, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyDialog(); } }} />
              ) : (
                <input autoFocus className={`${INPUT} mt-3`} type={dlg.field.type === "number" ? "number" : dlg.field.type === "date" ? "date" : "text"} step={dlg.field.type === "number" ? "any" : undefined}
                  value={dlg.value} onChange={(e) => setDlg({ ...dlg, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyDialog(); } }} />
              )
            ) : <textarea autoFocus className={`${INPUT} mt-3 h-28 resize-none`} value={dlg.text} onChange={(e) => setDlg({ ...dlg, text: e.target.value })} />}
            {dlg.mode !== "field" && !isTableDlg ? <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="block"><span className={LABEL}>Size</span>
                <input type="number" className={INPUT} placeholder={dlg.mode === "tb" ? "Auto" : undefined} value={dlg.size} onChange={(e) => setDlg({ ...dlg, size: e.target.value })} /></label>
              {dlg.mode === "tb" ? <span /> : (
              <label className="block"><span className={LABEL}>Colour</span>
                <input type="color" className="h-9 w-full cursor-pointer rounded-lg border border-[#2d5871] bg-[#103a55] p-1" value={dlg.color || "#111111"} onChange={(e) => setDlg({ ...dlg, color: e.target.value })} /></label>
              )}
              <div className="flex items-end gap-3 pb-2 text-[11px] text-[#c9dfe3]">
                <label className="flex items-center gap-1"><input type="checkbox" className="accent-[#f84f63]" checked={!!dlg.bold} onChange={(e) => setDlg({ ...dlg, bold: e.target.checked })} />Bold</label>
                <label className="flex items-center gap-1"><input type="checkbox" className="accent-[#f84f63]" checked={!!dlg.italic} onChange={(e) => setDlg({ ...dlg, italic: e.target.checked })} />Italic</label>
              </div>
            </div> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setDlg(null)}>Cancel</Btn>
              <Btn variant="primary" icon="check" onClick={applyDialog}>{dlg.mode === "field" ? "Save value" : dlg.mode === "tbl" ? "Create table" : "Apply"}</Btn>
            </div>
          </div>
        </div>
      ) : null}
      
      {contextMenu ? (
        <div data-pdf-context-menu role="menu" aria-label="PDF tools"
          className="fixed z-[150] w-56 overflow-hidden rounded-xl border border-[#2f5b75] bg-[#0e3250] p-1.5 text-white shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}>
          <p className="px-2.5 pb-1 pt-1 text-[9px] font-bold uppercase tracking-wider text-[#8faebb]">PDF tools</p>
          <button type="button" role="menuitem" onClick={() => { setTool("select"); setContextMenu(null); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-[#d7e9ec] hover:bg-[#16415f]">
            <Icon name="cursor" className="h-4 w-4 text-[#8ed0c9]" /><span className="flex-1">Select</span><kbd className="text-[10px] text-[#8faebb]">V</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => { const m = contextMenu; setContextMenu(null); menuEditText(m); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-[#d7e9ec] hover:bg-[#16415f]">
            <Icon name="textCursor" className="h-4 w-4 text-[#8ed0c9]" /><span className="flex-1">Edit text here</span><kbd className="text-[10px] text-[#8faebb]">T</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => { const m = contextMenu; setContextMenu(null); menuAddText(m); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-[#d7e9ec] hover:bg-[#16415f]">
            <Icon name="text" className="h-4 w-4 text-[#8ed0c9]" /><span className="flex-1">Add text here</span><kbd className="text-[10px] text-[#8faebb]">A</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => { const m = contextMenu; setContextMenu(null); menuAddTable(m); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-[#d7e9ec] hover:bg-[#16415f]">
            <Icon name="table" className="h-4 w-4 text-[#8ed0c9]" /><span className="flex-1">Add table here</span><kbd className="text-[10px] text-[#8faebb]">G</kbd>
          </button>
          {imageApi ? (
            <button type="button" role="menuitem" onClick={() => { setContextMenu(null); addRef.current?.click(); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-[#d7e9ec] hover:bg-[#16415f]">
              <ImagePlusIcon className="h-4 w-4 text-[#8ed0c9]" /><span className="flex-1">Add image to section</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <div className={`fixed bottom-4 left-4 z-[140] max-w-[min(92vw,440px)] rounded-xl border px-4 py-3 text-xs shadow-2xl ${toast.kind === "error" ? "border-[#f84f63]/60 bg-[#3a1620] text-[#ffd5da]" : "border-[#3a8f8a]/60 bg-[#0d3739] text-[#d4f5ef]"}`} role="status">
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}
