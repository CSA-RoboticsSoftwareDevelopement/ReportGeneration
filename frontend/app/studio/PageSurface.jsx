"use client";

import { useEffect, useRef, useState } from "react";

const TEXT_TOOLS = new Set(["select", "edit-text", "highlight", "underline", "strikeout", "squiggly"]);

/**
 * Renders one PDF page to a canvas and, when a text-oriented tool is active,
 * an invisible text layer for selection and click-to-edit.
 */
export default function PageSurface({
  pdf,
  pageNumber,
  scale,
  tool = "select",
  version = 0,
  children,
  className = "",
}) {
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const canvasRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    if (!pdf) return undefined;
    let cancelled = false;
    let task = null;
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const cssViewport = page.getViewport({ scale });
        const width = Math.max(1, Math.floor(cssViewport.width));
        const height = Math.max(1, Math.floor(cssViewport.height));
        setDims({ width, height });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        task = page.render({ canvas, viewport, background: "#ffffff" });
        try {
          await task.promise;
        } catch (error) {
          if (error?.name !== "RenderingCancelledException" && error?.name !== "AbortException") {
            console.warn("PDF page render failed", error);
          }
        }
      } catch (error) {
        if (!cancelled) console.warn("PDF page could not be loaded", error);
      }
    })();
    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* already finished */
      }
    };
  }, [pdf, pageNumber, scale, version]);

  useEffect(() => {
    if (!pdf || !TEXT_TOOLS.has(tool) || !dims.width) return undefined;
    let cancelled = false;
    let layer = null;
    const container = textRef.current;
    if (!container) return undefined;
    container.replaceChildren();
    container.style.setProperty("--total-scale-factor", String(scale));
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        layer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport,
        });
        await layer.render();
      } catch (error) {
        if (!cancelled && error?.name !== "AbortException") {
          console.warn("PDF text layer failed", error);
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        layer?.cancel();
      } catch {
        /* already finished */
      }
      container.replaceChildren();
    };
  }, [pdf, pageNumber, scale, tool, dims.width, version]);

  return (
    <div
      className={`relative isolate bg-white shadow-[0_18px_60px_rgba(0,0,0,.45)] ${className}`}
      style={{ width: dims.width || 1, height: dims.height || 1 }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      {TEXT_TOOLS.has(tool) ? (
        <div ref={textRef}
          className={tool === "select" ? "studio-text-layer studio-text-selectable" : "studio-text-layer"}
          aria-hidden="true" />
      ) : null}
      {children}
    </div>
  );
}
