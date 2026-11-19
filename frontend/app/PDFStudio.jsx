"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, csrfToken, currentUser, downloadUrl } from "./studio/api";
import { Btn, Chip, Icon, INPUT, LABEL, cls } from "./studio/ui";
import Landing from "./studio/Landing";
import ThumbsRail from "./studio/ThumbsRail";
import Stage from "./studio/Stage";
import MarkupPanel from "./studio/MarkupPanel";
import PagesPanel from "./studio/PagesPanel";
import EditPanel from "./studio/EditPanel";
import FormsPanel from "./studio/FormsPanel";
import ToolsPanel from "./studio/ToolsPanel";
import AskPanel from "./studio/AskPanel";

const TOOLS = [
  { id: "select", label: "Select", icon: "cursor", hint: "Select and scroll. Text stays selectable." },
  { id: "edit-text", label: "Edit text", icon: "textCursor", hint: "Click a line of text to rewrite it." },
  { id: "textbox", label: "Add text", icon: "text", hint: "Drag a box, then type new text." },
  { id: "highlight", label: "Highlight", icon: "highlight", hint: "Drag over text or an area to highlight it." },
  { id: "underline", label: "Underline", icon: "underline" },
  { id: "strikeout", label: "Strike out", icon: "strike" },
  { id: "squiggly", label: "Squiggle", icon: "squiggle" },
  { id: "note", label: "Note", icon: "note", hint: "Click anywhere to leave a comment." },
  { id: "ink", label: "Draw", icon: "pen", hint: "Draw freehand with the mouse or stylus." },
  { id: "rect", label: "Rectangle", icon: "square", hint: "Drag to draw a rectangle." },
  { id: "ellipse", label: "Ellipse", icon: "circle", hint: "Drag to draw an ellipse." },
  { id: "line", label: "Line", icon: "line", hint: "Drag from start to end." },
  { id: "arrow", label: "Arrow", icon: "arrow", hint: "Drag from start to end." },
  { id: "stamp", label: "Stamp", icon: "stamp", hint: "Drag a box to place the stamp." },
  { id: "redact", label: "Redact", icon: "redact", hint: "Drag over content to remove it permanently." },
];

const TABS = [
  { id: "annotate", label: "Markup", icon: "highlight" },
  { id: "pages", label: "Pages", icon: "pages" },
  { id: "edit", label: "Edit", icon: "edit" },
  { id: "forms", label: "Forms", icon: "form" },
  { id: "tools", label: "Tools", icon: "wand" },
  { id: "ask", label: "Ask", icon: "spark" },
];

const STUDIO_CSS = `
.studio-root { font-family: Arial, Helvetica, ui-sans-serif, system-ui, sans-serif; color-scheme: dark; }
.studio-scroll, .thumbs-scroll { scrollbar-width: thin; scrollbar-color: #2d5871 transparent; }
.studio-scroll::-webkit-scrollbar, .thumbs-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.studio-scroll::-webkit-scrollbar-thumb, .thumbs-scroll::-webkit-scrollbar-thumb { background: #2d5871; border-radius: 999px; }
.studio-root input[type="range"] { height: 4px; border-radius: 999px; background: #2d5871; appearance: none; }
.studio-root input[type="range"]::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #f84f63; cursor: pointer; }
.studio-text-layer {
  position: absolute; inset: 0; z-index: 5; overflow: clip; line-height: 1;
  text-align: initial; letter-spacing: normal; word-spacing: normal; opacity: 1;
  transform-origin: 0 0; color-scheme: only light; pointer-events: none;
  --min-font-size: 1; --scale-round-x: 1px; --scale-round-y: 1px;
  --text-scale-factor: calc(var(--total-scale-factor, 1) * var(--min-font-size));
}
.studio-text-layer > :not(.markedContent),
.studio-text-layer .markedContent span:not(.markedContent) {
  position: absolute; z-index: 1; color: transparent; white-space: pre; cursor: text;
  transform-origin: 0% 0%; font-size: calc(var(--text-scale-factor) * var(--font-height, 12px));
  -webkit-user-select: text; user-select: text;
}
.studio-text-layer .markedContent { display: contents; }
.studio-text-layer span, .studio-text-layer br { color: transparent; -webkit-user-select: text; user-select: text; }
.studio-text-layer ::selection { background: rgba(248,79,99,.28); color: transparent; }
.studio-root .studio-text-selectable { pointer-events: auto; }
`;

const DEFAULT_COMPOSER_SIZE = 14;

export default function PDFStudio() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [csrf, setCsrf] = useState("");
  const [docId, setDocId] = useState("");
  const [info, setInfo] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [version, setVersion] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1.05);
  const [tool, setTool] = useState("select");
  const [panel, setPanel] = useState("annotate");
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [annotColor, setAnnotColor] = useState("#f84f63");
  const [annotOpacity, setAnnotOpacity] = useState(0.45);
  const [annotWidth, setAnnotWidth] = useState(2);
  const [stampText, setStampText] = useState("APPROVED");
  const [textSize, setTextSize] = useState(DEFAULT_COMPOSER_SIZE);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [composer, setComposer] = useState(null);
  const [composerText, setComposerText] = useState("");
  const [composerSize, setComposerSize] = useState(DEFAULT_COMPOSER_SIZE);
  const [editor, setEditor] = useState(null);
  const [passwordPrompt, setPasswordPrompt] = useState(null);
  const [passwordValue, setPasswordValue] = useState("");

  const csrfRef = useRef("");
  const docIdRef = useRef("");
  const pdfTaskRef = useRef(null);
  const reloadSeqRef = useRef(0);
  const scrollRef = useRef(null);
  const openRef = useRef(null);

  const notify = useCallback((text, kind = "info") => setToast({ text, kind, at: Date.now() }), []);

  const resolve = useCallback((path) => (path.startsWith("/api/") ? path : `/api/pdf/${docIdRef.current}${path}`), []);

  const get = useCallback((path) => api(resolve(path), { csrf: csrfRef.current }), [resolve]);

  const post = useCallback((path, body) => {
    const form = body instanceof FormData;
    return api(resolve(path), {
      csrf: csrfRef.current,
      method: "POST",
      body: form ? undefined : body,
      form: form ? body : undefined,
    });
  }, [resolve]);

  const loadPdf = useCallback(async (id) => {
    const seq = ++reloadSeqRef.current;
    const response = await fetch(`/api/pdf/${id}/file`, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`The PDF file could not be loaded (${response.status}).`);
    const buffer = await response.arrayBuffer();
    if (seq !== reloadSeqRef.current) return null;
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      cMapUrl: "/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/standard_fonts/",
    });
    try {
      const proxy = await task.promise;
      if (seq !== reloadSeqRef.current) {
        try {
          await task.destroy();
        } catch {
          /* a newer load already replaced this task */
        }
        return null;
      }
      const previous = pdfTaskRef.current;
      pdfTaskRef.current = task;
      setPdf(proxy);
      try {
        await previous?.destroy();
      } catch {
        /* the old worker may already be gone */
      }
      return proxy;
    } catch (error) {
      try {
        await task.destroy();
      } catch {
        /* already gone */
      }
      throw error;
    }
  }, []);

  const mutate = useCallback(async (path, body, method = "POST") => {
    const form = body instanceof FormData;
    const data = await api(resolve(path), {
      csrf: csrfRef.current,
      method,
      body: form ? undefined : body,
      form: form ? body : undefined,
    });
    if (data?.info) {
      setInfo(data.info);
      // The working file changed on the server, so replace the PDF.js
      // document too. Without this the canvas would keep showing the copy
      // that was loaded before the edit.
      await loadPdf(docIdRef.current);
      setVersion((value) => value + 1);
    }
    return data;
  }, [resolve, loadPdf]);

  const run = useCallback(async (label, fn) => {
    setBusy(label);
    try {
      return await fn();
    } catch (error) {
      notify(error?.message || "Something went wrong.", "error");
      return null;
    } finally {
      setBusy("");
    }
  }, [notify]);

  const loadDocument = useCallback(async (id) => {
    const data = await api(`/api/pdf/${id}/info`, { csrf: csrfRef.current });
    if (!data?.doc_id) throw new Error("That PDF workspace could not be opened.");
    await loadPdf(id);
    setInfo(data);
    setDocId(id);
    docIdRef.current = id;
    setPageNumber(1);
    setSelected([]);
    setSearchResults([]);
    setComposer(null);
    setEditor(null);
    setVersion((value) => value + 1);
    const next = `/studio?doc=${id}`;
    if (window.location.pathname + window.location.search !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [loadPdf]);

  const openInfo = useCallback(async (target) => {
    if (!target?.doc_id) return;
    await run("Opening document...", () => loadDocument(target.doc_id));
  }, [loadDocument, run]);

  const openFile = useCallback(async (file, password = "") => {
    if (!file) return;
    await run("Opening PDF...", async () => {
      const form = new FormData();
      form.append("file", file);
      if (password) form.append("password", password);
      try {
        const data = await api("/api/pdf/open", { csrf: csrfRef.current, method: "POST", form });
        setPasswordPrompt(null);
        setPasswordValue("");
        await loadDocument(data.info.doc_id);
        notify("PDF ready. Changes are saved automatically.", "success");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && /password/i.test(error.message)) {
          setPasswordPrompt({ file, message: error.message });
          return;
        }
        throw error;
      }
    });
  }, [loadDocument, notify, run]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await csrfToken();
        if (!active) return;
        csrfRef.current = token;
        setCsrf(token);
        const account = await currentUser();
        if (!active) return;
        setUser(account);
        if (account) {
          const id = new URLSearchParams(window.location.search).get("doc");
          if (id) await loadDocument(id);
        }
      } catch (error) {
        if (active) notify(error?.message || "Could not reach the report service.", "error");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadDocument, notify]);

  useEffect(() => {
    if (!info) return;
    if (pageNumber > info.page_count) setPageNumber(Math.max(1, info.page_count));
  }, [info, pageNumber]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pagesToUse = () => (selected.length ? [...selected].sort((a, b) => a - b) : [pageNumber]);
  const currentTool = TOOLS.find((item) => item.id === tool);

  const undo = useCallback(() => run("Undoing...", () => mutate("/undo", {})), [mutate, run]);
  const redo = useCallback(() => run("Redoing...", () => mutate("/redo", {})), [mutate, run]);

  useEffect(() => {
    const handler = (event) => {
      const tag = event.target?.tagName || "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const toggleSelected = (number) =>
    setSelected((current) => (current.includes(number) ? current.filter((item) => item !== number) : [...current, number]));
  const selectAll = () => setSelected(info ? info.pages.map((page) => page.number) : []);
  const clearSelection = () => setSelected([]);

  const rotate = (angle) => run("Rotating pages...", () => mutate("/page/rotate", { pages: pagesToUse(), angle }));

  const movePage = (direction) => {
    if (!info) return;
    const target = pageNumber + direction;
    if (target < 1 || target > info.page_count) return;
    run("Moving page...", async () => {
      await mutate("/page/move", { from: pageNumber, to: target });
      setPageNumber(target);
    });
  };

  const duplicatePage = () => run("Duplicating page...", () => mutate("/page/duplicate", { page: pageNumber }));

  const insertBlank = () => {
    const page = info?.pages[pageNumber - 1];
    run("Inserting blank page...", () => mutate("/page/insert", {
      after: pageNumber,
      width: page?.width || 595,
      height: page?.height || 842,
    }));
  };

  const deletePages = () => {
    const pages = pagesToUse();
    if (!info || pages.length >= info.page_count) {
      notify("Keep at least one page in the document.", "error");
      return;
    }
    if (!window.confirm(`Delete ${pages.length} page${pages.length === 1 ? "" : "s"}? You can undo this.`)) return;
    run("Deleting pages...", () => mutate("/page/delete", { pages }));
  };

  const deleteAnnotation = (xref) =>
    run("Removing annotation...", () => mutate(`/annotations/${xref}`, null, "DELETE"));

  const annotate = async (kind, geometry) => {
    if (kind === "redact" && !window.confirm("Redaction removes the covered content permanently. Continue?")) return;
    const payload = {
      kind,
      page: pageNumber,
      color: annotColor,
      opacity: annotOpacity,
      lineWidth: annotWidth,
    };
    if (kind === "stamp") {
      payload.rects = [geometry];
      payload.text = stampText || "APPROVED";
    } else if (kind === "line" || kind === "arrow") {
      const start = geometry.start || { x: geometry.x, y: geometry.y };
      const end = geometry.end || { x: geometry.x + geometry.w, y: geometry.y + geometry.h };
      payload.points = [start, end];
    } else {
      payload.rects = [geometry];
    }
    await run("Adding markup...", () => mutate("/annotations", payload));
  };

  const drawInk = (points) => run("Drawing...", () => mutate("/annotations", {
    kind: "ink",
    page: pageNumber,
    color: annotColor,
    opacity: annotOpacity,
    strokes: [points],
  }));

  const openComposer = (kind, rect) => {
    setComposer({ kind, rect, page: pageNumber });
    setComposerText("");
    setComposerSize(kind === "note" ? 12 : textSize);
    setTool(kind === "note" ? "select" : tool);
  };

  const saveComposer = async () => {
    if (!composer) return;
    if (!composerText.trim()) {
      notify("Type the text first.", "error");
      return;
    }
    const kind = composer.kind;
    const result = await run("Saving text...", async () => {
      if (kind === "textbox") {
        return mutate("/text/add", {
          page: composer.page,
          rect: composer.rect,
          text: composerText,
          font_size: composerSize,
          color: annotColor,
        });
      }
      return mutate("/annotations", {
        kind: kind === "note" ? "note" : "freetext",
        page: composer.page,
        rects: [composer.rect],
        text: composerText,
        color: annotColor,
        opacity: annotOpacity,
        fontSize: composerSize,
      });
    });
    if (result) {
      setComposer(null);
      notify(kind === "note" ? "Note added." : "Text added.", "success");
    }
  };

  const handleTextHit = async (point) => {
    const data = await run("Reading text...", () => post("/text/hit", { page: pageNumber, x: point.x, y: point.y }));
    if (!data) return;
    if (!data.hit) {
      notify("No editable text at that point. Use Add text for a new text box.", "error");
      return;
    }
    setEditor({ ...data.hit });
  };

  const saveEditor = async () => {
    if (!editor) return;
    const result = await run("Updating text...", () => mutate("/text/edit", {
      page: editor.page,
      rect: editor.rect,
      text: editor.text,
      font_size: Number(editor.size) || 11,
      color: editor.color || "#111111",
      font: editor.font || "Helvetica",
      bold: Boolean(editor.bold),
      italic: Boolean(editor.italic),
    }));
    if (result) {
      setEditor(null);
      notify("Text updated. Use Undo to restore the original line.", "success");
    }
  };

  const search = async () => {
    if (!searchQuery.trim()) return;
    setSearchBusy(true);
    try {
      const data = await get(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchResults(data?.results || []);
      if (data?.results?.length) setPageNumber(data.results[0].page);
      else notify("No matches were found in the text layer.", "error");
    } catch (error) {
      notify(error?.message || "Search failed.", "error");
    } finally {
      setSearchBusy(false);
    }
  };

  const s = {
    info, docId, version, csrf, get, post, mutate, run, notify, openInfo,
    pageNumber, setPageNumber, pagesToUse, selected, setSelected,
    toggleSelected, selectAll, clearSelection,
    tool, setTool, tools: TOOLS, toolHint: currentTool?.hint || "",
    annotColor, setAnnotColor, annotOpacity, setAnnotOpacity,
    annotWidth, setAnnotWidth, stampText, setStampText, textSize, setTextSize,
    deleteAnnotation, rotate, movePage, duplicatePage, insertBlank, deletePages,
    searchQuery, setSearchQuery, searchResults, searchBusy, search,
  };

  const panelContent = {
    annotate: <MarkupPanel s={s} />,
    pages: <PagesPanel s={s} />,
    edit: <EditPanel s={s} />,
    forms: <FormsPanel s={s} />,
    tools: <ToolsPanel s={s} />,
    ask: <AskPanel s={s} />,
  }[panel];

  return (
    <div className="studio-root flex h-[100dvh] flex-col overflow-hidden bg-[#071f35] text-[#e8f4f4]">
      <style>{STUDIO_CSS}</style>

      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[#234b63] bg-[#081f35] px-3 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <img src="/csa_logo.webp" alt="CSA Engineering" className="h-8 w-auto" />
          <span className="hidden text-sm font-semibold text-white sm:inline">ReportGenix</span>
        </Link>
        <span className="mx-1 hidden h-6 w-px bg-[#234b63] sm:block" />
        <span className="hidden items-center gap-1.5 text-xs font-semibold text-[#9db8c4] sm:flex">
          <Icon name="file" className="h-4 w-4 text-[#f84f63]" />
          PDF Studio
        </span>
        {info ? (
          <div className="ml-2 min-w-0 flex-1 sm:ml-4">
            <p className="truncate text-xs font-semibold text-white sm:text-sm">{info.name}</p>
            <p className="hidden text-[10px] text-[#7f9dab] sm:block">
              {info.page_count} pages - {info.protected ? "protected copy ready" : "saved automatically"}
            </p>
          </div>
        ) : <div className="flex-1" />}

        <div className="flex items-center gap-1">
          {info ? (
            <>
              <Btn size="sm" variant="ghost" icon="undo" onClick={undo} disabled={!info.can_undo || Boolean(busy)} className="!px-2" aria-label="Undo" />
              <Btn size="sm" variant="ghost" icon="redo" onClick={redo} disabled={!info.can_redo || Boolean(busy)} className="!px-2" aria-label="Redo" />
            </>
          ) : null}
          <Btn size="sm" variant="secondary" icon="upload" onClick={() => openRef.current?.click()} className="!px-2 sm:!px-3">
            <span className="hidden sm:inline">Open</span>
          </Btn>
          {info ? (
            <a href={downloadUrl(docId)} download
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#f84f63] bg-[#f84f63] px-2 py-1.5 text-xs font-bold text-[#081f35] transition hover:bg-[#ff6377] sm:px-3">
              <Icon name="download" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </a>
          ) : null}
          <Link href="/" className="ml-1 hidden rounded-lg border border-[#2d5871] px-3 py-1.5 text-xs font-semibold text-[#c9dfe3] hover:border-[#f84f63] hover:text-white md:inline-flex">
            Reports
          </Link>
        </div>
        <input ref={openRef} type="file" accept="application/pdf,.pdf" className="hidden"
          onChange={(event) => { openFile(event.target.files?.[0]); event.target.value = ""; }} />
      </header>

      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-3 rounded-xl border border-[#234b63] bg-[#0c2b44] px-5 py-4 text-sm text-[#b6cfd5]">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#f84f63]" />
            Checking your session...
          </div>
        </div>
      ) : !info ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <Landing onFile={openFile} busy={busy} user={user}
            error={toast?.kind === "error" ? toast.text : ""} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ThumbsRail pdf={pdf} info={info} pageNumber={pageNumber} setPageNumber={setPageNumber}
            selected={selected} toggleSelected={toggleSelected} version={version} />
          <Stage
            pdf={pdf} info={info} version={version}
            pageNumber={pageNumber} setPageNumber={setPageNumber}
            zoom={zoom} setZoom={setZoom} tool={tool} setTool={setTool} tools={TOOLS}
            searchResults={searchResults}
            onAnnotate={annotate} onInk={drawInk} onTextHit={handleTextHit}
            onComposeText={openComposer} scrollRef={scrollRef} busy={busy}
            panelOpen={panelOpen} setPanelOpen={setPanelOpen}
          />

          {panelOpen ? <div className="fixed inset-x-0 bottom-0 top-14 z-30 bg-black/50 lg:hidden" onClick={() => setPanelOpen(false)} /> : null}
          <aside className={cls(
            "z-40 w-[min(94vw,380px)] shrink-0 flex-col border-l border-[#234b63] bg-[#081f35]",
            panelOpen ? "fixed inset-y-14 right-0 flex" : "hidden",
            "lg:static lg:flex lg:inset-auto",
          )}>
            <div className="grid shrink-0 grid-cols-3 border-b border-[#234b63]">
              {TABS.map((tab) => (
                <button key={tab.id} type="button" onClick={() => setPanel(tab.id)}
                  className={cls(
                    "flex items-center justify-center gap-1 border-b-2 px-1.5 py-2 text-[9px] font-semibold uppercase tracking-wide transition",
                    panel === tab.id
                      ? "border-[#f84f63] bg-[#f84f63]/10 text-white"
                      : "border-transparent text-[#8faebb] hover:bg-white/5 hover:text-white",
                  )}>
                  <Icon name={tab.icon} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              ))}
            </div>
            <div className="studio-scroll min-h-0 flex-1 overflow-y-auto p-3">{panelContent}</div>
          </aside>
        </div>
      )}

      {passwordPrompt ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#03121f]/85 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#2d5871] bg-[#0c2b44] p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-[#f84f63]">
              <Icon name="lock" className="h-5 w-5" />
              <h3 className="text-base font-semibold text-white">Password-protected PDF</h3>
            </div>
            <p className="text-xs leading-5 text-[#9db8c4]">{passwordPrompt.message}</p>
            <p className="mt-2 truncate rounded-lg bg-[#103a55] px-3 py-2 text-[11px] text-[#c9dfe3]">{passwordPrompt.file?.name}</p>
            <input autoFocus type="password" className={`${INPUT} mt-3`} placeholder="PDF password" value={passwordValue}
              onChange={(event) => setPasswordValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") openFile(passwordPrompt.file, passwordValue); }} />
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => { setPasswordPrompt(null); setPasswordValue(""); }}>Cancel</Btn>
              <Btn variant="primary" icon="unlock" onClick={() => openFile(passwordPrompt.file, passwordValue)}>Unlock PDF</Btn>
            </div>
          </div>
        </div>
      ) : null}

      {composer ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#03121f]/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#2d5871] bg-[#0c2b44] p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">
              {composer.kind === "note" ? "Add a note" : composer.kind === "freetext" ? "Add a text box" : "Add text"}
            </h3>
            <p className="mt-1 text-[11px] leading-4 text-[#8faebb]">
              {composer.kind === "note"
                ? "The note is attached to the point you clicked and appears in the markup list."
                : "The text is placed inside the rectangle you drew. Use Edit text later to change it."}
            </p>
            <textarea autoFocus className={`${INPUT} mt-3 h-28 resize-none`} value={composerText}
              placeholder={composer.kind === "note" ? "Comment" : "Type the text..."}
              onChange={(event) => setComposerText(event.target.value)} />
            {composer.kind !== "note" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={LABEL}>Font size</span>
                  <input type="number" min="6" max="96" className={INPUT} value={composerSize}
                    onChange={(event) => setComposerSize(Number(event.target.value) || 12)} />
                </label>
                <label className="block">
                  <span className={LABEL}>Text colour</span>
                  <input type="color" className="h-9 w-full cursor-pointer rounded-lg border border-[#2d5871] bg-[#103a55] p-1"
                    value={annotColor} onChange={(event) => setAnnotColor(event.target.value)} />
                </label>
              </div>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setComposer(null)}>Cancel</Btn>
              <Btn variant="primary" icon="check" onClick={saveComposer}>Save</Btn>
            </div>
          </div>
        </div>
      ) : null}

      {editor ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#03121f]/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#2d5871] bg-[#0c2b44] p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">Edit line on page {editor.page}</h3>
            <p className="mt-1 text-[11px] leading-4 text-[#8faebb]">
              The original line is removed and replaced with this text in the same position.
            </p>
            <textarea autoFocus className={`${INPUT} mt-3 h-28 resize-none`} value={editor.text}
              onChange={(event) => setEditor((current) => ({ ...current, text: event.target.value }))} />
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="block">
                <span className={LABEL}>Size</span>
                <input type="number" className={INPUT} value={editor.size}
                  onChange={(event) => setEditor((current) => ({ ...current, size: event.target.value }))} />
              </label>
              <label className="block">
                <span className={LABEL}>Colour</span>
                <input type="color" className="h-9 w-full cursor-pointer rounded-lg border border-[#2d5871] bg-[#103a55] p-1"
                  value={editor.color || "#111111"} onChange={(event) => setEditor((current) => ({ ...current, color: event.target.value }))} />
              </label>
              <div className="flex items-end gap-2 pb-2">
                <label className="flex items-center gap-1 text-[11px] text-[#c9dfe3]">
                  <input type="checkbox" checked={Boolean(editor.bold)} className="accent-[#f84f63]"
                    onChange={(event) => setEditor((current) => ({ ...current, bold: event.target.checked }))} /> Bold
                </label>
                <label className="flex items-center gap-1 text-[11px] text-[#c9dfe3]">
                  <input type="checkbox" checked={Boolean(editor.italic)} className="accent-[#f84f63]"
                    onChange={(event) => setEditor((current) => ({ ...current, italic: event.target.checked }))} /> Italic
                </label>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setEditor(null)}>Cancel</Btn>
              <Btn variant="primary" icon="check" onClick={saveEditor}>Replace text</Btn>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className={cls(
          "fixed bottom-4 left-4 z-[140] flex max-w-[min(92vw,440px)] items-start gap-2.5 rounded-xl border px-4 py-3 text-xs shadow-2xl",
          toast.kind === "error"
            ? "border-[#f84f63]/60 bg-[#3a1620] text-[#ffd5da]"
            : "border-[#3a8f8a]/60 bg-[#0d3739] text-[#d4f5ef]",
        )} role="status">
          <Icon name={toast.kind === "error" ? "warning" : "check"} className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1 leading-5">{toast.text}</p>
          <button type="button" onClick={() => setToast(null)} className="rounded p-0.5 opacity-70 hover:opacity-100" aria-label="Dismiss">
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
