"use client";

import { Empty, Fld, Icon, INPUT, Section } from "./ui";

export const ANNOT_COLORS = [
  "#f84f63", "#ffd54a", "#4ade80", "#60a5fa", "#c084fc", "#fb923c", "#f8fafc", "#111827",
];

export default function MarkupPanel({ s }) {
  const annotations = (s.info?.annotations || []).filter((item) => item.page === s.pageNumber);
  return (
    <div className="space-y-3">
      <Section title="Markup" hint="Pick a tool, then drag or click directly on the page.">
        <div className="grid grid-cols-4 gap-1.5">
          {s.tools.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => s.setTool(item.id)}
              title={item.hint || item.label}
              className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] font-medium transition ${
                s.tool === item.id
                  ? "border-[#f84f63] bg-[#f84f63]/15 text-white"
                  : "border-[#2d5871] bg-[#103a55] text-[#b6d0d7] hover:border-[#f84f63]/50 hover:text-white"
              }`}
            >
              <Icon name={item.icon} className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </div>
        {s.toolHint ? <p className="mt-2 text-[11px] leading-4 text-[#8faebb]">{s.toolHint}</p> : null}
      </Section>

      <Section title="Style">
        <div className="flex flex-wrap gap-1.5">
          {ANNOT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Use ${color}`}
              onClick={() => s.setAnnotColor(color)}
              className={`h-7 w-7 rounded-full border-2 transition ${
                s.annotColor === color ? "border-white scale-110" : "border-black/30"
              }`}
              style={{ background: color }}
            />
          ))}
          <label className="flex h-7 items-center gap-1 rounded-full border border-[#2d5871] bg-[#103a55] px-2 text-[10px] text-[#a9c5cd]">
            Custom
            <input type="color" value={s.annotColor} onChange={(event) => s.setAnnotColor(event.target.value)}
              className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0" />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Fld label={`Opacity ${Math.round(s.annotOpacity * 100)}%`}>
            <input type="range" min="10" max="100" value={Math.round(s.annotOpacity * 100)}
              onChange={(event) => s.setAnnotOpacity(Number(event.target.value) / 100)}
              className="w-full accent-[#f84f63]" />
          </Fld>
          <Fld label={`Stroke ${s.annotWidth}px`}>
            <input type="range" min="1" max="10" value={s.annotWidth}
              onChange={(event) => s.setAnnotWidth(Number(event.target.value))}
              className="w-full accent-[#f84f63]" />
          </Fld>
        </div>
        {s.tool === "stamp" ? (
          <Fld label="Stamp text" className="mt-3">
            <input className={INPUT} value={s.stampText} maxLength={32}
              onChange={(event) => s.setStampText(event.target.value.toUpperCase())} />
          </Fld>
        ) : null}
        {["textbox", "freetext"].includes(s.tool) ? (
          <p className="mt-3 rounded-lg bg-[#103a55] px-3 py-2 text-[11px] text-[#a9c5cd]">
            Drag a box on the page, then type the text in the dialog.
          </p>
        ) : null}
      </Section>

      <Section title={`Annotations on page ${s.pageNumber}`} hint={`${annotations.length} item${annotations.length === 1 ? "" : "s"}`}>
        {annotations.length ? (
          <ul className="space-y-1.5">
            {annotations.map((item) => (
              <li key={item.id} className="flex items-start gap-2 rounded-lg border border-[#2d5871] bg-[#103a55] px-2.5 py-2">
                <span className="mt-0.5 h-3 w-3 shrink-0 rounded-sm" style={{ background: item.color || "#f84f63" }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{item.type}</p>
                  {item.content ? <p className="line-clamp-2 text-[11px] leading-4 text-[#9db8c4]">{item.content}</p> : null}
                </div>
                <button type="button" onClick={() => s.deleteAnnotation(item.id)}
                  className="rounded p-1 text-[#8faebb] hover:bg-[#f84f63]/15 hover:text-[#ff9eaa]" title="Delete annotation">
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No markup on this page yet. Highlights also appear here so you can remove them again.</Empty>
        )}
      </Section>
    </div>
  );
}
