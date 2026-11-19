"use client";

import PageSurface from "./PageSurface";
import { Icon } from "./ui";

export default function ThumbsRail({ pdf, info, pageNumber, setPageNumber, selected, toggleSelected, version }) {
  if (!pdf || !info) return null;
  return (
    <aside className="hidden w-[132px] shrink-0 flex-col border-r border-[#234b63] bg-[#081f35] lg:flex">
      <div className="flex items-center justify-between border-b border-[#234b63] px-2.5 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#8faebb]">Pages</span>
        <span className="rounded-full bg-[#103a55] px-1.5 py-0.5 text-[9px] font-semibold text-[#a9c5cd]">{info.page_count}</span>
      </div>
      <div className="thumbs-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2.5">
        {info.pages.map((page) => {
          const active = page.number === pageNumber;
          const checked = selected.includes(page.number);
          const scale = Math.min(100 / Math.max(1, page.width), 132 / Math.max(1, page.height));
          return (
            <div key={page.number} className="group relative">
              <button type="button" onClick={() => setPageNumber(page.number)}
                className={`block w-full overflow-hidden rounded-md border-2 bg-white transition ${
                  active ? "border-[#f84f63] shadow-[0_0_0_2px_rgba(248,79,99,.2)]" : "border-transparent hover:border-[#7fd3c9]/70"
                }`}
                aria-label={`Go to page ${page.number}`} aria-current={active ? "page" : undefined}>
                <PageSurface pdf={pdf} pageNumber={page.number} scale={scale} tool="thumb" version={version} />
              </button>
              <span className={`absolute bottom-1 left-1 rounded px-1 text-[9px] font-bold ${
                active ? "bg-[#f84f63] text-[#081f35]" : "bg-[#081f35]/85 text-[#d7e9ec]"
              }`}>{page.number}</span>
              <button type="button" onClick={() => toggleSelected(page.number)}
                aria-label={checked ? `Deselect page ${page.number}` : `Select page ${page.number}`}
                className={`absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded border text-[9px] ${
                  checked ? "border-[#f84f63] bg-[#f84f63] text-[#081f35]" : "border-[#2d5871] bg-[#081f35]/85 text-transparent opacity-0 group-hover:opacity-100"
                }`}>
                <Icon name="check" className="h-2.5 w-2.5" sw={3} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="border-t border-[#234b63] px-2 py-2 text-[10px] text-[#8faebb]">
        {selected.length ? `${selected.length} selected` : "Click a page"}
      </div>
    </aside>
  );
}
