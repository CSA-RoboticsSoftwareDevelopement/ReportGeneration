"use client";

import { useRef, useState } from "react";
import PageSurface from "./PageSurface";
import { Chip, Icon, cls } from "./ui";
import { formatBytes } from "./api";

const DRAW_KINDS = new Set([
  "highlight", "underline", "strikeout", "squiggly", "rect", "ellipse",
  "line", "arrow", "stamp", "freetext", "textbox", "redact",
]);

const CURSORS = {
  select: "cursor-default",
  "edit-text": "cursor-text",
  textbox: "cursor-text",
  note: "cursor-copy",
  ink: "cursor-crosshair",
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));

export default function Stage({
  pdf,
  info,
  version,
  pageNumber,
  setPageNumber,
  zoom,
  setZoom,
  tool,
  setTool,
  tools,
  searchResults,
  onAnnotate,
  onInk,
  onTextHit,
  onComposeText,
  scrollRef,
  busy,
  panelOpen,
  setPanelOpen,
}) {
  const [drag, setDrag] = useState(null);
  const [ink, setInk] = useState(null);
  const overlayRef = useRef(null);
  const current = info.pages[pageNumber - 1] || info.pages[0];
  const hits = searchResults.filter((item) => item.page === pageNumber);
  const quickTools = tools.filter((item) => ["select", "edit-text", "highlight", "ink", "note", "stamp", "redact"].includes(item.id));

  const point = (event) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (tool === "select") return;
    const start = point(event);
    if (tool === "edit-text") {
      onTextHit(start);
      return;
    }
    if (tool === "ink") {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      setInk([start]);
      return;
    }
    if (tool === "note") {
      onComposeText("note", { ...start, w: 0, h: 0 });
      return;
    }
    if (!DRAW_KINDS.has(tool)) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    setDrag({ start, end: start });
  };

  const onPointerMove = (event) => {
    if (ink) {
      setInk((current) => (current ? [...current, point(event)] : current));
      return;
    }
    if (!drag) return;
    const next = point(event);
    setDrag((current) => (current ? { ...current, end: next } : current));
  };

  const onPointerUp = (event) => {
    if (ink) {
      const points = ink;
      setInk(null);
      if (points.length > 1) {
        const sampled = points.filter((_, index) => index % 2 === 0 || index === points.length - 1);
        onInk(sampled);
      }
      return;
    }
    if (!drag) return;
    const end = point(event);
    const start = drag.start;
    const rect = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(start.x - end.x),
      h: Math.abs(start.y - end.y),
    };
    setDrag(null);
    if (rect.w < 0.004 && rect.h < 0.004) return;
    if (tool === "textbox" || tool === "freetext") {
      onComposeText(tool, rect);
      return;
    }
    onAnnotate(tool, tool === "line" || tool === "arrow" ? { ...rect, start, end } : rect);
  };

  const fit = () => {
    const element = scrollRef.current;
    if (!element || !current) return;
    const available = Math.max(220, element.clientWidth - 96);
    setZoom(Math.max(0.3, Math.min(3.5, available / Math.max(1, current.width))));
  };

  const changeZoom = (delta) => setZoom((value) => Math.max(0.3, Math.min(3.5, Math.round((value + delta) * 100) / 100)));

  const dragRect = drag
    ? {
        left: `${Math.min(drag.start.x, drag.end.x) * 100}%`,
        top: `${Math.min(drag.start.y, drag.end.y) * 100}%`,
        width: `${Math.abs(drag.start.x - drag.end.x) * 100}%`,
        height: `${Math.abs(drag.start.y - drag.end.y) * 100}%`,
      }
    : null;

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#071f35]">
      <div className="flex flex-wrap items-center gap-1 border-b border-[#234b63] bg-[#081f35]/95 px-2 py-1.5">
        {quickTools.map((item) => (
          <button key={item.id} type="button" onClick={() => setTool(item.id)} title={item.hint || item.label}
            aria-pressed={tool === item.id}
            className={cls(
              "flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition",
              tool === item.id ? "border-[#f84f63] bg-[#f84f63]/15 text-white" : "border-transparent text-[#a9c5cd] hover:border-[#2d5871] hover:bg-white/5 hover:text-white",
            )}>
            <Icon name={item.icon} className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-[#234b63] sm:block" />
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setPageNumber(Math.max(1, pageNumber - 1))} disabled={pageNumber <= 1}
            className="rounded p-1.5 text-[#a9c5cd] hover:bg-white/10 disabled:opacity-30" aria-label="Previous page">
            <Icon name="chevron" className="h-4 w-4 rotate-90" />
          </button>
          <span className="min-w-[62px] text-center text-[11px] font-semibold text-[#d7e9ec]">{pageNumber} / {info.page_count}</span>
          <button type="button" onClick={() => setPageNumber(Math.min(info.page_count, pageNumber + 1))} disabled={pageNumber >= info.page_count}
            className="rounded p-1.5 text-[#a9c5cd] hover:bg-white/10 disabled:opacity-30" aria-label="Next page">
            <Icon name="chevron" className="h-4 w-4 -rotate-90" />
          </button>
          <span className="mx-1 h-5 w-px bg-[#234b63]" />
          <button type="button" onClick={() => changeZoom(-0.15)} className="rounded p-1.5 text-[#a9c5cd] hover:bg-white/10" aria-label="Zoom out"><Icon name="zoomOut" className="h-4 w-4" /></button>
          <button type="button" onClick={() => setZoom(1)} className="min-w-[42px] rounded px-1 py-1 text-[11px] font-semibold text-[#d7e9ec] hover:bg-white/10" title="Actual size">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => changeZoom(0.15)} className="rounded p-1.5 text-[#a9c5cd] hover:bg-white/10" aria-label="Zoom in"><Icon name="zoomIn" className="h-4 w-4" /></button>
          <button type="button" onClick={fit} className="rounded p-1.5 text-[#a9c5cd] hover:bg-white/10" aria-label="Fit width" title="Fit width"><Icon name="fit" className="h-4 w-4" /></button>
          <button type="button" onClick={() => setPanelOpen(!panelOpen)} className="rounded p-1.5 text-[#a9c5cd] hover:bg-white/10 lg:hidden" aria-label="Toggle tool panel"><Icon name="panel" className="h-4 w-4" /></button>
        </div>
      </div>

      <div ref={scrollRef} className="studio-scroll relative min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex w-fit flex-col items-center gap-3">
          <PageSurface pdf={pdf} pageNumber={pageNumber} scale={zoom} tool={tool} version={version}>
            <div
              ref={overlayRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => { setDrag(null); setInk(null); }}
              className={cls("absolute inset-0 z-20 touch-none", CURSORS[tool] || "cursor-crosshair", tool === "select" && "pointer-events-none")}
            >
              {hits.map((hit, index) => (
                <div key={index} className="pointer-events-none absolute rounded-[2px] border border-[#ffd54a] bg-[#ffd54a]/30"
                  style={{ left: `${hit.rect.x * 100}%`, top: `${hit.rect.y * 100}%`, width: `${Math.max(1, hit.rect.w * 100)}%`, height: `${Math.max(1, hit.rect.h * 100)}%` }} />
              ))}
              {dragRect ? <div className="pointer-events-none absolute rounded-[2px] border-2 border-dashed border-[#f84f63] bg-[#f84f63]/15" style={dragRect} /> : null}
              {ink && ink.length > 1 ? (
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                  <polyline points={ink.map((item) => `${item.x},${item.y}`).join(" ")} fill="none" stroke="#f84f63" strokeWidth="0.004" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
              ) : null}
            </div>
          </PageSurface>

          {current ? (
            <p className="text-[10px] text-[#7f9dab]">
              {Math.round(current.width)} x {Math.round(current.height)} pt
              {current.rotation ? ` - rotated ${current.rotation} degrees` : ""}
            </p>
          ) : null}
        </div>

        {busy ? (
          <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2 rounded-full border border-[#2d5871] bg-[#081f35]/95 px-3 py-1.5 text-[11px] font-semibold text-[#d7e9ec] shadow-xl">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#f84f63]" />
            {busy}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[#234b63] bg-[#081f35] px-3 py-1.5 text-[10px] text-[#8faebb]">
        <span>{info.page_count} pages</span>
        <span className="text-[#2d5871]">|</span>
        <span>{formatBytes(info.file_size)}</span>
        <span className="text-[#2d5871]">|</span>
        <span>{info.annotations.length} annotations</span>
        {info.is_form ? <><span className="text-[#2d5871]">|</span><Chip tone="teal">Form</Chip></> : null}
        {info.protected ? <><span className="text-[#2d5871]">|</span><Chip tone="coral">Protected copy</Chip></> : null}
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <Icon name="info" className="h-3 w-3" />
          {tool === "select" ? "Text is selectable" : "Click or drag on the page"}
        </span>
      </div>
    </main>
  );
}
