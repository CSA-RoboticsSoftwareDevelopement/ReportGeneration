"use client";

import { useRef, useState } from "react";
import { Btn, Empty, Fld, INPUT, Icon, Section } from "./ui";

export default function PagesPanel({ s }) {
  const [splitRanges, setSplitRanges] = useState("1-");
  const [crop, setCrop] = useState({ top: 5, right: 5, bottom: 5, left: 5 });
  const [cropAll, setCropAll] = useState(true);
  const [results, setResults] = useState([]);
  const mergeRef = useRef(null);
  const pages = s.pagesToUse;

  const applyCrop = () =>
    s.run("Cropping pages...", async () => {
      const left = Math.max(0, Math.min(40, Number(crop.left) || 0)) / 100;
      const right = Math.max(0, Math.min(40, Number(crop.right) || 0)) / 100;
      const top = Math.max(0, Math.min(40, Number(crop.top) || 0)) / 100;
      const bottom = Math.max(0, Math.min(40, Number(crop.bottom) || 0)) / 100;
      const rect = { x: left, y: top, w: Math.max(0.1, 1 - left - right), h: Math.max(0.1, 1 - top - bottom) };
      await s.mutate("/page/crop", { pages: cropAll ? "all" : pages(), rect });
    });

  const extract = () =>
    s.run("Extracting pages...", async () => {
      const data = await s.post(`/api/pdf/${s.docId}/page/extract`, { pages: pages() });
      if (data?.info) setResults([data.info]);
    });

  const split = () =>
    s.run("Splitting document...", async () => {
      const data = await s.post(`/api/pdf/${s.docId}/split`, { ranges: splitRanges });
      setResults(data?.documents || []);
    });

  const merge = (fileList) =>
    s.run("Merging PDFs...", async () => {
      const form = new FormData();
      Array.from(fileList || []).forEach((file) => form.append("files", file));
      await s.mutate("/merge", form);
      if (mergeRef.current) mergeRef.current.value = "";
    });

  return (
    <div className="space-y-3">
      <Section title="Select pages" hint="Actions apply to the highlighted pages, or the current page when none are selected."
        right={<span className="rounded-full bg-[#103a55] px-2 py-0.5 text-[10px] font-semibold text-[#a9c5cd]">{s.selected.length || 1}</span>}>
        <div className="mb-2 flex gap-1.5">
          <Btn size="sm" variant="ghost" onClick={s.selectAll}>All</Btn>
          <Btn size="sm" variant="ghost" onClick={s.clearSelection}>Clear</Btn>
          <Btn size="sm" variant="ghost" onClick={() => s.setSelected([s.pageNumber])}>Current</Btn>
        </div>
        <div className="grid max-h-36 grid-cols-6 gap-1 overflow-auto pr-1">
          {(s.info?.pages || []).map((page) => {
            const active = s.selected.includes(page.number);
            const current = page.number === s.pageNumber;
            return (
              <button key={page.number} type="button"
                onClick={(event) => {
                  if (event.shiftKey) {
                    s.toggleSelected(page.number);
                  } else {
                    s.setPageNumber(page.number);
                    s.toggleSelected(page.number);
                  }
                }}
                className={`rounded-md border py-1.5 text-[11px] font-semibold transition ${
                  active
                    ? "border-[#f84f63] bg-[#f84f63]/20 text-white"
                    : current
                      ? "border-[#7fd3c9] bg-[#174d51] text-[#d6f4ef]"
                      : "border-[#2d5871] bg-[#103a55] text-[#a9c5cd] hover:border-[#f84f63]/50"
                }`}>
                {page.number}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Organise">
        <div className="grid grid-cols-2 gap-1.5">
          <Btn size="sm" icon="rotateLeft" onClick={() => s.rotate(-90)}>Rotate left</Btn>
          <Btn size="sm" icon="rotate" onClick={() => s.rotate(90)}>Rotate right</Btn>
          <Btn size="sm" icon="up" onClick={() => s.movePage(-1)} disabled={s.pageNumber <= 1}>Move up</Btn>
          <Btn size="sm" icon="down" onClick={() => s.movePage(1)} disabled={s.pageNumber >= s.info.page_count}>Move down</Btn>
          <Btn size="sm" icon="copy" onClick={s.duplicatePage}>Duplicate</Btn>
          <Btn size="sm" icon="plus" onClick={s.insertBlank}>Blank page</Btn>
          <Btn size="sm" variant="danger" icon="trash" className="col-span-2" onClick={s.deletePages}>Delete selected pages</Btn>
        </div>
      </Section>

      <Section title="Crop" hint="Trim equal margins from the page edges.">
        <div className="grid grid-cols-4 gap-2">
          {["top", "right", "bottom", "left"].map((side) => (
            <Fld key={side} label={side}>
              <input type="number" min="0" max="40" className={INPUT} value={crop[side]}
                onChange={(event) => setCrop((current) => ({ ...current, [side]: event.target.value }))} />
            </Fld>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-[11px] text-[#a9c5cd]">
          <input type="checkbox" checked={cropAll} onChange={(event) => setCropAll(event.target.checked)} className="accent-[#f84f63]" />
          Apply to every page
        </label>
        <Btn size="sm" icon="crop" className="mt-2 w-full" onClick={applyCrop}>Apply crop</Btn>
      </Section>

      <Section title="Extract & split">
        <Btn size="sm" icon="split" className="w-full" onClick={extract}>Extract selected pages</Btn>
        <div className="mt-2 flex gap-1.5">
          <input className={INPUT} value={splitRanges} onChange={(event) => setSplitRanges(event.target.value)}
            placeholder="e.g. 1-3,5,8-10" aria-label="Split page ranges" />
          <Btn size="sm" onClick={split}>Split</Btn>
        </div>
        <p className="mt-1 text-[11px] text-[#7f9dab]">Split creates one new document per range.</p>
      </Section>

      <Section title="Merge" hint="Append other PDFs to the end of this document.">
        <input ref={mergeRef} type="file" accept="application/pdf" multiple className="hidden"
          onChange={(event) => merge(event.target.files)} />
        <Btn size="sm" icon="merge" className="w-full" onClick={() => mergeRef.current?.click()}>Choose PDFs to merge</Btn>
      </Section>

      {results.length ? (
        <Section title="Created documents" hint="These are separate workspaces; open one to keep editing.">
          <ul className="space-y-1.5">
            {results.map((item) => (
              <li key={item.doc_id} className="flex items-center gap-2 rounded-lg border border-[#2d5871] bg-[#103a55] px-2.5 py-2">
                <Icon name="file" className="h-4 w-4 shrink-0 text-[#7fd3c9]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{item.name}</p>
                  <p className="text-[10px] text-[#8faebb]">{item.page_count} pages</p>
                </div>
                <Btn size="sm" variant="teal" onClick={() => s.openInfo(item)}>Open</Btn>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {s.info?.page_count === 0 ? <Empty>This document has no pages.</Empty> : null}
    </div>
  );
}
