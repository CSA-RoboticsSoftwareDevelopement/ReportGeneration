"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Btn, Icon } from "./ui";

const FEATURES = [
  ["highlight", "Markup and review", "Highlight, underline, notes, freehand drawing, shapes, stamps and redaction."],
  ["edit", "Edit what you see", "Rewrite a line of text, add text boxes, place or replace images."],
  ["pages", "Pages and files", "Rotate, reorder, crop, split, merge, extract and create new PDFs."],
  ["wand", "Document tools", "Compress, watermark, page numbers, headers, OCR, forms and protection."],
  ["download", "Convert and share", "Word, Excel, PowerPoint, text, HTML, images and expiring share links."],
  ["spark", "Ask the document", "Search every page and get answers grounded in the PDF text, locally."],
];

export default function Landing({ onFile, busy, error, user }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const accept = (fileList) => {
    const file = fileList?.[0];
    if (file) onFile(file);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#2d5871] bg-[#0c2b44] px-3 py-1.5 text-[11px] font-semibold text-[#9db8c4]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#7fd3c9]" />
            Local PDF workspace - nothing leaves this computer
          </div>
          <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
            Open a PDF and work on it <span className="text-[#f84f63]">without leaving the report studio.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#b6cfd5]">
            PDF Studio brings the everyday PDF workflow into ReportGenix: review and mark up generated
            reports, fix text and images, organise pages, fill forms, OCR scans, compress, protect and export.
            Every change is saved as an undoable step in your own workspace.
          </p>

          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              accept(event.dataTransfer.files);
            }}
            className={`mt-6 rounded-2xl border-2 border-dashed p-6 text-center transition sm:p-8 ${
              dragging ? "border-[#f84f63] bg-[#f84f63]/10" : "border-[#2d5871] bg-[#0c2b44]/70 hover:border-[#f84f63]/60"
            }`}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f84f63]/15 text-[#f84f63]">
              <Icon name="upload" className="h-6 w-6" />
            </div>
            <p className="mt-3 text-sm font-semibold text-white">Drop a PDF here</p>
            <p className="mt-1 text-xs text-[#8faebb]">or choose a file from this computer (up to 120 MB)</p>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden"
              onChange={(event) => accept(event.target.files)} />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Btn variant="primary" icon="folder" onClick={() => inputRef.current?.click()} disabled={Boolean(busy)}>
                {busy || "Choose PDF"}
              </Btn>
              <Link href="/issue">
                <Btn variant="secondary" icon="file">Use a generated report</Btn>
              </Link>
            </div>
            {error ? <p className="mt-3 text-xs text-[#ff9eaa]">{error}</p> : null}
            {!user ? (
              <p className="mt-3 text-xs text-[#ffb3bc]">
                Sign in from the <Link href="/" className="underline">report workspace</Link> first.
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-[#8faebb]">
            <span className="inline-flex items-center gap-1 rounded-full border border-[#234b63] px-2.5 py-1"><Icon name="lock" className="h-3 w-3" /> Password-protected PDFs supported</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#234b63] px-2.5 py-1"><Icon name="undo" className="h-3 w-3" /> 25 undo steps</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#234b63] px-2.5 py-1"><Icon name="shield" className="h-3 w-3" /> Scoped to your account</span>
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {FEATURES.map(([icon, title, text]) => (
            <div key={title} className="rounded-xl border border-[#234b63] bg-[#0c2b44] p-3.5">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#174d51] text-[#7fd3c9]">
                <Icon name={icon} className="h-4 w-4" />
              </div>
              <h3 className="text-xs font-semibold text-white">{title}</h3>
              <p className="mt-1 text-[11px] leading-4 text-[#8faebb]">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
