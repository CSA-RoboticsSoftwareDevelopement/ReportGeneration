"use client";

import { useId } from "react";

export const CARD = "rounded-xl border border-[#234b63] bg-[#0c2b44]";
export const INPUT =
  "w-full rounded-lg border border-[#2d5871] bg-[#103a55] px-3 py-2 text-sm text-white placeholder:text-[#7f9dab] outline-none transition focus:border-[#f84f63] focus:ring-2 focus:ring-[#f84f63]/20 disabled:opacity-50";
export const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#9db8c4]";

export const cls = (...values) => values.filter(Boolean).join(" ");

const ICONS = {
  cursor: "M5 3l14 8-6 1.4L10 19z",
  textCursor: "M12 4v16M8 4h8M8 20h8M9 9h6M9 9v2M15 9v2",
  text: "M5 5h14M12 5v14M9 19h6",
  highlight: "M5 19h5l9-9-3-3-9 9zM13 5l3 3M4 21h16",
  underline: "M7 4v6a5 5 0 0 0 10 0V4M5 20h14",
  strike: "M4 12h16M8 8a4 4 0 0 1 4-3c2.5 0 3.5 1.2 4 3M8 16a4 4 0 0 0 4 3c2.5 0 3.5-1.2 4-3",
  squiggle: "M4 16c2-4 4 4 6 0s4 4 6 0 4 4 4 0M4 10h16",
  note: "M5 4h14v10l-5 6H5zM14 20v-6h5M8 8h8M8 11h5",
  pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  square: "M4 5h16v14H4z",
  circle: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
  line: "M4 20L20 4",
  arrow: "M4 20L20 4M13 4h7v7",
  stamp: "M6 20h12M8 17h8v-2c0-2-3-2-3-5V7a1 1 0 0 0-2 0v3c0 3-3 3-3 5z",
  redact: "M4 6h16v12H4zM7 10h10v4H7z",
  image: "M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 3-3 5 5M9 9.5h.01",
  search: "M21 21l-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z",
  pages: "M7 3h7l5 5v13H7zM14 3v5h5M4 7v14h11",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  form: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5",
  wand: "M15 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM4 20l9-9M4 14l6 6",
  spark: "M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  undo: "M9 7L4 12l5 5M4 12h9a6 6 0 0 1 6 6",
  redo: "M15 7l5 5-5 5M20 12h-9a6 6 0 0 0-6 6",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6",
  rotate: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  rotateLeft: "M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5",
  copy: "M9 9h11v11H9zM5 15V4h11",
  up: "M12 19V5M5 12l7-7 7 7",
  down: "M12 5v14M5 12l7 7 7-7",
  crop: "M6 3v15h15M3 6h15v15",
  split: "M12 3v18M5 7l-3 5 3 5M19 7l3 5-3 5",
  merge: "M4 5h7v7H4zM13 12h7v7h-7zM11 9h4a2 2 0 0 1 2 2v1",
  lock: "M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3M12 14v3",
  unlock: "M6 10h12v10H6zM8 10V7a4 4 0 0 1 7.5-2M12 14v3",
  eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M6 9l6 6 6-6",
  check: "M4 12l5 5L20 6",
  warning: "M12 3l10 18H2zM12 9v5M12 17h.01",
  share: "M8 12l8-5M8 12l8 5M6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  file: "M7 3h7l5 5v13H7zM14 3v5h5",
  folder: "M3 6h6l2 2h10v11H3z",
  compress: "M4 9h6V3M20 15h-6v6M10 9L3 2M14 15l7 7",
  watermark: "M4 17c3-6 6 2 9-2s5 1 7-2M4 7h16",
  numbers: "M4 6h6M7 6v12M14 8h6M14 12h6M14 16h6",
  header: "M4 4h16v5H4zM4 13h16M4 17h10",
  ocr: "M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M8 9h8M8 12h8M8 15h5",
  compare: "M4 5h7v14H4zM13 5h7v14h-7zM8 9h3M13 9h3M8 13h3M13 13h3",
  metadata: "M4 5h16v14H4zM8 9h8M8 12h8M8 15h4",
  link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  zoomIn: "M11 8v6M8 11h6M20 20l-4.5-4.5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0z",
  zoomOut: "M8 11h6M20 20l-4.5-4.5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0z",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  panel: "M4 4h16v16H4zM15 4v16",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12l2-1-1-3 2-2 3 1 1-2h2l1 2 3-1 2 2-1 3 2 1v2l-2 1 1 3-2 2-3-1-1 2h-2l-1-2-3 1-2-2 1-3-2-1z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  info: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  book: "M4 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4zM20 4h-3a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h3z",
  signature: "M4 17c3 0 4-8 6-8s1 6 3 6 3-3 5-3 2 2 3 2M4 21h16",
};

export function Icon({ name, className = "h-4 w-4", sw = 1.7 }) {
  const path = ICONS[name] || ICONS.file;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const VARIANTS = {
  primary: "border-[#f84f63] bg-[#f84f63] text-[#081f35] hover:bg-[#ff6377]",
  secondary: "border-[#2d5871] bg-[#103a55] text-[#e6f3f4] hover:border-[#f84f63]/70 hover:bg-[#164560]",
  ghost: "border-transparent bg-transparent text-[#b8d2d8] hover:bg-white/5 hover:text-white",
  danger: "border-[#f84f63]/60 bg-[#f84f63]/10 text-[#ff9eaa] hover:bg-[#f84f63]/20",
  teal: "border-[#3a8f8a] bg-[#174d51] text-[#c8f0e8] hover:bg-[#1d5c60]",
};

export function Btn({ children, variant = "secondary", size = "md", className = "", icon, ...props }) {
  return (
    <button
      type="button"
      className={cls(
        "inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        VARIANTS[variant] || VARIANTS.secondary,
        className,
      )}
      {...props}
    >
      {icon ? <Icon name={icon} className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} /> : null}
      {children}
    </button>
  );
}

export function Fld({ label, hint, children, className = "" }) {
  return (
    <label className={cls("block", className)}>
      <span className={LABEL}>{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-4 text-[#7f9dab]">{hint}</span> : null}
    </label>
  );
}

export function Section({ title, hint, right, children, className = "" }) {
  return (
    <section className={cls(CARD, "p-3.5", className)}>
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-white">{title}</h3>
          {hint ? <p className="mt-0.5 text-[11px] leading-4 text-[#8faebb]">{hint}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Chip({ children, tone = "muted", className = "" }) {
  const tones = {
    muted: "border-[#2d5871] bg-[#103a55] text-[#a9c5cd]",
    coral: "border-[#f84f63]/40 bg-[#f84f63]/10 text-[#ffb3bc]",
    teal: "border-[#3a8f8a]/50 bg-[#174d51] text-[#c8f0e8]",
  };
  return (
    <span className={cls("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Empty({ children }) {
  return (
    <div className="rounded-lg border border-dashed border-[#2d5871] px-3 py-4 text-center text-xs leading-5 text-[#8faebb]">
      {children}
    </div>
  );
}

export function Toggle({ label, checked, onChange }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#2d5871] bg-[#103a55] px-3 py-2">
      <span className="text-xs text-[#c9dfe3]">{label}</span>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#f84f63]" />
    </label>
  );
}
