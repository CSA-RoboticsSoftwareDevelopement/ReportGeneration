"use client";

import { useEffect, useRef, useState } from "react";
import { Btn, Chip, Empty, Fld, INPUT, Icon, Section } from "./ui";
import { downloadUrl, formatBytes } from "./api";

function Fold({ title, hint, children, open = false, icon = "settings" }) {
  return (
    <details open={open} className="group rounded-xl border border-[#234b63] bg-[#0c2b44]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-[13px] font-semibold text-white [&::-webkit-details-marker]:hidden">
        <Icon name={icon} className="h-4 w-4 text-[#7fd3c9]" />
        <span className="flex-1">{title}</span>
        <Icon name="chevron" className="h-4 w-4 text-[#7f9dab] transition group-open:rotate-180" />
      </summary>
      <div className="space-y-2.5 border-t border-[#234b63] px-3.5 py-3">
        {hint ? <p className="text-[11px] leading-4 text-[#8faebb]">{hint}</p> : null}
        {children}
      </div>
    </details>
  );
}

const CHECK = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 text-[11px] text-[#c9dfe3]">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-[#f84f63]" />
    {label}
  </label>
);

export default function ToolsPanel({ s }) {
  const [form, setForm] = useState({
    compressLevel: "balanced",
    wmText: "CONFIDENTIAL",
    wmSize: 54,
    wmAngle: 45,
    wmOpacity: 16,
    wmTiled: false,
    pnFormat: "Page {page} of {total}",
    pnPosition: "bottom-center",
    pnSize: 9,
    pnStart: 1,
    hfHeader: "",
    hfFooter: "",
    hfSize: 8.5,
    redactQuery: "",
    redactAll: true,
    ocrLang: "eng",
    ocrForce: false,
    ocrText: "",
    protectPassword: "",
    protectOwner: "",
    allowCopy: true,
    allowModify: false,
    allowAnnotate: true,
    allowForms: true,
    allowAssemble: false,
    meta: { title: "", author: "", subject: "", keywords: "", creator: "" },
    shareDays: 7,
    shareUrl: "",
  });
  const [compressed, setCompressed] = useState(null);
  const [ocrLanguages, setOcrLanguages] = useState(["eng"]);
  const [ocrAvailable, setOcrAvailable] = useState(true);
  const [compareResult, setCompareResult] = useState(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const compareRef = useRef(null);
  const createRef = useRef(null);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  useEffect(() => {
    const metadata = s.info?.metadata || {};
    setForm((current) => ({
      ...current,
      meta: {
        title: metadata.title || "",
        author: metadata.author || "",
        subject: metadata.subject || "",
        keywords: metadata.keywords || "",
        creator: metadata.creator || "",
      },
    }));
  }, [s.docId, s.info?.metadata?.title, s.info?.metadata?.author, s.info?.metadata?.subject]);

  useEffect(() => {
    s.get(`/api/pdf/${s.docId}/ocr/languages`)
      .then((data) => {
        setOcrLanguages(data?.languages?.length ? data.languages : ["eng"]);
        setOcrAvailable(Boolean(data?.available));
      })
      .catch(() => setOcrAvailable(false));
  }, [s.docId, s.get]);

  const compress = () =>
    s.run("Compressing images...", async () => {
      const data = await s.mutate("/compress", { level: form.compressLevel });
      setCompressed(data?.result || null);
      s.notify(`Saved ${formatBytes(data?.result?.saved || 0)} (${data?.result?.percent || 0}%).`, "success");
    });

  const watermark = () =>
    s.run("Adding watermark...", () =>
      s.mutate("/watermark", {
        text: form.wmText,
        size: Number(form.wmSize) || 54,
        angle: Number(form.wmAngle) || 0,
        opacity: (Number(form.wmOpacity) || 16) / 100,
        tiled: form.wmTiled,
        pages: "all",
      }));

  const pageNumbers = () =>
    s.run("Adding page numbers...", () =>
      s.mutate("/page-numbers", {
        format: form.pnFormat,
        position: form.pnPosition,
        size: Number(form.pnSize) || 9,
        start: Number(form.pnStart) || 1,
      }));

  const headerFooter = () =>
    s.run("Adding header and footer...", () =>
      s.mutate("/header-footer", {
        header: form.hfHeader,
        footer: form.hfFooter,
        size: Number(form.hfSize) || 8.5,
      }));

  const redact = () => {
    if (!form.redactQuery.trim())
      return s.notify("Type the text you want to remove first.", "error");
    if (!window.confirm("Redaction permanently removes the matched text and covered image pixels. Continue?")) return;
    s.run("Applying redactions...", () =>
      s.mutate("/redact", {
        query: form.redactQuery,
        pages: form.redactAll ? "all" : [s.pageNumber],
      }));
  };

  const runOcr = () =>
    s.run("Recognising text...", async () => {
      const data = await s.mutate("/ocr", {
        language: form.ocrLang,
        force: form.ocrForce,
        pages: "all",
      });
      const text = (data?.result?.text || []).map((page) => `--- Page ${page.page} ---\n${page.text}`).join("\n\n");
      set({ ocrText: text || "No text was recognised." });
    });

  const protect = () =>
    s.run("Protecting PDF...", () =>
      s.mutate("/protect", {
        password: form.protectPassword,
        owner_password: form.protectOwner,
        allow_copy: form.allowCopy,
        allow_modify: form.allowModify,
        allow_annotate: form.allowAnnotate,
        allow_forms: form.allowForms,
        allow_assemble: form.allowAssemble,
      }));

  const saveMetadata = () => s.run("Saving details...", () => s.mutate("/metadata", form.meta));

  const share = () =>
    s.run("Creating share link...", async () => {
      const data = await s.post("/share", { days: Number(form.shareDays) || 7 });
      const url = `${window.location.origin}${data.url}`;
      set({ shareUrl: url });
      try {
        await navigator.clipboard.writeText(url);
        s.notify("Share link copied to the clipboard.", "success");
      } catch {
        s.notify("Share link ready below.", "success");
      }
    });

  const compare = (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    setCompareBusy(true);
    setCompareResult(null);
    s.run("Comparing documents...", async () => {
      const body = new FormData();
      body.append("file", file);
      const data = await s.post("/compare", body);
      setCompareResult(data);
      if (compareRef.current) compareRef.current.value = "";
    }).finally(() => setCompareBusy(false));
  };

  const createPdf = (fileList) =>
    s.run("Creating PDF...", async () => {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      const data = await s.post("/api/pdf/create", body);
      if (createRef.current) createRef.current.value = "";
      if (data?.info) s.openInfo(data.info);
    });

  return (
    <div className="space-y-2.5">
      <Fold title="Compress" icon="compress" hint="Recompress images to reduce file size. Text stays sharp.">
        <div className="grid grid-cols-3 gap-1.5">
          {[
            ["light", "Light"],
            ["balanced", "Balanced"],
            ["strong", "Strong"],
          ].map(([value, label]) => (
            <button key={value} type="button" onClick={() => set({ compressLevel: value })}
              className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                form.compressLevel === value ? "border-[#f84f63] bg-[#f84f63]/15 text-white" : "border-[#2d5871] bg-[#103a55] text-[#a9c5cd]"
              }`}>{label}</button>
          ))}
        </div>
        <Btn size="sm" className="w-full" icon="compress" onClick={compress}>Compress document</Btn>
        {compressed ? (
          <p className="rounded-lg bg-[#103a55] px-3 py-2 text-[11px] text-[#c9dfe3]">
            {formatBytes(compressed.before)} to {formatBytes(compressed.after)} - saved {formatBytes(compressed.saved)} ({compressed.percent}%).
          </p>
        ) : null}
      </Fold>

      <Fold title="Watermark" icon="watermark">
        <Fld label="Text">
          <input className={INPUT} value={form.wmText} onChange={(event) => set({ wmText: event.target.value })} />
        </Fld>
        <div className="grid grid-cols-3 gap-2">
          <Fld label="Size"><input type="number" className={INPUT} value={form.wmSize} onChange={(event) => set({ wmSize: event.target.value })} /></Fld>
          <Fld label="Angle"><input type="number" className={INPUT} value={form.wmAngle} onChange={(event) => set({ wmAngle: event.target.value })} /></Fld>
          <Fld label="Opacity"><input type="number" min="2" max="100" className={INPUT} value={form.wmOpacity} onChange={(event) => set({ wmOpacity: event.target.value })} /></Fld>
        </div>
        <CHECK label="Tile across the page" checked={form.wmTiled} onChange={(value) => set({ wmTiled: value })} />
        <Btn size="sm" className="w-full" onClick={watermark}>Add watermark</Btn>
      </Fold>

      <Fold title="Page numbers" icon="numbers">
        <Fld label="Format" hint="Use {page} and {total}.">
          <input className={INPUT} value={form.pnFormat} onChange={(event) => set({ pnFormat: event.target.value })} />
        </Fld>
        <div className="grid grid-cols-2 gap-2">
          <Fld label="Position">
            <select className={INPUT} value={form.pnPosition} onChange={(event) => set({ pnPosition: event.target.value })}>
              {["bottom-center", "bottom-left", "bottom-right", "top-center", "top-left", "top-right"].map((value) => (
                <option key={value} value={value}>{value.replace("-", " ")}</option>
              ))}
            </select>
          </Fld>
          <Fld label="Start at"><input type="number" min="1" className={INPUT} value={form.pnStart} onChange={(event) => set({ pnStart: event.target.value })} /></Fld>
        </div>
        <Btn size="sm" className="w-full" onClick={pageNumbers}>Add page numbers</Btn>
      </Fold>

      <Fold title="Header and footer" icon="header">
        <Fld label="Header"><input className={INPUT} value={form.hfHeader} placeholder="Use {page} and {total}" onChange={(event) => set({ hfHeader: event.target.value })} /></Fld>
        <Fld label="Footer"><input className={INPUT} value={form.hfFooter} onChange={(event) => set({ hfFooter: event.target.value })} /></Fld>
        <Btn size="sm" className="w-full" onClick={headerFooter}>Add header and footer</Btn>
      </Fold>

      <Fold title="Redact" icon="redact" hint="Permanent: text and image pixels under the matches are removed.">
        <Fld label="Text to remove">
          <input className={INPUT} value={form.redactQuery} placeholder="e.g. confidential, account number" onChange={(event) => set({ redactQuery: event.target.value })} />
        </Fld>
        <CHECK label="Search every page" checked={form.redactAll} onChange={(value) => set({ redactAll: value })} />
        <Btn size="sm" variant="danger" className="w-full" onClick={redact}>Redact matches</Btn>
      </Fold>

      <Fold title="OCR" icon="ocr" hint={ocrAvailable ? "Tesseract adds invisible selectable text to scanned pages." : "Tesseract was not found on this computer."}>
        <div className="grid grid-cols-2 gap-2">
          <Fld label="Language">
            <select className={INPUT} value={form.ocrLang} onChange={(event) => set({ ocrLang: event.target.value })}>
              {ocrLanguages.map((language) => <option key={language} value={language}>{language}</option>)}
            </select>
          </Fld>
          <Fld label="Mode">
            <select className={INPUT} value={form.ocrForce ? "force" : "skip"} onChange={(event) => set({ ocrForce: event.target.value === "force" })}>
              <option value="skip">Skip pages with text</option>
              <option value="force">Re-OCR every page</option>
            </select>
          </Fld>
        </div>
        <Btn size="sm" className="w-full" icon="ocr" onClick={runOcr} disabled={!ocrAvailable}>Run OCR</Btn>
        {form.ocrText ? (
          <textarea readOnly className={`${INPUT} h-32 font-mono text-[10px]`} value={form.ocrText} />
        ) : null}
      </Fold>

      <Fold title={s.info?.protected ? "Protection active" : "Protect"} icon={s.info?.protected ? "lock" : "unlock"}
        hint={s.info?.protected ? "A protected copy is used for downloads and sharing." : "Add a password and choose what readers may do."}>
        <Fld label="Open password"><input type="password" className={INPUT} value={form.protectPassword} onChange={(event) => set({ protectPassword: event.target.value })} /></Fld>
        <Fld label="Owner password (optional)"><input type="password" className={INPUT} value={form.protectOwner} onChange={(event) => set({ protectOwner: event.target.value })} /></Fld>
        <div className="grid grid-cols-2 gap-1.5">
          <CHECK label="Allow copy" checked={form.allowCopy} onChange={(value) => set({ allowCopy: value })} />
          <CHECK label="Allow annotate" checked={form.allowAnnotate} onChange={(value) => set({ allowAnnotate: value })} />
          <CHECK label="Allow modify" checked={form.allowModify} onChange={(value) => set({ allowModify: value })} />
          <CHECK label="Allow forms" checked={form.allowForms} onChange={(value) => set({ allowForms: value })} />
          <CHECK label="Allow assemble" checked={form.allowAssemble} onChange={(value) => set({ allowAssemble: value })} />
        </div>
        <div className="flex gap-1.5">
          <Btn size="sm" className="flex-1" icon="lock" onClick={protect}>Set protection</Btn>
          {s.info?.protected ? <Btn size="sm" variant="danger" onClick={() => s.run("Removing protection...", () => s.mutate("/unlock", {}))}>Remove</Btn> : null}
        </div>
      </Fold>

      <Fold title="Document details" icon="metadata">
        <div className="grid grid-cols-2 gap-2">
          <Fld label="Title"><input className={INPUT} value={form.meta.title} onChange={(event) => set({ meta: { ...form.meta, title: event.target.value } })} /></Fld>
          <Fld label="Author"><input className={INPUT} value={form.meta.author} onChange={(event) => set({ meta: { ...form.meta, author: event.target.value } })} /></Fld>
          <Fld label="Subject" className="col-span-2"><input className={INPUT} value={form.meta.subject} onChange={(event) => set({ meta: { ...form.meta, subject: event.target.value } })} /></Fld>
          <Fld label="Keywords" className="col-span-2"><input className={INPUT} value={form.meta.keywords} onChange={(event) => set({ meta: { ...form.meta, keywords: event.target.value } })} /></Fld>
          <Fld label="Creator" className="col-span-2"><input className={INPUT} value={form.meta.creator} onChange={(event) => set({ meta: { ...form.meta, creator: event.target.value } })} /></Fld>
        </div>
        <Btn size="sm" className="w-full" onClick={saveMetadata}>Save details</Btn>
      </Fold>

      <Fold title="Compare" icon="compare" hint="Compare this document with another PDF and list changed lines.">
        <input ref={compareRef} type="file" accept="application/pdf" className="hidden" onChange={(event) => compare(event.target.files)} />
        <Btn size="sm" className="w-full" icon="compare" disabled={compareBusy} onClick={() => compareRef.current?.click()}>Choose comparison PDF</Btn>
        {compareResult ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="teal">+{compareResult.summary.added_lines} added</Chip>
              <Chip tone="coral">-{compareResult.summary.removed_lines} removed</Chip>
              <Chip>Page delta {compareResult.summary.page_delta}</Chip>
            </div>
            <ul className="max-h-40 space-y-1 overflow-auto text-[10px] leading-4">
              {(compareResult.changes || []).slice(0, 40).map((change, index) => (
                <li key={index} className={`rounded px-2 py-1 ${change.type === "added" ? "bg-[#174d51] text-[#c8f0e8]" : "bg-[#f84f63]/10 text-[#ffb3bc]"}`}>
                  p.{change.page} {change.type}: {change.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Fold>

      <Fold title="Share" icon="share" hint="Create a read-only link that expires automatically.">
        <div className="flex gap-1.5">
          <input type="number" min="1" max="30" className={`${INPUT} w-20`} value={form.shareDays} onChange={(event) => set({ shareDays: event.target.value })} />
          <Btn size="sm" className="flex-1" icon="link" onClick={share}>Create link</Btn>
        </div>
        {form.shareUrl ? (
          <div className="space-y-1.5">
            <input readOnly className={INPUT} value={form.shareUrl} onFocus={(event) => event.target.select()} />
            <Btn size="sm" className="w-full" icon="copy" onClick={() => navigator.clipboard?.writeText(form.shareUrl)}>Copy link</Btn>
          </div>
        ) : null}
      </Fold>

      <Fold title="Export and convert" icon="download" open hint="Downloads are generated from the current working copy.">
        <div className="grid grid-cols-2 gap-1.5">
          {[
            ["pdf", "PDF"],
            ["docx", "Word"],
            ["xlsx", "Excel"],
            ["pptx", "PowerPoint"],
            ["txt", "Text"],
            ["html", "HTML"],
            ["png", "PNG images"],
            ["jpg", "JPG images"],
          ].map(([format, label]) => (
            <a key={format} href={downloadUrl(s.docId, "export", format)} download
              className="rounded-lg border border-[#2d5871] bg-[#103a55] px-2 py-2 text-center text-xs font-semibold text-[#dbecef] transition hover:border-[#f84f63] hover:text-white">
              {label}
            </a>
          ))}
        </div>
        <a href={downloadUrl(s.docId)} download
          className="block rounded-lg border border-[#f84f63] bg-[#f84f63] px-2 py-2 text-center text-xs font-bold text-[#081f35] transition hover:bg-[#ff6377]">
          Download working PDF
        </a>
      </Fold>

      <Fold title="Create PDF" icon="plus" hint="Combine PDFs, images, Word, Excel, PowerPoint, text or Markdown into a new document.">
        <input ref={createRef} type="file" multiple className="hidden" onChange={(event) => createPdf(event.target.files)}
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv" />
        <Btn size="sm" className="w-full" icon="upload" onClick={() => createRef.current?.click()}>Choose files</Btn>
        <p className="text-[10px] leading-4 text-[#7f9dab]">Office conversion uses the locally installed Microsoft Office or LibreOffice. Nothing leaves this computer.</p>
      </Fold>

      {!s.info?.page_count ? <Empty>Add a page before exporting.</Empty> : null}
    </div>
  );
}
