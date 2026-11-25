"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ImageEditor from "./ImageEditor";
import PdfEditor from "./PdfEditor";
import TourGuide from "./TourGuide";
import SectionPdfEditor from "./SectionPdfEditor";
import {   useLayoutEffect } from "react";
import { createPortal } from "react-dom";

/* ------------------------------------------------------------------ */
/*  Design tokens (from the dark-technical login design)               */
/*  page #0a2744 · panel #16405c · card #0e3250 · field #16415f        */
/*  border #2f5b75 · coral #f84f63 · text #f3f8f7 · muted #9fb9c4      */
/* ------------------------------------------------------------------ */

const MATERIAL_IDS = new Set(["material", "fu", "fy", "young", "nu", "rho"]);
const DRAFT_KEY = "reportgenix-draft-v2";
const SIDEBAR_KEY = "rg-sidebar-collapsed";
const MEDIA = { files: {}, originals: {}, editorStates: {} };
const WORK = { data: null };
const LEGACY_MEDIA_DB_NAME = "reportgenix-media-v1";
const LEGACY_MEDIA_CLEANED_KEY = "reportgenix-media-v1-removed";
let navigationMedia = { files: {}, originals: {}, editorStates: {}, extraImages: {}, removedSchemaImages: {} };

const removeLegacyMediaDatabase = () => {
  try {
    if (!window.indexedDB || window.localStorage.getItem(LEGACY_MEDIA_CLEANED_KEY)) return;
    const request = window.indexedDB.deleteDatabase(LEGACY_MEDIA_DB_NAME);
    request.onsuccess = () => window.localStorage.setItem(LEGACY_MEDIA_CLEANED_KEY, "1");
    request.onerror = () => { /* retry on the next application load */ };
    request.onblocked = () => { /* another old tab still has the database open */ };
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
};

const stripStaleBodies = (data) =>
  Object.fromEntries(
    Object.entries(data || {}).filter(([key, value]) => !(key.startsWith("body__") && /\[\s[^\]]+\s\]/.test(String(value))))
  );

const joinList = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

// "AS4100-1998" / "AS 4100" + edition 1998  ->  "AS 4100:1998"; other codes (e.g. "ADR 62/02") are kept as they are.
const shortStandardName = ({ code, year }) => {
  const m = code.match(/^AS\s*(\d{3,4})(?:\s*[-:.]\s*(\d{4}))?$/i);
  if (!m) return code;
  const yr = m[2] || year;
  return `AS ${m[1]}${yr ? `:${yr}` : ""}`;
};

// "1) **ADR 62/02 –** Australian Design Rules 62/02 – Mechanical Connections Between Vehicles – 2007."
const standardListLine = (item, index) => {
  const title = item.title.replace(/[.\s]+$/, "");
  if (!title) return `${index + 1}) **${item.code}**`;
  const showYear = item.year && !item.code.includes(item.year) && !title.includes(item.year);
  return `${index + 1}) **${item.code} –** ${title}${showYear ? ` – ${item.year}` : ""}.`;
};

// Everything the Background / Conclusion wording needs from the Summary of Compliance and the project fields.
function buildNarrativeContext({ rows = [], catalog = [], reportRows = [], general = [] }) {
  const list = [];
  const seen = new Set();
  const add = (item) => {
    const code = String(item?.code || "").trim();
    if (!code || seen.has(code.toLowerCase())) return;
    seen.add(code.toLowerCase());
    list.push({ code, year: String(item.edition_year || "").trim(), title: String(item.title || "").trim() });
  };
  rows.forEach((row) => {
    if (!(row.picked?.length || row.standard || row.requirement)) return;
    const entry = catalog.find((item) => String(item.id) === String(row.standardId));
    if (entry) add(entry);
    else if (row.manual?.code) add({ code: row.manual.code, edition_year: row.manual.edition_year, title: row.manual.standard_title });
  });
  if (!list.length) {
    // Catalog not loaded yet: fall back to the label shown in the Summary of Compliance.
    reportRows.forEach((row) => add({ code: String(row?.standard || "").replace(/^standard\s*:\s*/i, "").replace(/\s*[-–—]\s*\d+(?:\.\d+)+.*$/, "") }));
  }
  const adr = list.filter((item) => /^ADR/i.test(item.code));
  const clientField = general.find((field) => /client|customer|company/i.test(`${field.id} ${field.label || ""}`));
  return {
    standardsText: joinList(list.map(shortStandardName)),
    adrText: joinList((adr.length ? adr : list).map(shortStandardName)),
    standardsList: list.map(standardListLine).join("\n"),
    clientKey: clientField?.id || "",
  };
}

const STANDARD_SECTION_NARRATIVES = [
  {
    match: (title) => /background|scope/i.test(title),
    text: `This report has been prepared for **[ Client name ]** to evaluate the structural integrity of the **[ Project name ]**. Structural analysis has been carried out for the newly developed trailer chassis and its internal load-carrying members. The trailer has been certified as a Dual Axle Trailer rated for [ ATM ] kg ATM.

The scope of work undertaken by CSA Engineering includes:

- Performing **Finite Element Analysis (FEA)** on Dual Axle Trailer stress distribution, structural strength.
- Verifying compliance with safety and performance criteria, ensuring durability and operational efficiency.
- Standards referred: The scope of this assessment is limited to the following standards:
[ Standards list ]`,
  },
  {
    match: (title) => /conclusion/i.test(title),
    text: `The structural assessment of the **[ ATM ] kg ATM** trailer was carried out in accordance with the requirements of **[ Standards ]**.

**This assessment assumes that the trailer is in a new condition with no material degradation, manufacturing defects, or damage.** Exposure to environmental and service-related effects, such as corrosion, wear, or mechanical damage, may significantly reduce the structural capacity of the trailer and its ability to safely support the rated ATM.

The assessment included static and dynamic load cases in accordance with [ ADR standards ] to evaluate the structural response of the trailer, including stress distribution, fatigue performance, and the effects of braking. The applied loading and boundary conditions were selected to represent the actual loading conditions of the trailer, including load transfer through the coupling connection and suspension mounting locations

The results demonstrate that the assessed components satisfy the applicable strength and fatigue requirements of [ Standards ] for a [ ATM ] kg ATM trailer.

This assessment is limited to the standards and requirements specified in Chapter 2 – Summary of Compliance.

The periodic inspection and maintenance should be undertaken, and a structural safety reassessment should be conducted if material degradation or damage is identified to ensure continued compliance with the applicable design requirements.`,
  },
  {
    match: (title) => /geometry/i.test(title),
    text: `ATT has provided the required 3D geometric data that was required for the structural analysis of the trailer. Shown following are the dimensions of the major structural members of the trailer which was used for the analysis.

Overall length: [ Overall length ] mm
Overall width: [ Overall width ] mm
Coupling to suspension: [ Distance coupling to suspension ] mm`,
  },
  {
    match: (title) => /requirements/i.test(title),
    text: `The following requirements apply for the trailer structural compliance as selected in the Summary of Compliance.

1.
2.
3.
4.
5.
6.
7.
8.`,
  },
  {
    match: (title) => /pre.?processing|analysis.*data|material.*meshing/i.test(title),
    text: `The trailer is analyzed using the finite element analysis technique. The software used for analysis is ANSYS Workbench which is used in the automotive industry for over a decade. 3D elements have been used in modelling as these are the most appropriate for static structural analysis.

Material
The material used for the analysis with the following mechanical properties is given in the below table.

Meshing
The fine mesh was created with the number of nodes as [ Mesh nodes ] and the number of elements as [ Mesh elements ]. Shown below are some images of the finite element model that was used for the analysis.`,
  },
  {
    match: (title) => /analysis\s*1|longitudinal tension/i.test(title),
    text: `ANALYSIS 1 (ADR 62/02- 14.2.1.1.1) - Longitudinal Tension and Compression

Trailer restraint and the force applied as shown in the below image. The applied force is [ 1.5 x 9.81 x ATM ] N as per clause 14.2.1.1.1 of ADR 62/02 i.e., 1.5 x 9.81 x [ ATM ] kg, applied on the coupling holes in the longitudinal direction. All hanger holes faces are fixed in all DOF.

As per the result shown in the stress distribution plot, neglecting local stresses, the max stress of [ stress ] MPa was found on the Drawbar, which is compared with the yield strength of material [ Material ] which is [ Yield strength ] MPa.

As shown above, the following is the deformation of the structure under the Analysis 1 loading condition. The maximum deformation is [ deformation ] mm.`,
  },
  {
    match: (title) => /analysis\s*2|transverse thrust/i.test(title),
    text: `ANALYSIS 2 (ADR 62/02- 14.2.1.2.1) - Transverse Thrust

Trailer restraint and the force applied as shown in the below image. The applied force is [ 0.5 x 9.81 x ATM ] N as per clause 14.2.1.2.1 of ADR 62/02 i.e., 0.5 x 9.81 x [ ATM ] kg, applied on the coupling holes in the transverse direction. All hanger holes faces are fixed in all DOF.

As per the result shown in the stress distribution plot, neglecting local stresses, the max stress of [ stress ] MPa was found on the Hanger, which is compared with the yield strength of material [ Material ] which is [ Yield strength ] MPa.

As shown above, the following is the deformation of the structure under the Analysis 2 loading condition. The maximum deformation is [ deformation ] mm.`,
  },
  {
    match: (title) => /analysis\s*3|vertical tension/i.test(title),
    text: `ANALYSIS 3 (ADR 62/02- 14.2.1.3.1) - Vertical Tension and Compression

Trailer restraint and the force applied as shown in the below image. The applied force is [ 0.5 x 9.81 x ATM ] N as per clause 14.2.1.3.1 of ADR 62/02 i.e., 0.5 x 9.81 x [ ATM ] kg, applied on the coupling holes in the vertical direction (with an equal downward force on the chassis). All hanger holes faces are fixed in all DOF.

As per the result shown in the stress distribution plot, neglecting local stresses, the max stress of [ stress ] MPa was found on the Chassis, which is compared with the yield strength of material [ Material ] which is [ Yield strength ] MPa.

As shown above, the following is the deformation of the structure under the Analysis 3 loading condition. The maximum deformation is [ deformation ] mm.`,
  },
  {
    match: (title) => /analysis\s*4|drawbar dynamic/i.test(title),
    text: `ANALYSIS 4 (ADR 62/02- 14.2.2.1) - Drawbar Dynamic Test

The D-value for the trailer is [ D-value ] kN. The force applied is 0.6 x Coupling D-value = 0.6 x [ D-value ] x 103 = [ force ] N.

D-value for this trailer is calculated as shown:
DC = g . (T x C)/(T + C) (from AS2213.4:2008- 5.1)
Here, T = maximum design total mass in tonnes of the towing vehicle = 2 t
C = mass in tonnes transmitted to the ground by the axle of the centre-axle trailer loaded to its maximum design total mass = [ ATM/1000 ] t
Therefore, DC = 9.81 x (2 x [ C ])/(2 + [ C ]) = [ D-value ] kN

As per result, neglecting local stress the max stress induced in the drawbar of the trailer is [ stress ] MPa, which is lower than the allowable yield limit of [ Yield strength ] MPa. The fatigue limit of 2 million cycles for [ Material ] material as per AS4100-1998, clause 11.6, is 82 MPa. [ verdict ]

As shown above, the following is the deformation of the structure under the Analysis 4 loading condition. The maximum deformation is [ deformation ] mm.`,
  },
  {
    match: (title) => /analysis\s*5|structural strength/i.test(title),
    text: `ANALYSIS 5 (AS4100-1998 2016) - Structural strength of the trailer

For [ ATM ]kg ATM was used for this load case in the chassis. The structural members of the trailer are analyzed with 1G vertical load & 1G Horizontal load applied simultaneously to check the structural integrity of the trailer as per AS 4100-1998.

As shown below following is the distributed loading applied to the trailer and the restraints. This loading is the worst-case scenario in practical application. 1G vertical load = [ load ] N; total forward & downward force (resultant of 1G vertical and 1G horizontal) = [ load ] N; braking force (0.8 x 9.81 x ATM) = [ load ] N.

As per the result shown in the stress distribution plot, neglecting local stresses, the max stress of [ stress ] MPa was found on the Chassis, which is compared with the yield strength of material [ Material ] which is [ Yield strength ] MPa.

As shown above, the following is the deformation of the structure under the Analysis 5 loading condition. The maximum deformation is [ deformation ] mm.`,
  },
  {
    match: (title) => /analysis\s*6|safety chain/i.test(title),
    text: `ANALYSIS 6 (ADR 62/02- 14.4) - 'Drawbar' Safety Chain Attachment Points

The chain will be fitted on either side of the center line of the drawbar, which satisfies ADR62/02 - 14.4.1. The longitudinal tension of 9.81 x 'ATM' kg is [ force ] N (vertical tension 0.5 x 9.81 x 'ATM' = [ force ] N). As 2 bolt(s) will be supporting the safety chain, the force per bolt is [ force ] N. The plate thickness is 10mm.

The compressive (bearing) stress induced per bolt = longitudinal force per bolt / (thickness x hole clearance) = [ force ] / (10 x 15) = [ stress ] MPa
[ verdict ]`,
  },
  {
    match: (title) => /analysis\s*7|coupling/i.test(title),
    text: `ANALYSIS 7 - Coupling

The pulling force at 1.5G (1.5 x 9.81 x 'ATM' kg) is [ force ] N. As there are 4 bolts, this force per bolt is [ force ] N. The thickness of the coupling plate is 6 mm and the bolt size is M14.

The compressive stress induced per bolt = [ force ] / (Plate thickness x Hole clearance) = [ force ] / (6 x 15) = [ stress ] MPa
[ verdict ]`,
  },
];


function buildDynamicAnalysisHeading(row, number) {
  const standard = String(row?.standard || "").trim().replace(/^standard\s*:\s*/i, "");
  const requirement = String(row?.requirement || "").trim().replace(/\r\n/g, "\n");
  const lines = requirement.split("\n").map((line) => line.trim()).filter(Boolean);

  // Prefer a clause number from the requirement; only fall back to the
  // standard label if the user entered the clause identifier there.
  const clausePattern = /\b(?:clause\s*)?(\d+(?:\.\d+)+)\b/i;
  const clauseMatch = requirement.match(clausePattern) || standard.match(clausePattern);
  const clauseNumber = clauseMatch?.[1] || "";

  let description = "";
  for (const line of lines) {
    let candidate = line
      .replace(/^\s*(?:clause\s*)?\d+(?:\.\d+)+\s*[:\-–—.)]?\s*/i, "")
      .replace(/^\s*(?:ADR\s*62\/02|AS\s*4100(?:-\d{4})?)\s*[-:–—]?\s*/i, "")
      .replace(/^\s*[-:–—]\s*/, "")
      .trim();
    if (candidate && !/^(?:standard|selected standard|selected clause requirement)\s*:/i.test(candidate)) {
      description = candidate;
      break;
    }
  }

  const standardLabel = standard || "";
  const standardAndClause = standardLabel
    ? `${standardLabel}${clauseNumber ? `- ${clauseNumber}` : ""}`
    : clauseNumber;

  if (standardAndClause && description) {
    return `5.${number} ANALYSIS ${number} (${standardAndClause}) - ${description}`;
  }
  if (standardAndClause) return `5.${number} ANALYSIS ${number} (${standardAndClause})`;
  if (description) return `5.${number} ANALYSIS ${number} - ${description}`;
  return `5.${number} ANALYSIS ${number}`;
}

function resolveCalculationTemplate(row) {
  const source = `${row?.standard || ""} ${row?.requirement || ""}`.toLowerCase();
  if (/14\.2\.1\.1\.1|longitudinal tension/.test(source)) return "a1";
  if (/14\.2\.1\.2\.1|transverse thrust/.test(source)) return "a2";
  if (/14\.2\.1\.3\.1|vertical tension/.test(source)) return "a3";
  if (/14\.2\.2\.1|drawbar dynamic|d-value/.test(source)) return "a4";
  if (/as\s*4100|structural strength/.test(source)) return "a5";
  if (/14\.4(?:\.1)?|safety chain/.test(source)) return "a6";
  if (/analysis\s*7|coupling attachment|coupling plate|coupling bolts/.test(source)) return "a7";
  return "";
}

function getStandardSectionNarrative(section, data = {}, ctx = {}) {
  const title = String(section?.title || "");
  if (section?.dynamicAnalysis) {
    const standard = section.complianceStandard ? `Standard: ${section.complianceStandard}\n\n` : "";
    return `${standard}${section.complianceRequirement || "Add analysis details for this selected compliance clause."}`;
  }
  const text = STANDARD_SECTION_NARRATIVES.find((entry) => entry.match(title))?.text || "";
  if (!text || /^requirements$/i.test(title)) return "";
  const id = section?.id || "";
  const n = /^a(\d)$/.test(id) ? id.slice(1) : "";
  const atm = parseFloat(data.atm);
  const hasAtm = Number.isFinite(atm);
  const fmt = (v, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  const T = parseFloat(data.tow_mass || 2);
  const C = hasAtm ? atm / 1000 : null;
  const dc = hasAtm && T ? (9.81 * T * C) / (T + C) : null;
  const map = {
    "ATM": data.atm,
    "Material": data.material,
    "Yield strength": data.fy,
    "stress": n && data[`a${n}_stress`],
    "deformation": n && data[`a${n}_def`],
    "Overall length": data.length_mm,
    "Overall width": data.width_mm,
    "Distance coupling to suspension": data.susp_mm,
    "Mesh nodes": data.nodes,
    "Mesh elements": data.elements,
    "1.5 x 9.81 x ATM": hasAtm ? fmt(1.5 * 9.81 * atm) : "",
    "0.5 x 9.81 x ATM": hasAtm ? fmt(0.5 * 9.81 * atm) : "",
    "ATM/1000": hasAtm ? String(C) : "",
    "C": hasAtm ? String(C) : "",
    "D-value": dc ? dc.toFixed(3) : "",
    "Project name": String(data.project_name || "").trim(),
    "Client name": String((ctx.clientKey && data[ctx.clientKey]) || data.client_name || data.client || data.customer || "").trim(),
    "Standards": ctx.standardsText,
    "ADR standards": ctx.adrText,
    "Standards list": ctx.standardsList,
  };
  return text.replace(/\[ ([^\]]+) \]/g, (whole, key) => {
    const v = map[key];
    return v !== undefined && v !== null && String(v).trim() !== "" ? String(v) : whole;
  });
}

// Sections whose wording is sent to the PDF from this template (the backend default has no client / project / standards).
const NARRATIVES_SENT_TO_REPORT = /background|scope|conclusion/i;

function applyStandardNarratives(data, sections, ctx) {
  const next = { ...data };
  sections.forEach((section) => {
    if (section.dynamicAnalysis || !NARRATIVES_SENT_TO_REPORT.test(String(section.title || ""))) return;
    const key = `body__${section.id}`;
    if (typeof next[key] === "string" && next[key] !== "") return; // the user's own wording always wins
    const text = getStandardSectionNarrative(section, data, ctx);
    if (text) next[key] = text;
  });
  return next;
}


const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');

@keyframes rg-gradient-drift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
@keyframes rg-soft-glow {
  0%, 100% { box-shadow: 0 0 0 rgba(248,79,99,0); }
  50% { box-shadow: 0 10px 34px rgba(248,79,99,.08); }
}
@keyframes rg-fade-up {
  from { opacity: 0; transform: translateY(9px); }
  to { opacity: 1; transform: translateY(0); }
}
.rg {
  font-family: 'Poppins', ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  background-image:
    radial-gradient(ellipse at 12% 0%, rgba(41,111,145,.20), transparent 42%),
    radial-gradient(ellipse at 92% 18%, rgba(248,79,99,.075), transparent 34%),
    linear-gradient(135deg, #0a2744, #0b2d4b 48%, #0a2744);
  background-size: 150% 150%;
  animation: rg-gradient-drift 22s ease-in-out infinite;
}
.rg *:focus-visible { outline: 2px solid #f84f63; outline-offset: 2px; }
.rg select { color-scheme: dark; }
.rg button, .rg a, .rg input, .rg textarea, .rg select {
  transition: color .2s ease, background-color .2s ease, border-color .2s ease,
    box-shadow .2s ease, transform .2s ease, opacity .2s ease;
}
.rg button:not(:disabled):hover { filter: brightness(1.07); }
.rg button:not(:disabled):active { transform: translateY(1px) scale(.985); }
.rg a:hover { text-decoration-color: rgba(248,79,99,.65); }
.rg section.rounded-2xl, .rg aside.rounded-2xl {
  background-image: linear-gradient(145deg, rgba(255,255,255,.035), transparent 48%);
  box-shadow: 0 12px 34px rgba(0,0,0,.10);
}
.rg .rg-dashboard-card { animation: rg-fade-up .45s both; }
.rg .rg-dashboard-card:hover {
  transform: translateY(-4px);
  border-color: rgba(248,79,99,.65);
  box-shadow: 0 16px 36px rgba(0,0,0,.22), 0 0 24px rgba(248,79,99,.08);
}
.rg input:focus, .rg textarea:focus, .rg select:focus {
  box-shadow: 0 0 0 3px rgba(248,79,99,.12);
}
@media (prefers-reduced-motion: reduce) {
  .rg, .rg *, .rg *::before, .rg *::after {
    transition: none !important;
    animation: none !important;
    scroll-behavior: auto !important;
  }
}
`;

const LABEL = "mb-1.5 block text-xs font-medium text-[#b9d0d8]";
const INPUT =
  "w-full rounded-md border border-[#2f5b75] bg-[#16415f] px-3.5 py-3 text-sm text-white placeholder:text-[#8fa9b5] outline-none transition focus:border-[#f84f63] focus:ring-2 focus:ring-[#f84f63]/25 disabled:opacity-60 read-only:opacity-75";
const CARD = "rounded-2xl border border-[#2a5068] bg-[#0e3250] p-5 sm:p-7";
const INSET = "rounded-xl border border-[#2f5b75]/50 bg-[#0a2744]/70 p-4";
const EYEBROW = "text-sm font-medium text-[#f84f63]";

function messageFor(response) {
  return response
    .json()
    .then((body) => body.detail || body.message || "Request failed.")
    .catch(() => "Request failed.");
}

function Shell({ children }) {
  return (
    <div className="rg min-h-screen bg-[#0a2744] text-[#f3f8f7]">
      <style>{GLOBAL_CSS}</style>
      {children}
    </div>
  );
}

function ActionButton({ children, variant = "primary", className = "", ...props }) {
  const styles = {
    primary: "bg-[#f84f63] text-[#0a1f36] hover:bg-[#ff667a]",
    secondary: "border border-[#2f5b75] bg-[#16415f] text-[#f3f8f7] hover:bg-[#1c4d6f]",
    ghost: "border border-[#2f5b75] bg-transparent text-[#c6dce2] hover:bg-white/5",
  };
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Labeled({ label, className = "", children }) {
  return (
    <label className={`block ${className}`}>
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

function Field({ field, value, onChange, readOnly = false }) {
  const label = `${field.label}${field.unit ? ` (${field.unit})` : ""}`;
  if (field.type === "textarea") {
    return (
      <Labeled label={label}>
        <textarea className={`${INPUT} min-h-28 resize-y`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} />
      </Labeled>
    );
  }
  if (field.type === "select") {
    return (
      <Labeled label={label}>
        <select className={INPUT} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={readOnly}>
          {field.opts.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </Labeled>
    );
  }
  return (
    <Labeled label={label}>
      <input
        className={INPUT}
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        step={field.type === "number" ? "any" : undefined}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
      />
    </Labeled>
  );
}

/* ------------------------------------------------------------------ */
/*  Login / sign up                                                    */
/* ------------------------------------------------------------------ */

const AUTH_INPUT =
  "w-full rounded-md border border-[#2f5b75] bg-[#153a57] px-5 py-4 text-base text-white placeholder:text-[#8fa9b5] outline-none transition focus:border-[#f84f63] focus:ring-2 focus:ring-[#f84f63]/25";
const AUTH_LABEL = "mb-2 block text-sm font-medium text-[#f84f63]";

function LoginScreen({ authMode, setAuthMode, authForm, setAuthForm, submit, status, busy, onForgot }) {
  const signup = authMode === "signup";
  const [show, setShow] = useState(false);
  const set = (key) => (event) => setAuthForm((form) => ({ ...form, [key]: event.target.value }));

  return (
    <Shell>
      <main className="grid min-h-screen lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:gap-6 lg:p-6 xl:p-9">
        {/* Left: form */}
        <section className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-[7%] lg:py-8">
          <div className="mx-auto w-full max-w-[480px] lg:mx-0 lg:max-w-[520px]">
            {/* compact brand shown only when the right panel is hidden */}
            <div className="mb-10 flex items-center gap-3 lg:hidden">
              <img src="/csa_logo.webp" alt="CSA Engineering" className="h-12 w-auto object-contain" />
              <span className="border-l border-[#2f5b75] pl-3 text-lg font-semibold">ReportGenix</span>
            </div>

            <h1 className="text-3xl font-normal tracking-tight sm:text-4xl xl:text-[2.6rem] xl:leading-tight">
              {signup ? "Create your account" : "Login to your account"}
            </h1>

            <div className="mt-8 grid grid-cols-2 rounded-md bg-[#16405c] p-1.5 text-center text-base font-medium sm:mt-10" role="tablist">
              {[["login", "Login"], ["signup", "Sign up"]].map(([mode, text]) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={authMode === mode}
                  onClick={() => setAuthMode(mode)}
                  className={`rounded px-3 py-3 transition ${authMode === mode ? "bg-[#f84f63] font-semibold text-[#0a1f36]" : "text-[#e6f1f0] hover:bg-white/5"}`}
                >
                  {text}
                </button>
              ))}
            </div>

            <h2 className="mt-12 text-3xl font-normal sm:text-4xl">{signup ? "Get started" : "Welcome back"}</h2>
            <p className="mt-2 text-sm text-[#a9c1ca]">{signup ? "Enter your details to create an account." : "Enter your details to log in."}</p>

            <form className="mt-9 space-y-6" onSubmit={submit} autoComplete="off">
              {signup && (
                <label className="block">
                  <span className={AUTH_LABEL}>Full name *</span>
                  <input required value={authForm.full_name} onChange={set("full_name")} className={AUTH_INPUT} placeholder="Your full name" autoComplete="name" />
                </label>
              )}
              <label className="block">
                <span className={AUTH_LABEL}>Email address *</span>
                <input required type="email" autoComplete="off" value={authForm.email} onChange={set("email")} className={AUTH_INPUT} placeholder="you@example.com" />
              </label>
              <label className="block">
                <span className={AUTH_LABEL}>Password *</span>
                <div className="relative">
                  <input
                    required
                    minLength={8}
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={authForm.password}
                    onChange={set("password")}
                    className={`${AUTH_INPUT} pr-20`}
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((value) => !value)}
                    className="absolute inset-y-0 right-4 text-sm font-medium text-[#f84f63] hover:text-[#ff8393]"
                    aria-label={show ? "Hide password" : "Show password"}
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              {!signup && (
                <div className="-mt-2 text-right">
                  <button type="button" onClick={onForgot} className="text-sm text-[#c9dede] hover:text-white">
                    Forgot password?
                  </button>
                </div>
              )}

              {status && <p role="alert" className="text-sm text-[#ff8e9c]">{status}</p>}

              <ActionButton type="submit" disabled={busy === "auth"} className="w-full py-4 text-lg">
                {busy === "auth" ? "Please wait…" : signup ? "Create account" : "Log in"}
              </ActionButton>
            </form>
          </div>
        </section>

        {/* Right: brand panel */}
        <aside className="relative hidden min-h-[640px] overflow-hidden rounded-[28px] bg-[#16405c] lg:block">
          <div className="relative z-10 px-10 pt-9 xl:px-14 xl:pt-11">
            <img src="/csa_logo.webp" alt="CSA Engineering" className="h-16 w-auto object-contain xl:h-20" />
            <h2 className="mt-14 text-[clamp(3.2rem,6.2vw,7rem)] font-semibold leading-none tracking-tight text-[#f3f8f7]">ReportGenix</h2>
            <div className="mt-5 flex items-center gap-2 xl:text-xl"><p className="text-lg font-light text-[#a9ccc9] flex items-center gap-2">Reimagining technical reporting with generative AI</p><img src="/ai (3).png" alt="AI" className="h-9 w-auto opacity-80" /></div>
          </div>
          <img
            src="/fea-trailer.webp"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 h-[62%] w-full select-none object-cover object-left-top"
          />
        </aside>
      </main>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/*  Material library                                                   */
/* ------------------------------------------------------------------ */

function MaterialEditor({ catalog, mode, setMode, selectedId, setSelectedId, data, setData, materialMeta, setMaterialMeta, status }) {
  const selected = catalog.find((item) => String(item.id) === String(selectedId));
  const num = (id, label, unit) => ({ id, label, unit, type: "number" });
  const materialFields = [
    { id: "material", label: "Material", type: "text" },
    num("fu", "Tensile strength", "MPa"),
    num("fy", "Yield strength", "MPa"),
    num("young", "Young's modulus", "GPa"),
    num("nu", "Poisson's ratio"),
    num("rho", "Density", "kg/m3"),
  ];
  const apply = (material) => {
    setSelectedId(material.id);
    setData((current) => ({
      ...current,
      material: material.grade,
      fu: material.tensile_mpa ?? "",
      fy: material.yield_mpa ?? "",
      young: material.youngs_modulus_gpa ?? "",
      nu: material.poisson_ratio ?? "",
      rho: material.density_kg_m3 ?? "",
    }));
    setMaterialMeta({
      material_type: material.material_type || "",
      category: material.category || "steel",
      source_standard_id: material.source_standard_id || "",
      notes: material.notes || "",
    });
  };
  const meta = (key) => (event) => setMaterialMeta((value) => ({ ...value, [key]: event.target.value }));

  return (
    <section className={CARD}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={EYEBROW}>Material library</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Mechanical properties</h2>
        </div>
        <span className="rounded-full border border-[#77c2bd]/30 bg-[#77c2bd]/10 px-3 py-1 text-xs text-[#bde1dc]">Database linked</span>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-[200px_1fr]">
        <Labeled label="Select from Material">
          <select className={INPUT} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="library">Library</option>
            <option value="manual">Manual / edit</option>
          </select>
        </Labeled>
        {mode === "library" && (
          <Labeled label="Select material grade">
            <select
              className={INPUT}
              value={selectedId}
              onChange={(e) => {
                const next = catalog.find((item) => String(item.id) === e.target.value);
                if (next) apply(next);
              }}
            >
              <option value="">Select a material</option>
              {catalog.map((item) => (
                <option key={item.id} value={item.id}>{item.grade} — {item.material_type}</option>
              ))}
            </select>
          </Labeled>
        )}
      </div>

      {mode === "manual" && (
        <div className={`${INSET} mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3`}>
          <Labeled label="Material type *">
            <input value={materialMeta.material_type} onChange={meta("material_type")} className={INPUT} />
          </Labeled>
          <Labeled label="Category">
            <select value={materialMeta.category} onChange={meta("category")} className={INPUT}>
              <option value="steel">Steel</option>
              <option value="weld_metal">Weld metal</option>
              <option value="bolt">Bolt</option>
            </select>
          </Labeled>
          <Labeled label="Source standard ID">
            <input type="number" value={materialMeta.source_standard_id} onChange={meta("source_standard_id")} className={INPUT} />
          </Labeled>
          <Labeled label="Notes" className="sm:col-span-2 lg:col-span-3">
            <input value={materialMeta.notes} onChange={meta("notes")} className={INPUT} placeholder="Optional material notes" />
          </Labeled>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {materialFields.map((item) => (
          <Field key={item.id} field={item} value={data[item.id]} readOnly={mode === "library"} onChange={(value) => setData((current) => ({ ...current, [item.id]: value }))} />
        ))}
      </div>

      <p className={`mt-4 text-xs ${status?.error ? "text-[#ff8e9c]" : "text-[#9bc8c6]"}`}>
        {status?.text ||
          (mode === "manual"
            ? "Changes save automatically when the material grade, type, and tensile strength are complete."
            : selected
              ? `${selected.notes || selected.material_type} loaded from the materials library.`
              : "Select a material to populate report values.")}
      </p>
    </section>
  );
}

function ClausePicker({ clauses, selectedIds, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const ids = new Set(selectedIds.map(String));
  const term = q.trim().toLowerCase();
  const shown = term
    ? clauses.filter((c) => `${c.clause_no || ""} ${c.title || ""}`.toLowerCase().includes(term))
    : clauses;
  const shownOn = shown.filter((c) => ids.has(String(c.id))).length;
  const allState = shownOn === 0 ? false : shownOn === shown.length ? "all" : "some";

  /* position the panel against the trigger; wider than the trigger, never off-screen, flips up if needed */
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 380), vw - 24);
    const left = Math.max(12, Math.min(r.left, vw - width - 12));
    const below = vh - r.bottom - 12, above = r.top - 12;
    const up = below < 360 && above > below;
    const maxH = Math.max(240, Math.min(up ? above : below, 460));
    setPos({ left, width, maxH, ...(up ? { bottom: vh - r.top + 6 } : { top: r.bottom + 6 }) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, place]);

  useEffect(() => {
    if (!open) { setQ(""); return undefined; }
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const emit = (set) => onChange(clauses.filter((c) => set.has(String(c.id))).map((c) => c.id));
  const toggle = (id) => {
    const next = new Set(ids);
    next.has(String(id)) ? next.delete(String(id)) : next.add(String(id));
    emit(next);
  };
  /* works on the filtered list, so "Select all" while searching only selects the matches */
  const toggleShown = () => {
    const next = new Set(ids);
    if (allState === "all") shown.forEach((c) => next.delete(String(c.id)));
    else shown.forEach((c) => next.add(String(c.id)));
    emit(next);
  };

  const allOn = clauses.length > 0 && clauses.every((c) => ids.has(String(c.id)));
  const summary = ids.size === 0
    ? "Select clauses"
    : allOn ? `All ${clauses.length} clauses selected`
    : `${ids.size} of ${clauses.length} clauses selected`;

  const Box = ({ state }) => (
    <span
      aria-hidden="true"
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition ${
        state ? "border-[#f84f63] bg-[#f84f63] text-[#0a1f36]" : "border-[#4d7690] bg-[#16415f] text-transparent"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        {state === "some" ? <path d="M6 12h12" /> : <path d="M5 12.5l4.5 4.5L19 7.5" />}
      </svg>
    </span>
  );

  const panel = open && pos && typeof document !== "undefined" ? createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Select clauses"
      className="fixed z-[130] flex flex-col overflow-hidden rounded-2xl border border-[#2f5b75] bg-[#0e3250] text-white shadow-[0_18px_50px_rgba(0,0,0,.5)]"
      style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH, fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }}
    >
      {/* search */}
      <div className="shrink-0 border-b border-[#2a5068]/60 p-2.5">
        <div className="flex h-10 items-center gap-2 rounded-lg border border-[#2f5b75] bg-[#0a2744] px-3 text-[#8fa9b5] focus-within:border-[#f84f63]">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" />
          </svg>
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clauses"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#8fa9b5]"
          />
          {q ? <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="text-lg leading-none hover:text-white">×</button> : null}
        </div>
      </div>

      {/* select all + counter */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#2a5068]/60 px-3.5 py-2.5">
        <button type="button" onClick={toggleShown} disabled={!shown.length} className="flex items-center gap-2.5 text-sm font-semibold text-white disabled:opacity-40">
          <Box state={allState} />
          {term ? `Select ${shown.length} match${shown.length === 1 ? "" : "es"}` : "Select all clauses"}
        </button>
        <div className="flex items-center gap-2.5 text-xs text-[#9bbcc0]">
          <span>{ids.size} / {clauses.length}</span>
          {ids.size > 0 ? (
            <button type="button" onClick={() => onChange([])} className="font-bold uppercase text-[#f84f63] hover:underline">Clear</button>
          ) : null}
        </div>
      </div>

      {/* list */}
      <ul
        role="listbox"
        aria-multiselectable="true"
        className="min-h-0 flex-1 overflow-y-auto p-1.5 [scrollbar-color:#3a6a86_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
      >
        {shown.length === 0 && <li className="px-3 py-8 text-center text-xs text-[#9bbcc0]">No clauses match “{q}”.</li>}
        {shown.map((c) => {
          const on = ids.has(String(c.id));
          return (
            <li key={c.id} role="option" aria-selected={on}>
              <button
                type="button"
                onClick={() => toggle(c.id)}
                title={`${c.clause_no ? `${c.clause_no} — ` : ""}${c.title || ""}`}
                className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition ${on ? "bg-[#f84f63]/10" : "hover:bg-white/5"}`}
              >
                <span className="mt-0.5"><Box state={on ? "all" : false} /></span>
                {c.clause_no ? (
                  <span className="mt-0.5 shrink-0 rounded-md bg-[#16415f] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#8ed0c9]">{c.clause_no}</span>
                ) : null}
                <span
                  className="min-w-0 flex-1 text-[13px] leading-5 text-[#d7e9ec]"
                  style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}
                >
                  {c.title}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-[#2a5068]/60 p-2.5">
        <span className="pl-1 text-[11px] text-[#9bbcc0]">{ids.size === 0 ? "Nothing selected" : `${ids.size} selected`}</span>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md bg-[#f84f63] px-4 py-1.5 text-xs font-bold text-[#0a1f36] hover:bg-[#ff667a]">Done</button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${INPUT} flex items-center justify-between gap-2 text-left ${open ? "!border-[#f84f63] ring-2 ring-[#f84f63]/25" : ""} ${ids.size ? "" : "!text-[#8fa9b5]"}`}
      >
        <span className="truncate">{summary}</span>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-[#9bbcc0] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {panel}
    </div>
  );
}
/* ------------------------------------------------------------------ */
/*  Summary of compliance                                              */
/* ------------------------------------------------------------------ */

const newComplianceRow = () => ({
  id: crypto.randomUUID(), source: "library", conformity: "Full Compliance",
  standardId: "", clauseId: "", clauses: [], standard: "", requirement: "",
  manual: { code: "", edition_year: "", standard_title: "", clause_no: "", clause_title: "", requirement_text: "" },
});

function ComplianceEditor({ rows, setRows, catalog, request }) {
  const manualTimers = useRef({});

  const addRow = () =>
    setRows((current) => [
      ...current,
      newComplianceRow(),
    ]);

  const update = (id, patch) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const selectStandard = async (row, standardId) => {
    update(row.id, { standardId, clauseId: "", clauseIds: [], picked: [], clauses: [], standard: "", requirement: "", error: "" });
    if (!standardId) return;
    try {
      const response = await request(`/api/standards/${standardId}/clauses`);
      const result = await response.json();
      update(row.id, { clauses: result.clauses || [] });
    } catch (error) {
      update(row.id, { error: error.message });
    }
  }

  const pickClauses = (row, clauseIds) => {
    const code = catalog.find((item) => String(item.id) === String(row.standardId))?.code || "";
    const set = new Set(clauseIds.map(String));
    const picked = row.clauses
      .filter((c) => set.has(String(c.id)))
      .map((c) => ({
        id: c.id,
        standard: c.summary_standard || `${code} - ${c.clause_no}`,
        requirement: c.summary_requirement || [c.title, c.requirement_text].filter(Boolean).join("\n"),
      }));
    update(row.id, { clauseIds, clauseId: "", picked, standard: "", requirement: "" });
  };

  const saveManual = async (rowId, manual) => {
    try {
      update(rowId, { saveStatus: "Saving to standards library…", saveError: false });
      const response = await request("/api/standards/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manual),
      });
      const payload = await response.json();
      update(rowId, {
        standardId: payload.standard.id,
        clauseId: payload.clause.id,
        standard: payload.clause.summary_standard || [manual.code, manual.clause_no].filter(Boolean).join(" - "),
        requirement: payload.clause.summary_requirement || [manual.clause_title, manual.requirement_text].filter(Boolean).join("\n"),
        saveStatus: "Saved to the standards library.",
      });
    } catch (error) {
      update(rowId, { saveStatus: error.message, saveError: true });
    }
  };

  const manualUpdate = (row, key, value) => {
    const manual = { ...row.manual, [key]: value };
    update(row.id, {
      manual,
      standard: [manual.code, manual.clause_no].filter(Boolean).join(" - "),
      requirement: [manual.clause_title, manual.requirement_text].filter(Boolean).join("\n"),
      saveStatus: "Complete code, edition, standard title, clause number and clause title to save.",
      saveError: false,
    });
    window.clearTimeout(manualTimers.current[row.id]);
    if (manual.code && manual.edition_year && manual.standard_title && manual.clause_no && manual.clause_title) {
      manualTimers.current[row.id] = window.setTimeout(() => saveManual(row.id, manual), 850);
    }
  };

  const removeRow = (id) => {
    if (rows[0]?.id === id) return;
    window.clearTimeout(manualTimers.current[id]);
    setRows((current) => current.filter((item) => item.id !== id));
  };

  return (
    <section className={CARD}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={EYEBROW}>Compliance library</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Summary of compliance</h2>
        </div>
        <ActionButton onClick={addRow} className="w-full sm:w-auto">+ Add standard</ActionButton>
      </div>
      <p className="mb-5 text-sm text-[#b3ced0]">Row 1 is always available for the first standard. Add further rows only when needed.</p>

      <div className="space-y-4">
        {rows.map((row, index) => (
          <div key={row.id} className={INSET}>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-medium text-[#80bfbe]">Row {index + 1}{index === 0 ? " (fixed)" : ""}</span>
              {index === 0 ? <span className="text-xs font-semibold text-[#80bfbe]">Required row</span> : <button onClick={() => removeRow(row.id)} className="text-sm font-semibold text-[#ff8393] hover:text-[#ffb0ba]">Remove</button>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_190px]">
              <Labeled label="Select from Standard">
                <select className={INPUT} value={row.source} onChange={(e) => update(row.id, { source: e.target.value })}>
                  <option value="library">Library</option>
                  <option value="manual">Manual</option>
                </select>
              </Labeled>

              {row.source === "library" ? (
                <>
                  <Labeled label="Standard">
                    <select className={INPUT} value={row.standardId} onChange={(e) => selectStandard(row, e.target.value)}>
                      <option value="">Select a standard</option>
                      {catalog.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.code}{item.edition_year ? ` (${item.edition_year})` : ""} — {item.title}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                  <div className="block">
                    <span className={LABEL}>Clauses</span>
                    <ClausePicker
                      clauses={row.clauses}
                      disabled={!row.standardId}
                      selectedIds={row.clauseIds || (row.clauseId ? [row.clauseId] : [])}
                      onChange={(ids) => pickClauses(row, ids)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <Labeled label="Standard code *">
                    <input value={row.manual.code} onChange={(e) => manualUpdate(row, "code", e.target.value)} className={INPUT} />
                  </Labeled>
                  <Labeled label="Clause number *">
                    <input value={row.manual.clause_no} onChange={(e) => manualUpdate(row, "clause_no", e.target.value)} className={INPUT} />
                  </Labeled>
                </>
              )}

              <Labeled label="Conformity" className="sm:col-span-2 xl:col-span-1">
                <select className={INPUT} value={row.conformity} onChange={(e) => update(row.id, { conformity: e.target.value })}>
                  <option>Full Compliance</option>
                  <option>Partial Compliance</option>
                  <option>Not Compliant</option>
                  <option>Not Assessed</option>
                </select>
              </Labeled>
            </div>

            {row.error && <p className="mt-3 text-xs text-[#ff8e9c]">{row.error}</p>}

            {row.source === "manual" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Labeled label="Edition *">
                  <input value={row.manual.edition_year} onChange={(e) => manualUpdate(row, "edition_year", e.target.value)} className={INPUT} placeholder="e.g. 2002" />
                </Labeled>
                <Labeled label="Standard title *" className="xl:col-span-2">
                  <input value={row.manual.standard_title} onChange={(e) => manualUpdate(row, "standard_title", e.target.value)} className={INPUT} />
                </Labeled>
                <Labeled label="Clause title *">
                  <input value={row.manual.clause_title} onChange={(e) => manualUpdate(row, "clause_title", e.target.value)} className={INPUT} />
                </Labeled>
                <Labeled label="Compliance requirement" className="xl:col-span-2">
                  <input value={row.manual.requirement_text} onChange={(e) => manualUpdate(row, "requirement_text", e.target.value)} className={INPUT} />
                </Labeled>
                <p className={`text-xs sm:col-span-2 xl:col-span-3 ${row.saveError ? "text-[#ff8e9c]" : "text-[#9bc8c6]"}`}>
                  {row.saveStatus || "Manual entries are saved automatically."}
                </p>
              </div>
            )}

            {row.picked?.length > 0 ? (
              <div className="mt-4 space-y-2 rounded-lg border border-[#77c2bd]/20 bg-[#77c2bd]/5 p-3 text-sm">
                <p className="text-xs font-semibold text-[#99cfca]">{row.picked.length} clause{row.picked.length > 1 ? "s" : ""} will be added to the report</p>
                {row.picked.map((p) => (
                  <div key={p.id} className="flex items-start gap-3 border-t border-[#2a5068]/40 pt-2">
                    <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">
                      <p><b className="font-semibold text-[#99cfca]">Standard:</b> {p.standard}</p>
                      <p className="whitespace-pre-line"><b className="font-semibold text-[#99cfca]">Requirement:</b> {p.requirement}</p>
                    </div>
                    <button
                      type="button"
                      title="Remove this clause"
                      aria-label={`Remove clause ${p.standard}`}
                      onClick={() => pickClauses(row, (row.clauseIds || []).filter((id) => String(id) !== String(p.id)))}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#e5334b] text-white transition hover:bg-[#ff4d63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 12h12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : row.standard ? (
              <div className="mt-4 grid gap-3 rounded-lg border border-[#77c2bd]/20 bg-[#77c2bd]/5 p-3 text-sm md:grid-cols-2">
                <p><b className="font-semibold text-[#99cfca]">Standard:</b> {row.standard}</p>
                <p className="whitespace-pre-line"><b className="font-semibold text-[#99cfca]">Requirement:</b> {row.requirement}</p>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Report sections                                                    */
/* ------------------------------------------------------------------ */

function EvidenceThumb({ file, onEdit, onSelectFile, label = "Evidence image" }) {
  const [url, setUrl] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    if (!file) { setUrl(""); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium text-[#8fa9b5]">Evidence image</p>
      <div className="relative">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const nextFile = event.target.files?.[0];
            if (nextFile) onSelectFile(nextFile);
            // Selecting the same file again should still trigger an upload.
            event.target.value = "";
          }}
        />
        {url ? (
          <>
            <img src={url} alt={`${label} preview`} className="h-32 w-full rounded-md border border-[#2f5b75] bg-[#061d31] object-cover" />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md border border-[#2f5b75] bg-[#0a2744]/90 px-2 py-1 text-[10px] font-medium text-[#d4e8e8] hover:border-[#f84f63]"
              aria-label={`Replace ${label}`}
            >
              <Icon name="image" className="h-3.5 w-3.5" />
              Replace
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#f84f63] text-[#0a1f36] shadow hover:bg-[#ff667a]"
              aria-label={`Edit ${label}`}
              title="Edit image"
            >
              <Icon name="edit" className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-32 w-full flex-col items-center justify-center rounded-md border border-dashed border-[#2f5b75]/50 bg-[#061d31]/50 text-xs text-[#8fa9b5] hover:border-[#f84f63] hover:bg-[#f84f63]/5"
          >
            <Icon name="image" className="mb-2 h-5 w-5" />
            No image attached
            <span className="mt-1 rounded border border-[#2f5b75] bg-red-600 px-2 py-0.5 text-[10px] text-white">Upload image</span>
          </button>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ value, fallback, onChange }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Section heading"
        value={value ?? fallback}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
        className="w-full max-w-2xl rounded-md border border-[#f84f63] bg-[#16415f] px-3 py-1 text-2xl font-semibold text-white outline-none"
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      {value || fallback}
      <button
        type="button"
        title="Edit section name"
        aria-label="Edit section name"
        onClick={() => setEditing(true)}
        className="rounded-md p-1.5 text-[#9bbcc0] hover:bg-white/10 hover:text-white"
      >
        <Icon name="edit" className="h-4 w-4" />
      </button>
    </span>
  );
}

function SectionEditor({ section, sections, narrativeCtx, data, setData, files, setFiles, extraImages, setExtraImages, removedSchemaImages, setRemovedSchemaImages, selected, setSelected, children, onOpenImageEditor, editingImage, onFileChange, originals }) {
  const enabled = section.dynamicAnalysis || selected.includes(section.id);
  const headingId = `heading__${section.id}`;
  const bodyKey = `body__${section.id}`;
  const standardText = getStandardSectionNarrative(section, data, narrativeCtx || {});
  const hasOverride = typeof data[bodyKey] === "string" && data[bodyKey] !== "";
  const narrativeRef = useRef(null);
  const router = useRouter();

  const insertNarrative = (before, after = "") => {
    const field = narrativeRef.current;
    const current = hasOverride ? String(data[bodyKey] || "") : standardText;
    const start = field?.selectionStart ?? current.length;
    const end = field?.selectionEnd ?? current.length;
    const selectedText = current.slice(start, end);
    const replacement = `${before}${selectedText || "text"}${after}`;
    const next = `${current.slice(0, start)}${replacement}${current.slice(end)}`;
    setData((currentData) => ({ ...currentData, [bodyKey]: next }));
    requestAnimationFrame(() => {
      if (!field) return;
      field.focus();
      const cursor = start + replacement.length;
      field.setSelectionRange(cursor, cursor);
    });
  };

  const insertNarrativeTable = () => {
    const table = "\n| Item | Description | Value |\n| --- | --- | --- |\n| 1 | Enter description | Enter value |\n| 2 | Enter description | Enter value |\n";
    const field = narrativeRef.current;
    const current = hasOverride ? String(data[bodyKey] || "") : standardText;
    const start = field?.selectionStart ?? current.length;
    const end = field?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${table}${current.slice(end)}`;
    setData((currentData) => ({ ...currentData, [bodyKey]: next }));
  };
  const sectionIds = sections.map((s) => s.id);
  const currentIndex = sectionIds.indexOf(section.id);
  const prevSection = currentIndex > 0 ? sections[currentIndex - 1] : null;
  const nextSection = currentIndex < sectionIds.length - 1 ? sections[currentIndex + 1] : null;
  const goTo = (id) => router.push(`/section/${id}`);
  // Certificate/title/summary-style sections have no designed figure slots
  // and therefore intentionally have no Evidence Images UI.
  const sectionImages = Array.isArray(section.images) ? section.images : [];
  const sectionExtra = extraImages[section.id] || [];
  const visibleSlotsKey = `visible_image_slots__${section.id}`;
  const highestUploadedSchemaSlot = sectionImages.reduce(
    (highest, image, index) => (files[image.id] ? index + 1 : highest),
    0
  );
  // A section begins with one field. "Add Image" reveals the next designed
  // report slot before creating an appended, additional figure.
  const visibleSchemaSlots = sectionImages.length
    ? Math.min(
        sectionImages.length,
        Math.max(1, Number(data[visibleSlotsKey]) || 1, highestUploadedSchemaSlot)
      )
    : 0;
  const allImages = [
    ...sectionImages
      .slice(0, visibleSchemaSlots)
      .filter((img) => !removedSchemaImages[`${section.id}:${img.id}`])
      .map((img) => ({ ...img, source: "schema" })),
    ...sectionExtra.map((img) => ({ ...img, source: "extra" })),
  ];



  return (
    <section className={`overflow-hidden rounded-2xl border ${enabled ? "border-[#2a5068] bg-[#0e3250]" : "border-[#2a5068]/50 bg-[#0b2b47]/60 opacity-70"}`}>

      {enabled && (
        <div className="space-y-5 p-5 sm:p-6">
          {children}

          <div className={INSET}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#83c6c0]">Section narrative &amp; description</p>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => insertNarrative("**", "**")} className="rounded-md border border-[#2f5b75] bg-[#16415f] px-2.5 py-1.5 text-xs font-semibold text-[#d8e9ed] hover:border-[#f84f63]" title="Bold selected text">B</button>
              <button type="button" onClick={() => insertNarrative("*", "*")} className="rounded-md border border-[#2f5b75] bg-[#16415f] px-2.5 py-1.5 text-xs italic text-[#d8e9ed] hover:border-[#f84f63]" title="Italic selected text">I</button>
              <button type="button" onClick={() => insertNarrative("\n- ", "")} className="rounded-md border border-[#2f5b75] bg-[#16415f] px-2.5 py-1.5 text-xs text-[#d8e9ed] hover:border-[#f84f63]">Bullet list</button>
              <button type="button" onClick={insertNarrativeTable} className="rounded-md border border-[#2f5b75] bg-[#16415f] px-2.5 py-1.5 text-xs text-[#d8e9ed] hover:border-[#f84f63]">+ Insert table</button>
              <span className="ml-auto text-[10px] text-[#8fa9b5]">Tables use editable rows and columns in the report</span>
            </div>
            <textarea
              ref={narrativeRef}
              aria-label="Editable report content"
              className={`${INPUT} min-h-[220px] resize-y !text-sm leading-7`}
              value={hasOverride ? data[bodyKey] : standardText}
              onChange={(event) => setData((current) => ({ ...current, [bodyKey]: event.target.value }))}
              placeholder={`Add or replace the standard narrative for ${section.title}…`}
            />
            {hasOverride && (
              <button
                type="button"
                onClick={() => setData((current) => { const next = { ...current }; delete next[bodyKey]; return next; })}
                className="mt-2 rounded-md border border-[#2f5b75] px-3 py-1.5 text-xs font-semibold text-[#c8dfe1] hover:bg-white/5"
              >
                Reset to standard wording
              </button>
            )}
          </div>

          {section.dynamicAnalysis && section.calculationTemplate && (
            <div className="rounded-lg border border-[#77c2bd]/25 bg-[#77c2bd]/5 px-3.5 py-3 text-xs leading-6 text-[#c4e1df]">
              <p className="font-semibold text-[#8fd0c8]">Calculation inputs for this selected clause</p>
              <p>
                {({
                  a1: "Enter the maximum stress, stress location and deformation below. The applied longitudinal force is calculated from the ATM value in Project details.",
                  a2: "Enter the maximum stress, stress location and deformation below. The transverse thrust is calculated from the ATM value in Project details.",
                  a3: "Enter the maximum stress, stress location and deformation below. The vertical force is calculated from the ATM value in Project details.",
                  a4: "Confirm the towing vehicle mass and enter the stress and deformation results. The D-value and applied dynamic force are calculated from ATM and towing vehicle mass.",
                  a5: "Enter the stress and deformation results. The vertical, resultant and braking loads are calculated from ATM in Project details.",
                  a6: "Enter plate thickness, hole clearance, bolt count and (if selected) weld details. The chain load, per-bolt force, bearing stress and optional weld capacity are calculated from ATM.",
                  a7: "Enter bolt count, bolt size, plate thickness and hole clearance. The 1.5G pulling force, per-bolt force and bearing stress are calculated from ATM.",
                })[section.calculationTemplate]}
              </p>
              <p className="mt-1 text-[#9fb9c4]">Material and yield strength are taken from the Material library / Project details.</p>
            </div>
          )}

          {allImages.length > 0 && (
            <div className="grid grid-cols-1 gap-4">
              {allImages.map((image) => {
                const isSchema = image.source === "schema";
                const cardKey = isSchema ? `schema_${image.id}` : `extra_${image.id}`;
                const isActive = editingImage?.id === image.id;
                return (
                  <div
                    key={cardKey}
                    className={`relative rounded-xl border border-dashed p-4 ${isActive ? "border-[#f84f63] bg-[#f84f63]/5" : "border-[#2f5b75] bg-[#0a2744]/60"}`}
                  >
                    <EvidenceThumb
                      file={files[image.id]}
                      label={data[`cap__${image.id}`] || image.label || "Image"}
                      onSelectFile={(file) => {
                        // A slot that was hidden by an older saved draft is
                        // restored as soon as a replacement is attached.
                        if (isSchema) {
                          setRemovedSchemaImages((current) => ({ ...current, [`${section.id}:${image.id}`]: false }));
                        }
                        onFileChange(image.id, file);
                      }}
                      onEdit={() =>
                        onOpenImageEditor({ id: image.id, label: data[`cap__${image.id}`] || image.label || "Image" })
                      }
                    />

                    <button
                      type="button"
                      onClick={() => {
                        onFileChange(image.id, null);
                        if (isSchema) {
                          setRemovedSchemaImages((current) => ({
                            ...current,
                            [`${section.id}:${image.id}`]: true,
                          }));
                        } else {
                          setExtraImages((current) => ({
                            ...current,
                            [section.id]: (current[section.id] || []).filter((item) => item.id !== image.id),
                          }));
                        }
                      }}
                      className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#2f5b75] bg-[#0a2744] text-lg leading-none text-[#ff9da9] hover:border-[#ff8e9c] hover:bg-[#ff8e9c]/20 hover:text-white"
                      aria-label={`Remove ${data[`cap__${image.id}`] || image.label || "evidence image"}`}
                      title="Remove evidence image"
                    >
                      &#215;
                    </button>

                    <Labeled label="Image heading / caption">
                      <input
                        className={INPUT}
                        value={data[`cap__${image.id}`] ?? (isSchema ? image.label : image.label || "")}
                        onChange={(event) => setData((current) => ({ ...current, [`cap__${image.id}`]: event.target.value }))}
                        placeholder="Enter image heading"
                      />
                    </Labeled>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Labeled label="Image position">
                        <select className={INPUT} value={data[`img_align__${image.id}`] ?? "inherit"} onChange={(event) => setData((current) => ({ ...current, [`img_align__${image.id}`]: event.target.value }))}>
                          <option value="inherit">Inherit layout</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                        </select>
                      </Labeled>
                      <Labeled label="Caption placement">
                        <select className={INPUT} value={data[`cap_pos__${image.id}`] ?? "inherit"} onChange={(event) => setData((current) => ({ ...current, [`cap_pos__${image.id}`]: event.target.value }))}>
                          <option value="inherit">Inherit layout</option><option value="above">Above</option><option value="below">Below</option>
                        </select>
                      </Labeled>
                    </div>
                    <Labeled label="Image height (mm)" className="mt-3">
                      <input className={INPUT} type="number" min="20" max="140" value={data[`img_height__${image.id}`] ?? (isSchema ? image.h : 60)} onChange={(event) => setData((current) => ({ ...current, [`img_height__${image.id}`]: event.target.value }))} />
                    </Labeled>
                    {files[image.id] && (
                      <p className="mt-2 break-all text-xs text-[#8fd0c8]">
                        {originals[image.id] ? "Edited in image editor" : `Attached: ${files[image.id].name}`}
                      </p>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addImage}
                className="flex-1 sm:flex-none rounded-md border border-[#2f5b75] bg-transparent text-[#b9d2d3] px-4 py-2 text-sm font-semibold hover:bg-white/5"
              >
                + Add image
              </button>
            </div>
          )}
        </div>
      )}
      <div className="border-t border-[#2a5068]/40 px-5 py-4 mt-6 flex flex-wrap justify-between gap-3 items-center">
        <button
          onClick={() => prevSection && goTo(prevSection.id)}
          disabled={!prevSection}
          className={`flex-1 sm:flex-none rounded-md px-4 py-2 text-sm font-semibold transition ${!prevSection ? "opacity-30 cursor-not-allowed border border-[#2f5b75] bg-transparent text-[#6b7c86]" : "border border-[#f84f63] bg-[#f84f63] text-[#0a1f36] hover:bg-[#ff667a]"}`}
        >
          &#8592; Back
        </button>
        <button
          onClick={() => nextSection && goTo(nextSection.id)}
          disabled={!nextSection}
          className={`flex-1 sm:flex-none rounded-md px-4 py-2 text-sm font-semibold transition ${!nextSection ? "opacity-30 cursor-not-allowed border border-[#2f5b75] bg-transparent text-[#6b7c86]" : "border border-[#f84f63] bg-[#f84f63] text-[#0a1f36] hover:bg-[#ff667a]"}`}
        >
          Next &#8594;
        </button>
      </div>
    </section>
  );
}

const initials = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/* ------------------------------------------------------------------ */
/*  Dashboard                                                          */
/* ------------------------------------------------------------------ */

const ICONS = {
  search: "M21 21l-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  file: "M7 3h7l5 5v13H7zM14 3v5h5",
  image: "M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 3-3 5 5M9 9.5h.01",
  folder: "M3 6h6l2 2h10v11H3z",
  folderPlus: "M3 6h6l2 2h10v11H3zM12 11v6M9 14h6",
  plus: "M12 5v14M5 12h14",
  dots: "M12 5h.01M12 12h.01M12 19h.01",
  copy: "M9 9h11v11H9zM5 15V4h11",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  pin: "M9 3h6l-1 6 3 3H7l3-3zM12 12v9",
  users: "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  building: "M4 21V4h10v17M14 9h6v12M8 8h2M8 12h2M8 16h2M17 13h.01M17 17h.01",
  chevronLeft: "M15 6l-6 6 6 6",
};

function Icon({ name, className = "h-4 w-4", fill = "none", sw = 1.8 }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const STATUS = {
  draft: { label: "Draft", dot: "#8fa9b5" },
  in_review: { label: "In review", dot: "#77c2bd" },
  approved: { label: "Approved & certified", dot: "#6fd08a" },
  archived: { label: "Archived", dot: "#5c7a86" },
};

const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

function makeThumb(file, max = 360) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(""); };
    img.src = url;
  });
}

function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) { const h = Math.floor(s / 3600); return `${h} hour${h > 1 ? "s" : ""} ago`; }
  if (s < 172800) return "yesterday";
  if (s < 604800) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function BlueprintArt() {
  return (
    <svg viewBox="0 0 240 120" className="h-full w-full" fill="none" stroke="#4f81bd" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M30 70 L120 40 L205 58 L112 92 Z" />
      <path d="M30 70 V82 L112 106 V92 M205 58 V70 L112 106" />
      <path d="M120 40 L170 28 L225 44 L205 58" strokeDasharray="4 3" />
      <circle cx="170" cy="62" r="5" />
      <circle cx="188" cy="66" r="5" />
      <path d="M62 60 V80 M96 52 V72" />
    </svg>
  );
}

const Chip = ({ children }) => (
  <span className="rounded bg-[#16415f] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[#8ed0c9]">{children}</span>
);

function StarButton({ r, onUpdate, className = "" }) {
  return (
    <button
      type="button"
      title={r.starred ? "Remove star" : "Star"}
      onClick={(e) => { e.stopPropagation(); onUpdate(r.id, { starred: !r.starred }); }}
      className={`rounded-md bg-[#0a2744]/80 p-2 text-[#f84f63] transition hover:bg-[#16415f] ${className}`}
    >
      <Icon name="star" fill={r.starred ? "currentColor" : "none"} className="h-5 w-5" />
    </button>
  );
}

function CardMenu({ r, folders, open, setMenuId, actions }) {
  const item = "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs text-[#c8dfe1] hover:bg-white/5";
  const head = "px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[.14em] text-[#83c6c0]";
  const done = (on) => (on ? <span className="text-[#6fd08a]">✓</span> : null);
  const run = (fn) => (e) => { e.stopPropagation(); setMenuId(null); fn(); };
  return (
    <div className="relative" data-menu>
      <button
        type="button"
        aria-label="More actions"
        onClick={(e) => { e.stopPropagation(); setMenuId(open ? null : r.id); }}
        className="rounded-md p-1.5 text-[#9bbcc0] hover:bg-white/10 hover:text-white"
      >
        <Icon name="dots" sw={3} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 max-h-80 w-56 overflow-y-auto rounded-xl border border-[#2f5b75] bg-[#0e3250] p-1.5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <button className={item} onClick={run(() => actions.open(r.id))}>Open report</button>
          <button className={item} onClick={run(() => actions.duplicate(r.id))}>Duplicate</button>
          <button className={item} onClick={run(() => actions.update(r.id, { pinned: !r.pinned }))}>{r.pinned ? "Unpin" : "Pin"}</button>
          <p className={head}>Status</p>
          {Object.entries(STATUS).map(([key, s]) => (
            <button key={key} className={item} onClick={run(() => actions.update(r.id, { status: key }))}>
              <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: s.dot }} />{s.label}</span>
              {done(r.status === key)}
            </button>
          ))}
          <p className={head}>Folder</p>
          <button className={item} onClick={run(() => actions.update(r.id, { folder: "" }))}>No folder {done(!r.folder)}</button>
          {folders.map((f) => (
            <button key={f} className={item} onClick={run(() => actions.update(r.id, { folder: f }))}>{f} {done(r.folder === f)}</button>
          ))}
          <div className="my-1 border-t border-[#2a5068]/60" />
          <button className={`${item} text-[#ff8e9c]`} onClick={run(() => actions.remove(r.id))}>Delete</button>
        </div>
      )}
    </div>
  );
}

function ReportCard({ r, isActive, menuOpen, setMenuId, folders, actions }) {
  const st = STATUS[r.status] || STATUS.draft;
  return (
    <article className="group relative flex flex-col rounded-2xl border border-[#2a5068] bg-[#0e3250] transition hover:border-[#2f5b75]">
      <div className="relative h-44 cursor-pointer overflow-hidden rounded-t-2xl bg-[#0a2744]" onClick={() => actions.open(r.id)}>
        {r.thumb ? (
          <img src={r.thumb} alt="" className="h-full w-full object-contain p-4" />
        ) : (
          <div className="flex h-full items-center justify-center p-6"><BlueprintArt /></div>
        )}
        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          {r.status === "archived" ? <Chip>Archived</Chip> : (<>{r.axle && <Chip>{r.axle}</Chip>}{r.rev && <Chip>Rev {r.rev}</Chip>}</>)}
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-[#0a2744]/70 opacity-0 backdrop-blur-sm transition group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); actions.open(r.id); }}
            className="inline-flex items-center gap-2 rounded-md bg-[#f84f63] px-4 py-2.5 text-sm font-semibold text-[#0a1f36] hover:bg-[#ff667a]"
          >
            <Icon name="edit" /> Open Report
          </button>
          <button
            type="button"
            title="Duplicate"
            onClick={(e) => { e.stopPropagation(); actions.duplicate(r.id); }}
            className="rounded-md border border-[#2f5b75] bg-[#16415f] p-2.5 text-[#c8dfe1] hover:bg-[#1c4d6f]"
          >
            <Icon name="copy" />
          </button>
        </div>
        <StarButton r={r} onUpdate={actions.update} className="absolute right-4 top-4 z-10" />
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[.12em]" style={{ color: st.dot }}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: st.dot }} />
            <span className="truncate">{st.label}</span>
            {isActive && <span className="rounded-full border border-[#f84f63]/50 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-[#f84f63]">Current</span>}
          </span>
          <CardMenu r={r} folders={folders} open={menuOpen} setMenuId={setMenuId} actions={actions} />
        </div>
        <h3 className="mt-3 truncate text-base font-semibold text-white" title={r.title}>{r.title}</h3>
        <p className="mt-1 text-xs text-[#9bbcc0]">Edited {timeAgo(r.updatedAt)} by <span className="text-[#c8dfe1]">{r.editor || "—"}</span></p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#9bbcc0]">
          <span className="flex items-center gap-1.5"><Icon name="doc" /> {r.sections} sections</span>
          <span className="flex items-center gap-1.5"><Icon name="image" /> {r.figures} figures</span>
          {r.pinned && <span className="flex items-center gap-1.5 text-[#77c2bd]"><Icon name="pin" /> Pinned</span>}
          {r.folder && <span className="flex items-center gap-1.5"><Icon name="folder" /> {r.folder}</span>}
        </div>
      </div>
    </article>
  );
}

function ReportRow({ r, isActive, menuOpen, setMenuId, folders, actions }) {
  const st = STATUS[r.status] || STATUS.draft;
  return (
    <div
      onClick={() => actions.open(r.id)}
      className="flex cursor-pointer items-center gap-4 rounded-xl border border-[#2a5068] bg-[#0e3250] px-4 py-3 transition hover:border-[#2f5b75]"
    >
      <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#0a2744]">
        {r.thumb ? <img src={r.thumb} alt="" className="h-full w-full object-contain" /> : <div className="h-full w-full p-1"><BlueprintArt /></div>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{r.title}{isActive && <span className="ml-2 text-[10px] font-medium text-[#f84f63]">Current</span>}</p>
        <p className="mt-0.5 text-xs text-[#9bbcc0]">Edited {timeAgo(r.updatedAt)} by {r.editor || "—"}</p>
      </div>
      <span className="hidden items-center gap-2 text-[11px] font-semibold uppercase tracking-[.12em] sm:flex" style={{ color: st.dot }}>
        <span className="h-2 w-2 rounded-full" style={{ background: st.dot }} />{st.label}
      </span>
      <span className="hidden w-24 text-xs text-[#9bbcc0] md:block">{r.sections} sections</span>
      <span className="hidden w-24 text-xs text-[#9bbcc0] md:block">{r.figures} figures</span>
      <StarButton r={r} onUpdate={actions.update} />
      <CardMenu r={r} folders={folders} open={menuOpen} setMenuId={setMenuId} actions={actions} />
    </div>
  );
}

const DASH_SELECT = "rounded-md border border-[#2f5b75] bg-[#16415f] px-3 py-2 text-sm text-white outline-none focus:border-[#f84f63]";

function Dashboard({ reports, folders, activeId, onOpen, onCreate, onDuplicate, onDelete, onUpdate, onAddFolder }) {
  const [scope, setScope] = useState("recents");
  const [tab, setTab] = useState("viewed");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("modified");
  const [view, setView] = useState("grid");
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState(null);
  const searchRef = useRef(null);
  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("")


  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "/" && !typing) { e.preventDefault(); searchRef.current?.focus(); }
    };
    const onDown = (e) => { if (!e.target.closest?.("[data-menu]")) setMenuId(null); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, []);

  const visible = useMemo(() => {
    if (tab === "shared") return [];
    const q = query.trim().toLowerCase();
    let list = reports.filter((r) => {
      if (scope === "drafts" && r.status !== "draft") return false;
      if (scope === "starred" && !r.starred) return false;
      if (scope.startsWith("folder:") && r.folder !== scope.slice(7)) return false;
      if (tab === "pinned" && !r.pinned) return false;
      if (status !== "all" && r.status !== status) return false;
      if (q && !`${r.title} ${r.rae} ${r.project}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const order = Object.keys(STATUS);
    list = [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === "name") return a.title.localeCompare(b.title);
      if (sort === "status") return order.indexOf(a.status) - order.indexOf(b.status);
      return b.updatedAt - a.updatedAt;
    });
    return scope === "recents" ? list.slice(0, 12) : list;
  }, [reports, scope, tab, status, sort, query]);

  const openFolderModal = () => { setFolderName(""); setFolderError(""); setFolderModal(true); };
  const submitFolder = async (e) => {
    e.preventDefault();
    const err = await onAddFolder(folderName);
    if (err) setFolderError(err);
    else setFolderModal(false);
  };

  const actions = { open: onOpen, duplicate: onDuplicate, remove: onDelete, update: onUpdate };
  const NAV = [
    ["recents", "Recents", "clock", reports.length],
    ["drafts", "Drafts", "file", reports.filter((r) => r.status === "draft").length],
    ["all", "All reports", "folder", null],
    ["starred", "Starred", "star", null],
  ];
  const TABS = [["viewed", "Recently viewed", "clock"], ["shared", "Shared with me", "users"], ["pinned", "Pinned", "pin"]];
  const navBtn = (on) => `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${on ? "bg-[#16415f] font-semibold text-white ring-1 ring-[#f84f63]/60" : "text-[#c8dfe1] hover:bg-white/5 hover:text-white"}`;
  const label = "px-3 pb-2 text-[11px] font-semibold uppercase tracking-[.14em] text-[#7f9fae]";

  return (
    <div className="flex h-[calc(100vh-90px)] overflow-hidden rounded-2xl border border-[#2a5068] bg-[#0b2b47]">
      {/* Left panel */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[#2a5068]/60 bg-[#0a2744] md:flex">
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <p className={label}>Navigation</p>
          <div className="space-y-1">
            {NAV.map(([key, text, icon, count]) => (
              <button key={key} onClick={() => setScope(key)} className={navBtn(scope === key)}>
                <Icon name={icon} className="h-[18px] w-[18px]" />
                <span className="flex-1 text-left">{text}</span>
                {count !== null && <span className="text-xs text-[#7f9fae]">{count}</span>}
              </button>
            ))}
          </div>

          <div className="mb-2 mt-8 flex items-center justify-between pr-2">
            <p className={label}>Project folders</p>
            <button onClick={openFolderModal} title="New folder" className="rounded p-1 text-[#9bbcc0] hover:bg-white/10 hover:text-white">
              <Icon name="folderPlus" className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div className="space-y-1">
            {folders.length === 0 && <p className="px-3 text-xs text-[#7f9fae]">No folders yet.</p>}
            {folders.map((f) => (
              <button key={f} onClick={() => setScope(`folder:${f}`)} className={navBtn(scope === `folder:${f}`)}>
                <Icon name="folder" className="h-[18px] w-[18px]" />
                <span className="flex-1 truncate text-left">{f}</span>
                <span className="text-xs text-[#7f9fae]">{reports.filter((r) => r.folder === f).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-[#2a5068]/60 px-5 py-4">
          <p className={`${label} px-0`}>Workspaces</p>
          <div className="flex items-center gap-3 text-[#c8dfe1]">
            <Icon name="building" className="h-6 w-6" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">CSA Engineering</p>
              <p className="text-xs text-[#7f9fae]">{reports.length} reports</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-[#2a5068]/60 px-5 py-4">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8fa9b5]"><Icon name="search" className="h-5 w-5" /></span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reports by title, RAE No. or project… (press / to focus)"
              className="w-full rounded-md border border-[#2f5b75] bg-[#0a2744] py-3 pl-11 pr-16 text-sm text-white placeholder:text-[#8fa9b5] outline-none transition focus:border-[#f84f63] focus:ring-2 focus:ring-[#f84f63]/25"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded bg-[#16415f] px-2 py-0.5 text-[10px] text-[#9bbcc0] sm:block">Ctrl K</kbd>
          </div>
          <button onClick={onCreate} className="inline-flex items-center gap-2 rounded-md bg-[#f84f63] px-5 py-3 text-sm font-semibold text-[#0a1f36] transition hover:bg-[#ff667a]">
            <Icon name="plus" sw={2.4} /> New Report
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-1">
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={`${DASH_SELECT} md:hidden`} aria-label="Section">
              {NAV.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
              {folders.map((f) => <option key={f} value={`folder:${f}`}>{f}</option>)}
            </select>
            {TABS.map(([key, text, icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm transition ${tab === key ? "bg-[#16415f] font-semibold text-white ring-1 ring-[#f84f63]/60" : "text-[#c8dfe1] hover:bg-white/5 hover:text-white"}`}
              >
                <Icon name={icon} /> {text}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={DASH_SELECT} aria-label="Status filter">
              <option value="all">All statuses ({Object.keys(STATUS).length})</option>
              {Object.entries(STATUS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className={DASH_SELECT} aria-label="Sort">
              <option value="modified">Last modified</option>
              <option value="name">Name</option>
              <option value="status">Status</option>
            </select>
            <div className="flex overflow-hidden rounded-md border border-[#2f5b75]">
              {[["grid", "grid"], ["list", "list"]].map(([key, icon]) => (
                <button key={key} onClick={() => setView(key)} aria-label={`${key} view`} className={`p-2.5 ${view === key ? "bg-[#16415f] text-[#f84f63]" : "text-[#9bbcc0] hover:bg-white/5"}`}>
                  <Icon name={icon} className="h-[18px] w-[18px]" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-8">
          {visible.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-[#2f5b75] p-10 text-center text-sm text-[#a9c1ca]">
              {tab === "shared"
                ? "Report sharing isn't available yet."
                : reports.length === 0
                  ? "No reports yet. Click New Report, fill in the project details and it will appear here."
                  : "No reports match these filters."}
            </div>
          ) : view === "grid" ? (
            <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
              {visible.map((r) => (
                <ReportCard key={r.id} r={r} isActive={r.id === activeId} menuOpen={menuId === r.id} setMenuId={setMenuId} folders={folders} actions={actions} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((r) => (
                <ReportRow key={r.id} r={r} isActive={r.id === activeId} menuOpen={menuId === r.id} setMenuId={setMenuId} folders={folders} actions={actions} />
              ))}
            </div>
          )}
        </div>
      </div>
      {folderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={(e) => e.key === "Escape" && setFolderModal(false)}>
          <div className="absolute inset-0 bg-[#0a1f36]/60 backdrop-blur-sm" onClick={() => setFolderModal(false)} />
          <form onSubmit={submitFolder} className="relative mx-4 w-full max-w-sm rounded-2xl border border-[#2a5068] bg-[#0b2b47] p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-white">New folder</h3>
              <button type="button" onClick={() => setFolderModal(false)} aria-label="Close" className="rounded-full border border-[#2f5b75] px-2 py-1 text-xs text-[#c8dfe1] hover:bg-white/5">&times;</button>
            </div>
            <label className="block text-xs font-medium text-[#b9d0d8]">Folder name</label>
            <input
              autoFocus
              value={folderName}
              onChange={(e) => { setFolderName(e.target.value); setFolderError(""); }}
              maxLength={60}
              placeholder="e.g. Trailer Chassis ADR 62"
              className="mt-1.5 w-full rounded-md border border-[#2f5b75] bg-[#16415f] px-3.5 py-3 text-sm text-white placeholder:text-[#8fa9b5] outline-none focus:border-[#f84f63] focus:ring-2 focus:ring-[#f84f63]/25"
            />
            {folderError && <p className="mt-2 text-xs text-[#ff8e9c]">{folderError}</p>}
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setFolderModal(false)} className="flex-1 rounded-md border border-[#2f5b75] bg-transparent px-4 py-2 text-sm font-semibold text-[#c8dfe1] hover:bg-white/5">Cancel</button>
              <button type="submit" className="flex-1 rounded-md border border-[#f84f63] bg-[#f84f63] px-4 py-2 text-sm font-semibold text-[#0a1f36] hover:bg-[#ff667a]">Create folder</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar: numbered step tracker (logo · steps · completeness)       */
/*  Everything it needs is passed in as props because it lives         */
/*  outside the ReportGenix component.                                 */
/*  On lg+ screens it can collapse to a 76px icon rail.                */
/* ------------------------------------------------------------------ */

const SidebarNav = ({ steps, extraLinks, completeness, sidebarOpen, setSidebarOpen, collapsed, onToggleCollapse, user, openProfile, dashboardActive }) => {
  const close = () => setSidebarOpen(false);
  // "collapsed" only applies on lg+ screens; the mobile drawer is always full width.
  const hideWhenCollapsed = collapsed ? "lg:hidden" : "";

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[#2a5068]/60 bg-[#0a2744] shadow-2xl transition-[transform,width] duration-300 lg:translate-x-0 lg:shadow-none ${collapsed ? "lg:w-[76px]" : "lg:w-72"} ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      aria-label="Report navigation"
      data-collapsed={collapsed ? "true" : "false"}
    >
      {/* Desktop expand / collapse handle */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
        className="absolute -right-3.5 top-7 z-[60] hidden h-7 w-7 items-center justify-center rounded-full border border-[#2f5b75] bg-[#0e3250] text-[#c8dfe1] shadow-lg hover:border-[#f84f63] hover:bg-[#16415f] hover:text-white lg:flex"
      >
        <Icon name="chevronLeft" className={`h-4 w-4 transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`} sw={2.4} />
      </button>

      {/* Brand */}
      <div className={`flex items-center justify-between px-6 pb-5 pt-6 ${collapsed ? "lg:justify-center lg:px-3" : ""}`}>
        <Link href="/" onClick={close} className="flex items-center gap-3" title="ReportGenix">
          <img src="/csa_logo.webp" alt="CSA Engineering" className={`h-9 w-auto object-contain ${collapsed ? "lg:h-7 lg:max-w-[44px] lg:object-cover lg:object-left" : ""}`} />
          <span className={`border-l border-[#2f5b75] pl-3 text-lg font-bold tracking-tight text-white ${hideWhenCollapsed}`}>ReportGenix</span>
        </Link>
        <button
          onClick={close}
          className="rounded border border-[#2f5b75] bg-transparent px-2 py-1 text-xs text-[#c8dfe1] hover:bg-white/5 lg:hidden"
          aria-label="Close sidebar"
        >
          &times;
        </button>
      </div>

      {/* Dashboard */}
      <div className={`px-6 pb-2 ${collapsed ? "lg:px-3" : ""}`}>
        <Link
          href="/dashboard"
          onClick={close}
          title="Dashboard"
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${collapsed ? "lg:justify-center lg:px-0" : ""} ${dashboardActive ? "bg-[#f84f63] text-[#0a1f36]" : "border border-[#2f5b75] bg-[#0e3250] text-[#c8dfe1] hover:bg-white/5 hover:text-white"}`}
        >
          <Icon name="grid" className="h-[18px] w-[18px] shrink-0" />
          <span className={hideWhenCollapsed}>Dashboard</span>
        </Link>
      </div>

      {/* Steps */}
      <nav
        data-tour="sidebar-steps"
        className={`flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 ${collapsed ? "lg:px-3" : ""}`}
        aria-label="Report steps"
      >
        <ol>
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const circle = step.active
              ? "border-[#f84f63] bg-[#f84f63] text-[#0a1f36] ring-4 ring-[#f84f63]/25"
              : step.done
                ? "border-[#6fd08a] bg-[#6fd08a]/10 text-[#6fd08a]"
                : "border-[#5b7f96] bg-transparent text-[#c8dfe1] group-hover:border-[#f84f63]";
            return (
              <li key={step.key} className={`relative ${isLast ? "" : "pb-7"}`}>
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-1 left-4 top-10 -translate-x-1/2 border-l-2 border-dashed border-[#2f5b75] ${collapsed ? "lg:left-1/2" : ""}`}
                  />
                )}
                <Link
                  href={step.href}
                  onClick={close}
                  title={collapsed ? `${step.label} — ${step.sub || ""}` : undefined}
                  aria-current={step.active ? "step" : undefined}
                  className={`group relative flex items-center gap-4 ${collapsed ? "lg:justify-center lg:gap-0" : ""}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition ${circle}`}>
                    {step.done && !step.active ? "✓" : index + 1}
                  </span>
                  <span className={`min-w-0 ${hideWhenCollapsed}`}>
                    <span className={`block truncate text-[15px] ${step.active ? "font-semibold text-white" : "font-medium text-[#c8dfe1] group-hover:text-white"}`}>
                      {step.label}
                    </span>
                    {step.sub && <span className="block truncate text-[11px] text-[#7f9fae]">{step.sub}</span>}
                  </span>
                </Link>

                {step.children?.length > 0 && (
                  <ul className={`relative mt-5 space-y-4 ${hideWhenCollapsed}`}>
                    {step.children.map((child) => {
                      const dot = child.active
                        ? "bg-[#f84f63] ring-4 ring-[#f84f63]/25"
                        : child.done
                          ? "bg-[#6fd08a]"
                          : "bg-[#5b7f96] group-hover:bg-[#f84f63]";
                      return (
                        <li key={child.key} className="relative">
                          <Link href={child.href} onClick={close} aria-current={child.active ? "step" : undefined} className="group flex items-center gap-4">
                            <span className="flex h-4 w-8 shrink-0 items-center justify-center">
                              <span className={`h-2.5 w-2.5 rounded-full border-2 border-[#0a2744] transition ${dot}`} />
                            </span>
                            <span className={`block truncate text-[13px] ${child.active ? "font-semibold text-white" : "text-[#c8dfe1] group-hover:text-white"}`}>
                              {child.label}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Completeness */}
      <div data-tour="progress" className={`border-t border-[#2a5068]/60 px-6 py-5 ${collapsed ? "lg:px-2" : ""}`}>
        {/* Expanded: label + bar */}
        <div className={hideWhenCollapsed}>
          <p className="text-sm font-semibold text-white">Report completeness:</p>
          <div className="mt-2 flex items-center gap-3">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-[#16405c]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={completeness}
              aria-label="Report completeness"
            >
              <div className="h-full rounded-full bg-[#f84f63] transition-all duration-500" style={{ width: `${completeness}%` }} />
            </div>
            <span className="w-9 text-right text-xs font-semibold text-[#c8dfe1]">{completeness}%</span>
          </div>
        </div>

        {/* Collapsed: compact percentage ring */}
        {collapsed && (
          <div className="hidden justify-center lg:flex" title={`Report completeness: ${completeness}%`}>
            <div className="relative h-10 w-10">
              <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90" aria-hidden="true">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#16405c" strokeWidth="3.5" />
                <circle
                  cx="18" cy="18" r="15" fill="none" stroke="#f84f63" strokeWidth="3.5" strokeLinecap="round"
                  strokeDasharray={`${(completeness / 100) * 94.25} 94.25`}
                  className="transition-all duration-500"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-[#c8dfe1]">{completeness}</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function ReportGenix() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [csrf, setCsrf] = useState("");
  const router = useRouter();
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ full_name: "", email: "", password: "" });
  const [authStatus, setAuthStatus] = useState("");
  const [schema, setSchema] = useState(null);
  const [data, setData] = useState(() => stripStaleBodies(WORK.data));
  const [standardsCatalog, setStandardsCatalog] = useState([]);
  const [materialsCatalog, setMaterialsCatalog] = useState([]);
  const [standards, setStandards] = useState([]);
  const [selected, setSelected] = useState([]);
  const [files, setFiles] = useState(() => navigationMedia.files);
  const [layout, setLayout] = useState({ heading_align: "left", text_align: "justify", image_align: "center", caption_position: "below", caption_align: "center" });
  const [materialMode, setMaterialMode] = useState("library");
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [materialMeta, setMaterialMeta] = useState({ material_type: "", category: "steel", source_standard_id: "", notes: "" });
  const [materialStatus, setMaterialStatus] = useState(null);
  const [extraImages, setExtraImages] = useState(() => navigationMedia.extraImages || {});
  const [removedSchemaImages, setRemovedSchemaImages] = useState(() => navigationMedia.removedSchemaImages || {});
  const [changeHistory, setChangeHistory] = useState([]);
  const [changeRedo, setChangeRedo] = useState([]);
  const [step, setStep] = useState(1);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [busy, setBusy] = useState("");
  const [raeLookup, setRaeLookup] = useState({ status: "idle", message: "", matchType: null });
  const [profileModal, setProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({ full_name: "", email: "", current_password: "", initials: "" });
  const [resetForm, setResetForm] = useState({ current_password: "", new_password: "" });
  const [profileStatus, setProfileStatus] = useState("");
  const [profileBusy, setProfileBusy] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Restore the saved sidebar preference after mount (avoids a hydration mismatch).
  useEffect(() => {
    try { setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "1"); } catch { /* ignore */ }
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((value) => {
      const next = !value;
      try { window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Ctrl/Cmd + B toggles the sidebar.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); toggleSidebarCollapsed(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebarCollapsed]);

  /* Dashboard */
  const [reports, setReports] = useState([]);
  const [folders, setFolders] = useState([]);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [activeReportId, setActiveReportId] = useState("");
  const pendingId = useRef("");
  const raeTimer = useRef(null);
  const [syncTick, setSyncTick] = useState(0);
  const syncedReports = useRef(new Set());   // report ids that exist on the server
  const syncedImages = useRef({});           // { [reportId]: { current: {imageId: File}, original: {...} } }
  const lastSaved = useRef({});              // { [reportId]: change key }
  const hydratedRef = useRef("");
  const historyCurrent = useRef(null);
  const skipHistory = useRef(false);

  const restoreChangeSnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    skipHistory.current = true;
    setData(snapshot.data || {});
    setStandards(snapshot.standards || []);
    setSelected(snapshot.selected || []);
    setLayout(snapshot.layout || {});
    setExtraImages(snapshot.extraImages || {});
    setRemovedSchemaImages(snapshot.removedSchemaImages || {});
  }, []);

  const undoChange = useCallback(() => {
    setChangeHistory((history) => {
      const previous = history.at(-1);
      if (!previous) return history;
      const current = historyCurrent.current;
      if (current) setChangeRedo((redo) => [current, ...redo].slice(0, 50));
      restoreChangeSnapshot(previous);
      return history.slice(0, -1);
    });
  }, [restoreChangeSnapshot]);

  const redoChange = useCallback(() => {
    setChangeRedo((redo) => {
      const next = redo[0];
      if (!next) return redo;
      const current = historyCurrent.current;
      if (current) setChangeHistory((history) => [...history, current].slice(-50));
      restoreChangeSnapshot(next);
      return redo.slice(1);
    });
  }, [restoreChangeSnapshot]);

  useEffect(() => {
    if (!previewExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPreviewExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [previewExpanded]);

  useEffect(() => {
    if (!profileModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !profileBusy) closeProfile();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileModal, profileBusy]);

  /* Routes the user has opened (used for text-only section completion) */
  const [visited, setVisited] = useState([]);
  useEffect(() => {
    setVisited((v) => (v.includes(pathname) ? v : [...v, pathname]));
  }, [pathname]);
  const [tourOpen, setTourOpen] = useState(false);
  /* Image editor + section preview state */
  const [editingImage, setEditingImage] = useState(null); /* { id, label, url, originalFile } */
  const [originals, setOriginals] = useState(() => navigationMedia.originals); /* { [imageId]: untouched original File } */
  const [editorStates, setEditorStates] = useState(() => navigationMedia.editorStates); /* { [imageId]: saved layers } */
  const [preview, setPreview] = useState(null); /* { pages: [{page,dataUrl}], section_pages: {...} } */
  const [previewSectionId, setPreviewSectionId] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequestRef = useRef(0);
  const [pdfEdits, setPdfEdits] = useState({ items: {}, pages: {} }); /* PdfEditor overlay edits, kept across sections */

  useEffect(() => {
    navigationMedia = { files, originals, editorStates, extraImages, removedSchemaImages };
  }, [files, originals, editorStates, extraImages, removedSchemaImages]);

  useEffect(() => { removeLegacyMediaDatabase(); }, []);


  const request = useCallback(
    async (path, options = {}) => {
      const method = (options.method || "GET").toUpperCase();
      const headers = new Headers(options.headers || {});
      if (method !== "GET" && method !== "HEAD" && csrf) headers.set("X-CSRF-Token", csrf);
      const response = await fetch(path, { ...options, headers, cache: options.cache || "no-store", credentials: "include" });
      if (!response.ok) {
        const error = new Error(await messageFor(response));
        error.status = response.status;
        throw error;
      }
      return response;
    },
    [csrf]
  );

  const loadStudio = useCallback(async () => {
    const [schemaResponse, standardsResponse, materialsResponse] = await Promise.all([request("/api/schema"), request("/api/standards"), request("/api/materials")]);
    const [nextSchema, nextStandards, nextMaterials] = await Promise.all([schemaResponse.json(), standardsResponse.json(), materialsResponse.json()]);
    setSchema(nextSchema);
    setStandardsCatalog(nextStandards.standards || []);
    setMaterialsCatalog(nextMaterials.materials || []);
    let saved = {};
    try {
      saved = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "{}") || {};
    } catch {
      window.sessionStorage.removeItem(DRAFT_KEY);
    }

    setData((current) =>
      stripStaleBodies({
        ...Object.fromEntries(
          nextSchema.general.map((field) => [field.id, field.default ?? (field.type === "date" ? new Date().toISOString().slice(0, 10) : "")])
        ),
        ...(saved.data || {}),
        ...current,
      })
    );
    try { window.localStorage.setItem("rg-bodies-clean-v2", "1"); } catch { /* ignore */ }

    const savedStandards = Array.isArray(saved.standards) ? saved.standards : [];
    // Keep the first blank Summary of Compliance row available in every draft.
    setStandards(savedStandards.length ? savedStandards : [newComplianceRow()]);
    // A saved draft may pre-date a new standard section (for example the
    // Report Index).  Common sections are part of every report, so merge them
    // into an old selection rather than silently building the old template.
    const savedSelection = Array.isArray(saved.selected) ? saved.selected : [];
    const commonSectionIds = nextSchema.sections
      .filter((section) => !/^a\d+$/i.test(String(section.id || "")))
      .map((section) => section.id);
    setSelected([...new Set([...savedSelection, ...commonSectionIds])]);
    setLayout((current) => ({ ...current, ...(saved.layout || {}) }));
    setMaterialMode(saved.materialMode === "manual" ? "manual" : "library");
    setSelectedMaterialId(saved.selectedMaterialId || "");
    setMaterialMeta((current) => ({ ...current, ...(saved.materialMeta || {}) }));
    setActiveReportId(saved.activeReportId || "");
    setExtraImages(saved.extraImages || {});
    setRemovedSchemaImages(saved.removedSchemaImages || {});
  }, [request]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const csrfResponse = await fetch("/api/auth/csrf", { cache: "no-store", credentials: "include" });
        const csrfPayload = await csrfResponse.json();
        if (!active) return;
        setCsrf(csrfPayload.csrf_token || "");
        const meResponse = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
        if (meResponse.ok) {
          const mePayload = await meResponse.json();
          setUser(mePayload.user);
          if (mePayload.user.initials) {
            setData((current) => ({ ...current, prepared_by: mePayload.user.initials }));
          }
          setCsrf(mePayload.csrf_token || csrfPayload.csrf_token || "");
        }
      } catch (error) {
        if (active) setAuthStatus("Could not connect to the report service.");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const lookupRae = useCallback(async (raeId) => {
    if (!raeId || !/^\d+$/.test(raeId.trim())) {
      setRaeLookup({ status: "idle", message: "", matchType: null });
      return;
    }
    const id = raeId.trim();
    setRaeLookup({ status: "loading", message: "Looking up project…", matchType: null });
    try {
      const response = await request(`/api/project-by-rae/${encodeURIComponent(id)}`);
      const result = await response.json();
      if (result.project_name) {
        setData((current) => ({ ...current, project_name: result.project_name }));
        const label = result.subproject_name ? `${result.project_name} — ${result.subproject_name}` : result.project_name;
        setRaeLookup({ status: "ok", message: `Found: ${label} (${result.match_type || "exact"} match)`, matchType: result.match_type || "exact" });
      } else {
        setRaeLookup({ status: "error", message: "No project found for this RAE ID.", matchType: null });
      }
    } catch (error) {
      setRaeLookup({ status: "error", message: error.message || "Lookup failed.", matchType: null });
    }
  }, [request]);

  useEffect(() => {
    if (user && csrf) {
      loadStudio().then(() => {
        if (user.initials) {
          setData((current) => ({ ...current, prepared_by: user.initials }));
        }
      }).catch((error) => setAuthStatus(error.message));
    }
  }, [user, csrf, loadStudio]);

  useEffect(() => {
    if (raeTimer.current) window.clearTimeout(raeTimer.current);
    raeTimer.current = window.setTimeout(() => {
      lookupRae(data.rae_no);
    }, 500);
    return () => {
      if (raeTimer.current) window.clearTimeout(raeTimer.current);
    };
  }, [data.rae_no, lookupRae]);


  useEffect(() => {
    if (!ready || !user) return;
    const key = `reportgenix-landed:${user.id ?? user.email}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    if (window.location.pathname === "/") router.replace("/dashboard");
  }, [ready, user, router]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);

  /* Close the mobile sidebar whenever the route changes. */
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  useEffect(() => {
    if (!schema) return;
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ data, standards, selected, layout, materialMode, selectedMaterialId, materialMeta, activeReportId, extraImages, removedSchemaImages }));
  }, [schema, data, standards, selected, layout, materialMode, selectedMaterialId, materialMeta, activeReportId, extraImages, removedSchemaImages]);

  // Keep a compact report-level history. Files themselves stay in IndexedDB;
  // their captions, placement, section data and visibility are all restored.
  useEffect(() => {
    if (!schema) return;
    const snapshot = { data, standards, selected, layout, extraImages, removedSchemaImages };
    const signature = JSON.stringify(snapshot);
    const current = { ...snapshot, _signature: signature };
    const previous = historyCurrent.current;
    if (!previous) {
      historyCurrent.current = current;
      return;
    }
    if (previous._signature === signature) return;
    historyCurrent.current = current;
    if (skipHistory.current) {
      skipHistory.current = false;
      return;
    }
    setChangeHistory((history) => [...history, previous].slice(-50));
    setChangeRedo([]);
  }, [schema, data, standards, selected, layout, extraImages, removedSchemaImages]);

  useEffect(() => { MEDIA.files = files; }, [files]);
  useEffect(() => { MEDIA.originals = originals; }, [originals]);
  useEffect(() => { MEDIA.editorStates = editorStates; }, [editorStates]);
  useEffect(() => { WORK.data = data; }, [data]);

  useEffect(() => {
    if (materialMode !== "manual" || !data.material || !materialMeta.material_type || !data.fu || !csrf) return;
    const timer = window.setTimeout(async () => {
      try {
        setMaterialStatus({ text: "Saving material changes…" });
        const response = await request("/api/materials/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grade: data.material,
            material_type: materialMeta.material_type,
            tensile_mpa: data.fu,
            yield_mpa: data.fy,
            youngs_modulus_gpa: data.young,
            poisson_ratio: data.nu,
            density_kg_m3: data.rho,
            ...materialMeta,
          }),
        });
        const payload = await response.json();
        setMaterialsCatalog((current) => {
          const next = current.filter((item) => item.id !== payload.material.id);
          return [...next, payload.material].sort((a, b) => a.grade.localeCompare(b.grade));
        });
        setSelectedMaterialId(payload.material.id);
        setMaterialStatus({ text: "Material saved to the library." });
      } catch (error) {
        setMaterialStatus({ text: error.message, error: true });
      }
    }, 850);
    return () => window.clearTimeout(timer);
  }, [materialMode, data.material, data.fu, data.fy, data.young, data.nu, data.rho, materialMeta, csrf, request]);

  const submitAuth = async (event) => {
    event.preventDefault();
    setAuthStatus("");
    setBusy("auth");
    try {
      // fresh token tied to the current session cookie
      const tokenResponse = await fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin" });
      const { csrf_token: fresh } = await tokenResponse.json();
      setCsrf(fresh);

      const response = await fetch(authMode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": fresh },
        body: JSON.stringify(authForm),
      });
      if (!response.ok) throw new Error(await messageFor(response));
      const payload = await response.json();
      setUser(payload.user);
      setCsrf(payload.csrf_token || fresh);
      setAuthForm((form) => ({ ...form, password: "" }));
    } catch (error) {
      setAuthStatus(error.message);
    } finally {
      setBusy("");
    }
  };

  const openProfile = () => {
    setProfileForm({ full_name: user.full_name || "", email: user.email || "", current_password: "", initials: user.initials || "" });
    setResetForm({ current_password: "", new_password: "" });
    setAvatarPreview(user.avatar_url || null);
    setProfileStatus("");
    setResetMode(false);
    setPasswordVisible(false);
    setProfileModal(true);
  };

  const closeProfile = () => {
    setProfileModal(false);
    setProfileStatus("");
    setProfileForm({ full_name: "", email: "", current_password: "", initials: "" });
    setResetForm({ current_password: "", new_password: "" });
    setAvatarPreview(null);
    setResetMode(false);
    setPasswordVisible(false);
  };

  const updateProfile = async () => {
    setProfileBusy("save");
    setProfileStatus("");
    try {
      const payload = {};

      if (profileForm.full_name.trim()) {
        payload.full_name = profileForm.full_name.trim();
      }
      if (profileForm.email.trim()) {
        payload.email = profileForm.email.trim();
      }
      if (profileForm.initials.trim()) {
        payload.initials = profileForm.initials.trim().toUpperCase();
      }

      if (Object.keys(payload).length === 0) {
        setProfileStatus("Nothing to change.");
        return;
      }

      const response = await request("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!result.user) {
        throw new Error("The server did not return the updated user profile.");
      }

      setUser(result.user);

      if (result.user.initials) {
        setData((current) => ({
          ...current,
          prepared_by: result.user.initials,
        }));
      }

      if (result.csrf_token) {
        setCsrf(result.csrf_token);
      }

      setProfileModal(false);
      setProfileStatus("Profile saved.");
    } catch (error) {
      setProfileStatus(error.message || "Profile update failed.");
    } finally {
      setProfileBusy("");
    }
  };

  const uploadAvatar = async (file) => {
    setProfileBusy("save");
    setProfileStatus("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/auth/avatar", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: form,
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      setUser(result.user);
      if (result.user.initials) {
        setData((current) => ({ ...current, prepared_by: result.user.initials }));
      }
      setCsrf(result.csrf_token || csrf);
      setAvatarPreview(result.user.avatar_url || null);
      setProfileStatus("Avatar uploaded.");
    } catch (error) {
      setProfileStatus(error.message || "Avatar upload failed.");
    } finally {
      setProfileBusy("");
    }
  };

  const doResetPassword = async () => {
    setProfileBusy("save");
    setProfileStatus("");
    try {
      const response = await request("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ current_password: resetForm.current_password, new_password: resetForm.new_password }),
      });
      const result = await response.json();
      setUser(result.user);
      if (result.user.initials) {
        setData((current) => ({ ...current, prepared_by: result.user.initials }));
      }
      setCsrf(result.csrf_token || csrf);
      setResetMode(false);
      setResetForm({ current_password: "", new_password: "" });
      setProfileStatus("Password changed.");
    } catch (error) {
      setProfileStatus(error.message || "Password reset failed.");
    } finally {
      setProfileBusy("");
    }
  };

  const logout = async () => {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setSchema(null);
      setStandards([]);
      setFiles({});
      setOriginals({});
      setEditorStates({});
      setEditingImage(null);
      setPreviewUrl("");
      setVisited([]);
      setStep(1);
      setReports([]);
      setFolders([]);
      setReportsLoaded(false);
      setActiveReportId("");
      syncedReports.current = new Set();
      syncedImages.current = {};
      lastSaved.current = {};
      hydratedRef.current = ""; 
      MEDIA.files = {}; MEDIA.originals = {}; MEDIA.editorStates = {};
      navigationMedia = { files: {}, originals: {}, editorStates: {}, extraImages: {}, removedSchemaImages: {} };
      WORK.data = null;
      Object.keys(window.sessionStorage).filter((k) => k.startsWith("reportgenix-landed:")).forEach((k) => window.sessionStorage.removeItem(k));
      window.sessionStorage.removeItem(DRAFT_KEY);
    }
  };

  /* ---------------- Image editor handlers ---------------- */

  const stopEditing = useCallback(() => {
    if (editingImage?.url) URL.revokeObjectURL(editingImage.url);
    setEditingImage(null);
  }, [editingImage]);

  const openImageEditor = useCallback(
    (image) => {
      // always edit from the untouched original so layers stay editable
      const base = originals[image.id] || files[image.id];
      if (!base) {
        window.alert("Attach an image first, then open it in the editor.");
        return;
      }
      if (editingImage?.url) URL.revokeObjectURL(editingImage.url);
      setEditingImage({ id: image.id, label: image.label, url: URL.createObjectURL(base), originalFile: base });
    },
    [files, originals, editingImage]
  );

  const closeImageEditor = stopEditing;

  const handleEditorSave = useCallback(
    async (file, state) => {
      if (!editingImage) return;
      const { id, originalFile } = editingImage;
      setOriginals((current) => ({ ...current, [id]: current[id] || originalFile }));
      setEditorStates((current) => ({ ...current, [id]: state }));

      if (editingImage.target === "pdf") {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        setPdfEdits((current) => ({
          ...current,
          items: {
            ...current.items,
            [editingImage.pdfKey]: (current.items?.[editingImage.pdfKey] || []).map((item) =>
              item.id === editingImage.pdfItemId ? { ...item, src: dataUrl } : item
            ),
          },
        }));
      } else {
        setFiles((current) => ({ ...current, [id]: file }));
      }
      stopEditing();
    },
    [editingImage, stopEditing]
  );

  const openPdfImageEditor = useCallback(async ({ key, item }) => {
    if (!item?.src) return;
    const id = `pdf-image:${key}:${item.id}`;
    let base = originals[id];
    if (!base) {
      const blob = await fetch(item.src).then((response) => response.blob());
      base = new File([blob], `pdf-image-${item.id}.png`, { type: blob.type || "image/png" });
      setOriginals((current) => ({ ...current, [id]: base }));
    }
    if (editingImage?.url) URL.revokeObjectURL(editingImage.url);
    setEditingImage({
      id,
      label: "PDF image",
      url: URL.createObjectURL(base),
      originalFile: base,
      target: "pdf",
      pdfKey: key,
      pdfItemId: item.id,
    });
  }, [originals, editingImage]);

  // Uploading a new file through the card's file input starts that slot fresh.
  const handleFileChange = useCallback(
    (id, file) => {
      setFiles((current) => ({ ...current, [id]: file }));
      setOriginals((current) => { const n = { ...current }; delete n[id]; return n; });
      setEditorStates((current) => { const n = { ...current }; delete n[id]; return n; });
      if (editingImage?.id === id) stopEditing();
    },
    [editingImage, stopEditing]
  );

  const reportRows = useMemo(
    () =>
      standards.flatMap((row) => {
        if (row.picked?.length) {
          return row.picked.map((picked) => ({
            id: `${row.id}-${picked.id}`,
            standard: picked.standard,
            requirement: picked.requirement,
            conformity: row.conformity,
          }));
        }
        return row.standard || row.requirement
          ? [{
              id: row.clauseId || row.id,
              standard: row.standard,
              requirement: row.requirement,
              conformity: row.conformity,
            }]
          : [];
      }),
    [standards]
  );

  // The Summary of Compliance is the source of truth for analysis pages.
  // Every selected library clause (or completed manual compliance row) gets
  // one Analysis page. The first seven retain their schema IDs so existing
  // preview page anchors and evidence slots continue to work; later pages
  // receive unique IDs and are still available in the editor/sidebar.
  const reportSections = useMemo(() => {
    const allSections = schema?.sections || [];
    const analysisTemplates = allSections.filter((section) =>
      /^a\d+$/i.test(String(section.id || "")) ||
      /^analysis\s*\d+/i.test(String(section.title || ""))
    );
    const nonAnalysisSections = allSections.filter((section) => !analysisTemplates.includes(section));
    const analysisPages = reportRows.map((row, index) => {
      const number = index + 1;
      const template = analysisTemplates[index] || {};
      const rawRequirement = String(row.requirement || "").trim();
      const rawStandard = String(row.standard || "").trim();
      const heading = buildDynamicAnalysisHeading(row, number);
      const id = template.id || `analysis-${number}`;
      const calculationTemplate = resolveCalculationTemplate(row);
      const fieldTemplate = calculationTemplate
        ? analysisTemplates.find((item) => item.id === calculationTemplate) || template
        : template;
      return {
        ...template,
        id,
        title: heading,
        dynamicAnalysis: true,
        calculationTemplate,
        complianceStandard: String(row.standard || ""),
        complianceRequirement: rawRequirement || heading,
        // Each sidebar analysis section must own its own fields and image slots.
        // Reusing the source template IDs (for example a1_stress / a1_load)
        // made later dynamic sections display or edit the first analysis data.
        fields: (Array.isArray(fieldTemplate.fields) ? fieldTemplate.fields : []).map((field) => ({
          ...field,
          id: String(field.id || "").replace(/^a\d+_/, `${id}_`),
        })),
        images: (Array.isArray(fieldTemplate.images) ? fieldTemplate.images : []).map((image) => ({
          ...image,
          id: String(image.id || "").replace(/^a\d+_/, `${id}_`),
        })),
      };
    });


    const firstAnalysisPosition = allSections.findIndex((section) => analysisTemplates.includes(section));
    if (firstAnalysisPosition < 0) return [...nonAnalysisSections, ...analysisPages];
    const before = allSections.slice(0, firstAnalysisPosition).filter((section) => !analysisTemplates.includes(section));
    const after = allSections.slice(firstAnalysisPosition).filter((section) => !analysisTemplates.includes(section));
    return [...before, ...analysisPages, ...after];
  }, [schema, reportRows]);

  // Standards / client wording values, and the report data with the standard Background and Conclusion text filled in.
  const narrativeCtx = useMemo(
    () => buildNarrativeContext({ rows: standards, catalog: standardsCatalog, reportRows, general: schema?.general || [] }),
    [standards, standardsCatalog, reportRows, schema]
  );
  const reportData = useMemo(() => applyStandardNarratives(data, reportSections, narrativeCtx), [data, reportSections, narrativeCtx]);

  const reportSig = useMemo(
      () => JSON.stringify({ data, reportRows, selected, layout, extraImages, removedSchemaImages, files: Object.entries(files).map(([k, f]) => [k, f?.name, f?.size, f?.lastModified]) }),
      [data, reportRows, selected, layout, extraImages, removedSchemaImages, files]
  );

  const currentSectionId = pathname.startsWith("/section/") ? decodeURIComponent(pathname.slice("/section/".length)) : "";
  const currentActiveSection = reportSections.find((section) => section.id === currentSectionId);

  /*
   * The API records where each section starts.  Its next section start is the
   * end of this section's range, so retain every rendered page in between.
   * This intentionally leaves the PDF/preview API and report engine untouched.
   */
  const previewTotalPages = preview?.page_count || preview?.pages?.length || 0;
  const sectionPageNumbers = useMemo(() => {
    if (!preview || !previewTotalPages || !currentActiveSection) return [];
    const pageMap = preview.section_pages || {};
    const startPage = pageMap[currentActiveSection.id];
    if (!Number.isInteger(startPage) || startPage < 1 || startPage > previewTotalPages) return [];

    // Follow the sidebar's actual order rather than guessing from arbitrary
    // object values. This keeps dynamic Analysis 1..N ranges aligned with it.
    const activeIndex = reportSections.findIndex((section) => section.id === currentActiveSection.id);
    const nextStart = reportSections
      .slice(activeIndex + 1)
      .map((section) => pageMap[section.id])
      .find((page) => Number.isInteger(page) && page > startPage);
    const endPage = nextStart ? nextStart - 1 : previewTotalPages;

    return Array.from(
      { length: Math.max(0, endPage - startPage + 1) },
      (_, index) => startPage + index
    );
  }, [preview, previewTotalPages, currentActiveSection?.id, reportSections]);

  /* Stable per-page keys (sectionId:localIndex) so edits survive preview regeneration. */
  const allPageKeys = useMemo(() => {
    if (!preview || !previewTotalPages) return [];
    const keys = Array.from({ length: previewTotalPages }, (_, i) => `p${i + 1}`);
    const starts = Object.entries(preview.section_pages || {})
      .filter(([, page]) => typeof page === "number")
      .sort((a, b) => a[1] - b[1]);
    starts.forEach(([id, startPage], idx) => {
      const endPage = idx + 1 < starts.length ? starts[idx + 1][1] - 1 : previewTotalPages;
      for (let n = startPage; n <= endPage && n <= previewTotalPages; n++) keys[n - 1] = `${id}:${n - startPage}`;
    });
    return keys;
  }, [preview, previewTotalPages]);

  const loadPreview = useCallback(async () => {
    if (!schema || !currentActiveSection) return;
    const commonSectionIds = schema.sections
      .filter((section) => !/^a\d+$/i.test(String(section.id || "")))
      .map((section) => section.id);
    const payload = {
      data: reportData,
      standards: reportRows,
      selected: [...new Set([...selected, ...commonSectionIds])],
      layout,
      extra_images: {},
      removed_images: Object.keys(removedSchemaImages)
        .filter((key) => removedSchemaImages[key])
        .map((key) => key.slice(key.indexOf(":") + 1)),
    };
    Object.entries(extraImages).forEach(([sid, images]) => {
      if (!schema.sections.find((section) => section.id === sid)?.images?.length) return;
      payload.extra_images[sid] = images.filter((img) => files[img.id]).map((img) => ({
        id: img.id,
        label: data[`cap__${img.id}`] || img.label || "",
        h: Number(data[`img_height__${img.id}`] || img.h || 60),
      }));
    });
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    Object.entries(files).forEach(([key, file]) => {
      if (file) form.append(`img__${key}`, file);
    });
    const requestId = ++previewRequestRef.current;
    const requestedSectionId = currentActiveSection.id;
    setPreviewSectionId("");
    setPreviewLoading(true);
    try {
      const response = await request("/api/preview/pages?png=0", { method: "POST", body: form });
      const result = await response.json();
      if (requestId === previewRequestRef.current) {
        setPreview(result);
        setPreviewSectionId(requestedSectionId);
      }
    } catch (error) {
      if (requestId === previewRequestRef.current) {
        console.error("Preview failed", error);
        setPreviewSectionId("");
      }
    } finally {
      if (requestId === previewRequestRef.current) setPreviewLoading(false);
    }
  }, [request, schema, currentActiveSection, data, reportData, reportRows, selected, layout, extraImages, removedSchemaImages, files]);

  useEffect(() => {
    if (!schema || !currentActiveSection) return;
    const timer = window.setTimeout(loadPreview, 700);
    return () => window.clearTimeout(timer);
  }, [schema, currentActiveSection, loadPreview]);

  const buildGenerationForm = (output) => {
    const form = new FormData();
    const extraImagesPayload = {};
    Object.entries(extraImages).forEach(([sid, images]) => {
      if (!schema?.sections?.find((section) => section.id === sid)?.images?.length) return;
      extraImagesPayload[sid] = images.filter((img) => files[img.id]).map((img) => ({
        id: img.id,
        label: data[`cap__${img.id}`] || img.label || "",
        h: Number(data[`img_height__${img.id}`] || img.h || 60),
      }));
    });
    const removedImagesPayload = Object.keys(removedSchemaImages)
      .filter((key) => removedSchemaImages[key])
      .map((key) => key.slice(key.indexOf(":") + 1));
    const commonSectionIds = (schema?.sections || [])
      .filter((section) => !/^a\d+$/i.test(String(section.id || "")))
      .map((section) => section.id);
    const selectedForReport = [...new Set([...selected, ...commonSectionIds])];
    form.append(
      "payload",
      JSON.stringify({
        data: { ...reportData, standards: reportRows },
        standards: reportRows,
        selected: selectedForReport,
        layout,
        extra_images: extraImagesPayload,
        removed_images: removedImagesPayload,
        output: output === "preview" ? "pdf" : output,
      })
    );
    Object.entries(files).forEach(([key, file]) => {
      if (file) form.append(`img__${key}`, file);
    });
    return form;
  };

  const buildReportForm = (output = "pdf") => {
    const form = new FormData();
    const extraImagesPayload = {};
    Object.entries(extraImages).forEach(([sid, images]) => {
      extraImagesPayload[sid] = images.map((img) => ({
        id: img.id,
        label: data[`cap__${img.id}`] || img.label || "",
        h: Number(data[`img_height__${img.id}`] || img.h || 60),
      }));
    });
    const removedImagesPayload = Object.keys(removedSchemaImages)
      .filter((key) => removedSchemaImages[key])
      .map((key) => key.slice(key.indexOf(":") + 1));
    // Keep common sections present even if the browser has not yet written the
    // saved-draft migration above (for example, on the first rebuild).
    const commonSectionIds = (schema?.sections || [])
      .filter((section) => !/^a\d+$/i.test(String(section.id || "")))
      .map((section) => section.id);
    const selectedForReport = [...new Set([...selected, ...commonSectionIds])];
    form.append("payload", JSON.stringify({
      data: { ...reportData, standards: reportRows }, standards: reportRows, selected: selectedForReport, layout,
      extra_images: extraImagesPayload, removed_images: removedImagesPayload, output,
    }));
    Object.entries(files).forEach(([key, file]) => { if (file) form.append(`img__${key}`, file); });
    return form;
  };

  const generate = async (output) => {
    setBusy(output);
    try {
      const response = await request("/api/generate", { method: "POST", body: buildGenerationForm(output) });
      const blob = await response.blob();
      if (output === "preview") {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
      } else {
        const extension = output === "word" ? "docx" : "pdf";
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${data.rae_no || "Trailer"}_Certification_Report.${extension}`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
    } catch (error) {
      window.alert(error.message);
    } finally {
      setBusy("");
    }
  };

  const generateHtmlMaster = async () => {
    setBusy("html-master");
    try {
      // The HTML master receives the identical payload as the normal report:
      // entered grey-field values and calculated variables are never copied
      // into a second client-side form.
      const response = await request("/api/template/html/pdf", { method: "POST", body: buildGenerationForm("pdf") });
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${data.rae_no || "Trailer"}_HTML_Master_Report.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setBusy("");
    }
  };

  const openInStudio = async () => {
    setBusy("studio");
    try {
      const response = await request("/api/generate", { method: "POST", body: buildGenerationForm("pdf") });
      const blob = await response.blob();
      const name = `${data.rae_no || "Trailer"}_Certification_Report.pdf`;
      const form = new FormData();
      form.append("file", blob, name);
      form.append("name", name);
      const opened = await request("/api/pdf/open", { method: "POST", body: form });
      const payload = await opened.json();
      if (!payload?.info?.doc_id) throw new Error("PDF Studio could not open the generated report.");
      router.push(`/studio?doc=${payload.info.doc_id}`);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setBusy("");
    }
  };


  const downloadTemplate = async (format) => {
    try {
      const response = await request(format === "word" ? "/api/template/word" : "/api/template");
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = format === "word" ? "Trailer_Report_TEMPLATE.docx" : "Trailer_Report_TEMPLATE.pdf";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) {
      window.alert(error.message);
    }
  };

    /* ---------------- Dashboard: report records ---------------- */

  const userKey = user ? String(user.id ?? user.email) : "";

  useEffect(() => {
    if (!userKey || !csrf) return;
    let dead = false;
    (async () => {
      try {
        const [r, f] = await Promise.all([request("/api/report-store/reports"), request("/api/report-store/folders")]);
        const rj = await r.json();
        const fj = await f.json();
        if (dead) return;
        rj.reports.forEach((x) => syncedReports.current.add(x.id));
        setReports(rj.reports);
        setFolders(fj.folders);
      } catch (e) {
        console.error("Could not load reports", e);
      }
      if (!dead) setReportsLoaded(true);
    })();
    return () => { dead = true; };
  }, [userKey, csrf, request]);

  /* Keep the current report's card up to date (only when something really changed). */
  useEffect(() => {
    if (!schema || !reportsLoaded || !user) return;
    const hasContent = [data.rae_no, data.project_name, data.report_title].some((v) => String(v ?? "").trim()) || standards.length > 0;
    if (!hasContent) return;
    const snapshot = { data, standards, selected, layout, materialMode, selectedMaterialId, materialMeta, extraImages, removedSchemaImages };
    const sig = JSON.stringify(snapshot);
    const figures = Object.values(files).filter(Boolean).length;
    const id = activeReportId || pendingId.current || (pendingId.current = newId());
    if (!activeReportId) setActiveReportId(id);
    setReports((cur) => {
      const prev = cur.find((r) => r.id === id);
      const nextFigures = figures || prev?.figures || 0;
      if (prev && prev.sig === sig && prev.figures === nextFigures) return cur;
      const now = Date.now();
      const meta = {
        title: String(data.report_title || "").trim() || String(data.project_name || "").trim() || "Untitled report",
        rae: data.rae_no || "",
        project: data.project_name || "",
        rev: data.rev || "",
        axle: data.axle_type || "",
        sections: selected.length,
        figures: nextFigures,
        editor: user.full_name || user.email || "",
        snapshot,
        sig,
        updatedAt: now,
      };
      if (prev) return cur.map((r) => (r.id === id ? { ...r, ...meta } : r));
      return [{ id, status: "draft", starred: false, pinned: false, folder: "", thumb: "", createdAt: now, lastViewedAt: now, ...meta }, ...cur];
    });
  }, [schema, reportsLoaded, user, data, standards, selected, layout, materialMode, selectedMaterialId, materialMeta, extraImages, removedSchemaImages, files, activeReportId]);

  /* Card thumbnail = first attached figure */
  useEffect(() => {
    if (!activeReportId) return;
    const first = Object.values(files).find(Boolean);
    if (!first) return;
    let dead = false;
    makeThumb(first).then((thumb) => {
      if (dead || !thumb) return;
      setReports((cur) => cur.map((r) => (r.id === activeReportId && r.thumb !== thumb ? { ...r, thumb } : r)));
    });
    return () => { dead = true; };
  }, [files, activeReportId]);

  useEffect(() => {
    if (!reportsLoaded || !activeReportId) return;
    const r = reports.find((x) => x.id === activeReportId);
    if (!r || !r.snapshot) return;
    const key = `${r.sig}|${r.figures}|${r.thumb?.length || 0}|${JSON.stringify(editorStates).length}`;
    if (lastSaved.current[r.id] === key) return;
    const timer = window.setTimeout(async () => {
      try {
        await request(`/api/report-store/reports/${r.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: r.title, rae: r.rae, project: r.project, rev: r.rev, axle: r.axle, editor: r.editor,
            sections: r.sections, figures: r.figures, thumb: r.thumb || "", sig: r.sig,
            snapshot: r.snapshot, editor_states: editorStates,
          }),
        });
        syncedReports.current.add(r.id);
        lastSaved.current[r.id] = key;
        setSyncTick((n) => n + 1);
      } catch (e) {
        console.error("Report save failed", e);
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [reports, activeReportId, editorStates, reportsLoaded, request]);

  useEffect(() => {
    const id = activeReportId;
    if (!id || !syncedReports.current.has(id)) return;
    const timer = window.setTimeout(async () => {
      const rec = (syncedImages.current[id] ||= { current: {}, original: {} });
      try {
        for (const [kind, map] of [["current", files], ["original", originals]]) {
          for (const [iid, file] of Object.entries(map)) {
            if (!file || rec[kind][iid] === file) continue;
            const form = new FormData();
            form.append("file", file);
            await request(`/api/report-store/reports/${id}/images/${iid}?kind=${kind}`, { method: "PUT", body: form });
            rec[kind][iid] = file;
          }
          for (const iid of Object.keys(rec[kind])) {
            if (map[iid]) continue;
            await request(`/api/report-store/reports/${id}/images/${iid}?kind=${kind}`, { method: "DELETE" });
            delete rec[kind][iid];
          }
        }
      } catch (e) {
        console.error("Photo sync failed", e);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [files, originals, activeReportId, syncTick, request]);

  const loadServerMedia = async (id) => {
    const res = await request(`/api/report-store/reports/${id}`);
    const full = await res.json();
    const f = {};
    const o = {};
    await Promise.all(full.images.map(async (im) => {
      try {
        const r = await request(`/api/report-store/reports/${id}/images/${im.image_id}?kind=${im.kind}`);
        const blob = await r.blob();
        const file = new File([blob], im.filename || `${im.image_id}.png`, { type: im.mime || blob.type });
        (im.kind === "original" ? o : f)[im.image_id] = file;
      } catch (error) {
        // A stale image row should not prevent the rest of the report from loading.
        if (error.status !== 404) throw error;
      }
    }));
    syncedImages.current[id] = { current: { ...f }, original: { ...o } };
    return { full, files: f, originals: o };
  };

  useEffect(() => {
    if (!reportsLoaded || !activeReportId || hydratedRef.current === activeReportId) return;
    hydratedRef.current = activeReportId;
    if (Object.values(files).some(Boolean) || !syncedReports.current.has(activeReportId)) return;
    loadServerMedia(activeReportId)
      .then((m) => {
        setFiles(m.files);
        setOriginals(m.originals);
        setEditorStates(m.full.editor_states || {});
      })
      .catch((e) => console.error(e));
  }, [reportsLoaded, activeReportId]); // eslint-disable-line react-hooks/exhaustive-deps


  const resetWorkspace = () => {
    if (!schema) return;
    const blank = Object.fromEntries(
      schema.general.map((f) => [f.id, f.default || (f.type === "date" ? new Date().toISOString().slice(0, 10) : "")])
    );
    if (user?.initials) blank.prepared_by = user.initials;
    pendingId.current = "";
    setActiveReportId("");
    setData(blank);
    setStandards([]);
    setSelected(schema.sections.map((s) => s.id));
    setExtraImages({});
    setRemovedSchemaImages({});
    setFiles({});
    setOriginals({});
    setEditorStates({});
    setEditingImage(null);
    setPreview(null);
    setSelectedMaterialId("");
    setMaterialMode("library");
    setMaterialMeta({ material_type: "", category: "steel", source_standard_id: "", notes: "" });
  };

  const writeDraft = (d) => {
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ }
  };

  const createReport = () => {
    resetWorkspace();
    const blank = Object.fromEntries(
      schema.general.map((f) => [f.id, f.default || (f.type === "date" ? new Date().toISOString().slice(0, 10) : "")])
    );
    if (user?.initials) blank.prepared_by = user.initials;
    writeDraft({
      data: blank, standards: [], selected: schema.sections.map((s) => s.id), layout,
      materialMode: "library", selectedMaterialId: "", materialMeta: { material_type: "", category: "steel", source_standard_id: "", notes: "" },
      activeReportId: "", extraImages: {}, removedSchemaImages: {},
    });
    router.push("/");
  };

  const openReport = async (id) => {
    if (!reports.find((r) => r.id === id)) return;
    try {
      if (id !== activeReportId) {
        const { full, files: f, originals: o } = await loadServerMedia(id);
        const s = full.snapshot || {};
        const mat = { material_type: "", category: "steel", source_standard_id: "", notes: "" };
        hydratedRef.current = id;
        pendingId.current = "";
        setData(s.data || {});
        setStandards(s.standards || []);
        setSelected(s.selected || schema.sections.map((x) => x.id));
        setLayout(s.layout || layout);
        setMaterialMode(s.materialMode === "manual" ? "manual" : "library");
        setSelectedMaterialId(s.selectedMaterialId || "");
        setMaterialMeta(s.materialMeta || mat);
        setExtraImages(s.extraImages || {});
        setRemovedSchemaImages(s.removedSchemaImages || {});
        setFiles(f);
        setOriginals(o);
        setEditorStates(full.editor_states || {});
        setEditingImage(null);
        setPreview(null);
        setReports((cur) => cur.map((r) => (r.id === id ? { ...r, snapshot: s } : r)));
        setActiveReportId(id);
        writeDraft({
          data: s.data || {}, standards: s.standards || [], selected: s.selected || schema.sections.map((x) => x.id),
          layout: s.layout || layout, materialMode: s.materialMode === "manual" ? "manual" : "library",
          selectedMaterialId: s.selectedMaterialId || "", materialMeta: s.materialMeta || mat,
          activeReportId: id, extraImages: s.extraImages || {}, removedSchemaImages: s.removedSchemaImages || {},
        });
      }
      router.push("/");
    } catch (e) {
      window.alert(e.message || "Could not open this report.");
    }
  };

  const updateReport = (id, patch) => {
    setReports((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => ["status", "starred", "pinned", "folder"].includes(k)));
    if (Object.keys(allowed).length && syncedReports.current.has(id)) {
      request(`/api/report-store/reports/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(allowed),
      }).catch((e) => console.error(e));
    }
  };

  const duplicateReport = async (id) => {
    try {
      const res = await request(`/api/report-store/reports/${id}/duplicate`, { method: "POST" });
      const copy = await res.json();
      syncedReports.current.add(copy.id);
      setReports((cur) => [copy, ...cur]);
    } catch (e) {
      window.alert(e.message || "Could not duplicate the report.");
    }
  };

  const deleteReport = async (id) => {
    if (!window.confirm("Delete this report and its photos? This can't be undone.")) return;
    try {
      if (syncedReports.current.has(id)) await request(`/api/report-store/reports/${id}`, { method: "DELETE" });
      syncedReports.current.delete(id);
      delete syncedImages.current[id];
      setReports((cur) => cur.filter((r) => r.id !== id));
      if (id === activeReportId) resetWorkspace();
    } catch (e) {
      window.alert(e.message || "Could not delete the report.");
    }
  };

  const addFolder = async (rawName) => {
    const name = String(rawName || "").trim();
    if (!name) return "Enter a folder name.";
    if (folders.some((f) => f.toLowerCase() === name.toLowerCase())) return "A folder with this name already exists.";
    try {
      await request("/api/report-store/folders", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      setFolders((cur) => [...cur, name]);
      return "";
    } catch (e) {
      return e.message || "Could not create the folder.";
    }
  };

  if (!ready) {
    return (
      <Shell>
        <main className="grid min-h-screen place-items-center">
          <p className="animate-pulse text-sm font-medium text-[#b9dcda]">Loading ReportGenix…</p>
        </main>
      </Shell>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        authMode={authMode}
        setAuthMode={(mode) => { setAuthMode(mode); setAuthStatus(""); }}
        authForm={authForm}
        setAuthForm={setAuthForm}
        submit={submitAuth}
        status={authStatus}
        busy={busy}
        onForgot={() => setAuthStatus("Password reset isn't available yet. Contact your administrator.")}
      />
    );
  }

  if (!schema) {
    return (
      <Shell>
        <main className="grid min-h-screen place-items-center px-6 text-center">
          <p className="animate-pulse text-sm font-medium text-[#b9dcda]">{authStatus || "Loading report workspace…"}</p>
        </main>
      </Shell>
    );
  }

  const generalFields = schema.general.filter((field) => !MATERIAL_IDS.has(field.id) && field.id !== "rae_no" && field.id !== "prepared_by");
  const raeField = schema.general.find((field) => field.id === "rae_no");
  const preparedByField = schema.general.find((field) => field.id === "prepared_by");
  const sectionId = pathname.startsWith("/section/") ? decodeURIComponent(pathname.slice("/section/".length)) : "";
  const activeSection = reportSections.find((section) => section.id === sectionId);
  const activeSectionIndex = reportSections.findIndex((section) => section.id === sectionId);
  const previousSection = activeSectionIndex > 0 ? reportSections[activeSectionIndex - 1] : null;
  const nextSection = activeSectionIndex >= 0 && activeSectionIndex < reportSections.length - 1
    ? reportSections[activeSectionIndex + 1]
    : null;
  const navigateToSection = (section) => {
    if (section) router.push(`/section/${encodeURIComponent(section.id)}`);
  };
  /* /faq and /raq are the same page (Raised and Answered Questions) */
  const route =
    pathname === "/dashboard"
      ? "dashboard"
      : pathname === "/"
        ? "home"
        : pathname === "/projects"
          ? "projects"
          : pathname === "/layout"
            ? "layout"
            : pathname === "/issue"
              ? "issue"
              : pathname === "/help"
                ? "help"
                : pathname === "/faq" || pathname === "/raq"
                  ? "faq"
                  : activeSection
                    ? "section"
                    : "not-found";

  // Build breadcrumb items from the resolved route. Always return an array so
  // the breadcrumb renderer can safely call crumbs.map(...).
  const routeCrumb = {
    home: { label: "Project", href: null },
    projects: { label: "Libraries", href: null },
    issue: { label: "Preview and Download", href: null },
    help: { label: "Help", href: null },
    faq: { label: "FAQ", href: null },
    dashboard: { label: "Dashboard", href: null },
    "not-found": { label: "Page not found", href: null },
  };
  const crumbs = route === "section"
    ? [{ label: "Sections", href: "/projects" }, { label: data[`heading__${activeSection.id}`] || activeSection.title, href: null }]
    : [routeCrumb[route] || routeCrumb["not-found"]];

  const navClass = (active) => `rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-[#f84f63] text-[#0a1f36]" : "text-[#c6dce2] hover:bg-white/5 hover:text-white"}`;
  const workspaceClass = route === "dashboard"
    ? "px-4 py-4 sm:px-6"
    : route === "section"
      ? "w-full px-0 py-0 sm:px-1 sm:py-1 lg:px-1"
      : "w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-6";
  const pageHeaderClass = route === "section"
    ? "mb-0.5 w-full max-w-[420px] rounded-lg border border-[#2a5068] bg-[#0e3250] px-3 py-1.5"
    : "mb-6 flex flex-col justify-between gap-4 rounded-2xl border border-[#2a5068] bg-[#0e3250] px-5 py-5 sm:flex-row sm:items-center sm:px-7";

  /* ---- Sidebar data: built from the app's own routes and state ---- */
  const filled = (value) => String(value ?? "").trim() !== "";
  const sectionDone = (section) =>
    (section.fields || []).some((field) => filled(data[field.id])) || (section.images || []).some((image) => Boolean(files[image.id]));

  // Keep the sidebar to the four main workflow stages. The Section stage opens
  // the PDF editor directly; individual report sections are navigated inside
  // that editor so they do not appear as a long nested sidebar list.
  const firstReportSection = reportSections[0];
  const sectionsComplete = reportSections.length > 0 && reportSections.every(sectionDone);

  const sidebarSteps = [
  { key: "home", href: "/", label: "Project", sub: "Report details", active: route === "home", done: filled(data.rae_no) && filled(data.project_name) },
  { key: "projects", href: "/projects", label: "Libraries", sub: "Materials & compliance", active: route === "projects", done: standards.length > 0 && filled(data.material) },
  {
    key: "sections",
    href: firstReportSection ? `/section/${encodeURIComponent(firstReportSection.id)}` : "/projects",
    label: "Section",
    sub: "Report sections",
    active: route === "section",
    done: sectionsComplete,
  },
  { key: "issue", href: "/issue", label: "Preview and Download", sub: "Preview & export", active: route === "issue", done: false },
];

  const sidebarExtraLinks = [
    { href: "/studio", label: "PDF Studio", icon: "▤", active: false },
    { href: "/help", label: "Help", icon: "❓", active: route === "help" },
    { href: "/faq", label: "FAQ", icon: "❔", active: route === "faq" },
  ];

  /* Completeness: project fields filled, compliance rows added, evidence attached */
  const projectRatio = schema.general.length ? schema.general.filter((field) => filled(data[field.id])).length / schema.general.length : 0;
  const complianceRatio = reportRows.length > 0 ? 1 : 0;
  const evidenceRatio = Object.values(files).some(Boolean) ? 1 : 0;
  const completeness = Math.round(((projectRatio + complianceRatio + evidenceRatio) / 3) * 100);

  const PANEL_COMPACT =
  "[&_input]:!py-1.5 [&_input]:!text-xs [&_select]:!py-1.5 [&_select]:!text-xs [&_textarea]:!text-xs " +
  "[&_label]:!text-[10px] [&_span]:!text-[10px] [&_h2]:!text-base [&_h3]:!text-sm [&_section]:!p-3 [&_section]:!rounded-xl";

  const sectionFieldsPanel = (
    <div className="space-y-3">
      <details open className="rounded-xl border border-[#234b63] bg-[#0a2744]/60">
        <summary className="cursor-pointer select-none px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-[#c9dfe3]">Project</summary>
        <div className={`grid gap-3 border-t border-[#234b63] p-2 ${PANEL_COMPACT}`}>
          {raeField && (
            <Labeled label={raeField.label + (raeField.unit ? " (" + raeField.unit + ")" : "") + " Lookup"}>
              <div className="flex items-center gap-2">
                <input className={INPUT} type="text" value={data.rae_no ?? ""} onChange={(e) => setData((current) => ({ ...current, rae_no: e.target.value }))} />
                {raeLookup.status === "loading" && <span className="shrink-0 text-xs text-[#b9d2d3]">searching…</span>}
                {raeLookup.status === "ok" && <span className="shrink-0 text-xs text-[#6fd08a]">{raeLookup.message}</span>}
                {raeLookup.status === "error" && <span className="shrink-0 text-xs text-[#ff8e9c]">{raeLookup.message}</span>}
              </div>
            </Labeled>
          )}
          {preparedByField && (
            <Labeled label={preparedByField.label + (preparedByField.unit ? " (" + preparedByField.unit + ")" : "")}>
              <input className="w-full cursor-not-allowed rounded border border-[#2f5b75] bg-[#0a2744]/50 px-3 py-2 text-sm text-[#8fbcc0] focus:outline-none" type="text" value={data.prepared_by ?? user.initials ?? ""} readOnly />
              <span className="text-xs text-[#6b7c86]">Auto-filled from your profile initials</span>
            </Labeled>
          )}
          {generalFields.map((field) => (
            <Field key={field.id} field={field} value={data[field.id]} onChange={(value) => setData((current) => ({ ...current, [field.id]: value }))} />
          ))}
        </div>
      </details>
      <details className="rounded-xl border border-[#234b63] bg-[#0a2744]/60">
        <summary className="cursor-pointer select-none px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-[#c9dfe3]">Libraries</summary>
        <div className={`space-y-4 border-t border-[#234b63] p-2 ${PANEL_COMPACT}`}>
          <MaterialEditor catalog={materialsCatalog} mode={materialMode} setMode={setMaterialMode} selectedId={selectedMaterialId} setSelectedId={setSelectedMaterialId} data={data} setData={setData} materialMeta={materialMeta} setMaterialMeta={setMaterialMeta} status={materialStatus} />
          <ComplianceEditor rows={standards} setRows={setStandards} catalog={standardsCatalog} request={request} />
        </div>
      </details>
    </div>
  );

  return (
    <Shell>
      {route !== "dashboard" && route !== "section" && sidebarOpen && <div className="fixed inset-0 z-40 bg-[#0a1f36]/40 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />}
      {route !== "dashboard" && route !== "section" && (
        <SidebarNav
          steps={sidebarSteps}
          extraLinks={sidebarExtraLinks}
          completeness={completeness}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapsed}
          user={user}
          openProfile={openProfile}
          dashboardActive={false}
        />
      )}

      {/* Everything to the right of the fixed sidebar on large screens */}
        <div className={`transition-[padding] duration-300 ${route === "dashboard" || route === "section" ? "" : sidebarCollapsed ? "lg:pl-[76px]" : "lg:pl-72"}`}>
        <header className={`sticky top-0 z-30 w-full min-w-0 border-b border-[#2a5068]/60 bg-[#0a2744]/95 backdrop-blur ${route === "section" ? "px-2 py-1 sm:px-4 lg:px-6" : "px-2 pt-3 pb-4 sm:px-4 sm:pb-6 lg:px-6"}`}>
          <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 sm:gap-3">
            {route !== "dashboard" && route !== "section" && (
              <button
                onClick={() => setSidebarOpen((prev) => !prev)}
                className="rounded-md border border-[#2f5b75] bg-[#0e3250] px-3 py-1.5 text-base font-semibold text-[#c8dfe1] hover:bg-white/10 focus:outline-none focus:border-[#f84f63] lg:hidden"
                aria-label="Toggle sidebar"
                aria-expanded={sidebarOpen}
              >
                ≡
              </button>
            )}
            <Link href="/dashboard" className={`flex shrink-0 items-center gap-3 ${route === "dashboard" ? "" : "lg:hidden"}`}>
              <img src="/csa_logo.webp" alt="CSA Engineering" className="h-9 w-auto" />
              <span className="border-l border-[#2f5b75] pl-3 text-base font-semibold">ReportGenix</span>
            </Link>
            {route === "section" ? (
              <div className="min-w-0 flex-1 px-1 sm:px-2">
                <h1 className="truncate text-base font-semibold text-white">
                  <SectionTitle key={activeSection.id} value={data[`heading__${activeSection.id}`]} fallback={activeSection.title} onChange={(v) => setData((current) => ({ ...current, [`heading__${activeSection.id}`]: v }))} />
                </h1>
              </div>
            ) : null}
            <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5 sm:gap-2">
              <div data-tour="help-tabs" className="hidden shrink-0 items-center gap-1 md:flex">
                <Link href="/dashboard" className={navClass(route === "dashboard")}>Dashboard</Link>
                <Link href="/studio" className={navClass(false)}>PDF Studio</Link>
                <button onClick={() => setTourOpen(true)} className={navClass(false)}>Help</button>
                <Link href="/faq" className={navClass(route === "faq")}>FAQ</Link>
              </div>
              <button
  data-tour="profile"
  onClick={openProfile}
  className="group flex min-w-0 items-center gap-2 rounded-lg border border-[#2f5b75] bg-[#0e3250] px-2.5 py-2 text-xs text-[#c8dfe1] transition duration-200 hover:-translate-y-px hover:border-[#f84f63]/70 hover:bg-[#16415f] focus:outline-none focus:border-[#f84f63] sm:gap-3 sm:px-4 sm:text-sm"
  aria-label="Profile"
>
  {user.avatar_url ? (
    <img src={user.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
  ) : (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f84f63] text-xs font-bold text-[#0a1f36]">
      {user.initials || initials(user.full_name || user.email)}
    </span>
  )}
  <span className="hidden max-w-[160px] truncate sm:inline">{user.full_name || user.email}</span>
</button>
              <ActionButton variant="ghost" onClick={() => downloadTemplate("pdf")} className="hidden !px-4 !py-2 sm:inline-flex">Blank PDF</ActionButton>
              <ActionButton variant="ghost" onClick={logout} className="shrink-0 !px-3 !py-2 sm:!px-4">Sign out</ActionButton>
            </div>
          </div>
        </header>

        <div className={workspaceClass}>
          <div data-tour="page-header" className={`${route === "dashboard" || route === "section" ? "hidden " : ""}${pageHeaderClass}`}><div>{route !== "section" && <p className={EYEBROW}>{route === "home" ? "Project information" : route === "projects" ? "Project" : route === "help" ? "Help & documentation" : route === "faq" ? "RAQ" : "Report issue"}</p>}<h1 className="mt-1 text-2xl font-semibold text-white">{route === "home" ? "Report details" : route === "projects" ? "Materials & compliance" : route === "help" ? "Help & documentation" : route === "faq" ? "Raised and Answered Questions" : "Review and export"}</h1></div><div className="flex flex-wrap gap-2 lg:hidden"><Link href="/" className={navClass(route === "home")}>Project</Link><Link href="/projects" className={navClass(route === "projects")}>Libraries</Link><Link href="/studio" className={navClass(false)}>Studio</Link><Link href="/help" className={navClass(route === "help")}>Help</Link><Link href="/faq" className={navClass(route === "faq")}>RAQ</Link><Link href="/issue" className={navClass(route === "issue")}>Preview and Download</Link></div></div>

          <nav className={`${route === "dashboard" || route === "section" ? "hidden " : ""}flex items-center gap-1 text-xs text-[#8fbcc0] mt-4 ml-2`} aria-label="Breadcrumb">
            <Link href="/" className="hover:text-[#c8dfe1]">Home</Link>
            {crumbs.map((crumb, i) => (
              <span key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                <span>/</span>
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-[#c8dfe1]">{crumb.label}</Link>
                ) : (
                  <span className="text-[#c8dfe1]">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
          {route === "dashboard" && (
            <div>
              <Dashboard
                reports={reports}
                folders={folders}
                activeId={activeReportId}
                onOpen={openReport}
                onCreate={createReport}
                onDuplicate={duplicateReport}
                onDelete={deleteReport}
                onUpdate={updateReport}
                onAddFolder={addFolder}
              />
            </div>
          )}
          {route === "home" && (
            <section className={CARD}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {raeField && (
                  <div className="xl:col-span-3">
                    <Labeled label={raeField.label + (raeField.unit ? " (" + raeField.unit + ")" : "") + " Lookup"}>
                      <div className="flex gap-2">
                        <input
                          className={INPUT}
                          type="text"
                          value={data.rae_no ?? ""}
                          onChange={(e) => setData((current) => ({ ...current, rae_no: e.target.value }))}
                        />
                        {raeLookup.status === "loading" && (
                          <span className="text-xs text-[#b9d2d3]">searching…</span>
                        )}
                        {raeLookup.status === "ok" && (
                          <span className="text-xs text-[#6fd08a]">{raeLookup.message}</span>
                        )}
                        {raeLookup.status === "error" && (
                          <span className="text-xs text-[#ff8e9c]">{raeLookup.message}</span>
                        )}
                      </div>
                    </Labeled>
                  </div>
                )}
                {preparedByField && (
                  <div className="xl:col-span-3">
                    <Labeled label={preparedByField.label + (preparedByField.unit ? " (" + preparedByField.unit + ")" : "")}>
                      <input
                        className="w-full rounded border border-[#2f5b75] bg-[#0a2744]/50 px-3 py-2 text-sm text-[#8fbcc0] focus:outline-none cursor-not-allowed"
                        type="text"
                        value={data.prepared_by ?? user.initials ?? ""}
                        readOnly
                      />
                      <span className="text-xs text-[#6b7c86]">Auto-filled from your profile initials</span>
                    </Labeled>
                  </div>
                )}
                {generalFields.map((field) => (
                  <Field key={field.id} field={field} value={data[field.id]} onChange={(value) => setData((current) => ({ ...current, [field.id]: value }))} />
                ))}
              </div>
            </section>
          )}

          {route === "projects" && <div className="space-y-6"><MaterialEditor catalog={materialsCatalog} mode={materialMode} setMode={setMaterialMode} selectedId={selectedMaterialId} setSelectedId={setSelectedMaterialId} data={data} setData={setData} materialMeta={materialMeta} setMaterialMeta={setMaterialMeta} status={materialStatus} /><ComplianceEditor rows={standards} setRows={setStandards} catalog={standardsCatalog} request={request} /></div>}

          {route === "section" && (
            <div className="h-[calc(100dvh-52px)] min-h-[420px]">
              <SectionPdfEditor
                section={activeSection}
                sections={reportSections}
                schema={schema}
                data={data}
                setData={setData}
                csrf={csrf}
                buildForm={() => buildReportForm("pdf")}
                reportSig={reportSig}
                onUndoChange={undoChange}
                onRedoChange={redoChange}
                canUndoChange={changeHistory.length > 0}
                canRedoChange={changeRedo.length > 0}
                imageApi={{
                  add: (file) => {
                    const id = `extra_${activeSection.id}_${Date.now()}`;
                    setExtraImages((current) => ({ ...current, [activeSection.id]: [...(current[activeSection.id] || []), { id, label: "", h: 60 }] }));
                    setData((current) => ({ ...current, [`cap__${id}`]: "" }));
                    setFiles((current) => ({ ...current, [id]: file }));
                    return id;
                  },
                  replace: (id, file) => {
                    if ((activeSection.images || []).some((img) => img.id === id)) {
                      setRemovedSchemaImages((current) => ({ ...current, [`${activeSection.id}:${id}`]: false }));
                    }
                    handleFileChange(id, file);
                  },
                  remove: (id) => {
                    handleFileChange(id, null);
                    if ((activeSection.images || []).some((img) => img.id === id)) {
                      setRemovedSchemaImages((current) => ({ ...current, [`${activeSection.id}:${id}`]: true }));
                    } else {
                      setExtraImages((current) => ({ ...current, [activeSection.id]: (current[activeSection.id] || []).filter((item) => item.id !== id) }));
                    }
                  },
                  edit: (id) => openImageEditor({ id, label: data[`cap__${id}`] || "Image" }),
                }}
                onBack={() => {
                  const i = reportSections.findIndex((s) => s.id === activeSection.id);
                  router.push(i > 0 ? `/section/${encodeURIComponent(reportSections[i - 1].id)}` : "/projects");
                }}
                onNext={() => {
                  const i = reportSections.findIndex((s) => s.id === activeSection.id);
                  router.push(i >= 0 && i < reportSections.length - 1 ? `/section/${encodeURIComponent(reportSections[i + 1].id)}` : "/issue");
                }}
                fieldsPanel={sectionFieldsPanel}                
              />
              {editingImage && (
                <div className="fixed inset-0 z-[95] bg-[#03121f]/85 p-4">
                  <ImageEditor key={editingImage.id} imageUrl={editingImage.url} initialState={editorStates[editingImage.id]} title={editingImage.label} onSave={handleEditorSave} onClose={closeImageEditor} />
                </div>
              )}
            </div>
          )}

          {route === "issue" && (
            <section className="grid min-w-0 gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className={CARD}>
                <p className={EYEBROW}>Preview &amp; download</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Review and export</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#b6d3d4]">
                  Preview uses the same report engine as the final download. Check warnings and attached evidence before issuing the certification.
                </p>
                <div className="mt-7 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap">
                  <ActionButton
                    onClick={() => {
                      setPreviewExpanded(true);
                      generate("preview");
                    }}
                    disabled={Boolean(busy)}
                    className="flex-1 sm:flex-none"
                  >
                    {busy === "preview" ? "Creating preview…" : "Preview PDF"}
                  </ActionButton>
                  <ActionButton variant="secondary" onClick={() => generate("pdf")} disabled={Boolean(busy)} className="flex-1 sm:flex-none">
                    {busy === "pdf" ? "Creating PDF…" : "Download PDF"}
                  </ActionButton>
                  <ActionButton variant="ghost" onClick={generateHtmlMaster} disabled={Boolean(busy)} className="flex-1 sm:flex-none">
                    {busy === "html-master" ? "Creating master PDF..." : "Download HTML master PDF"}
                  </ActionButton>
                  <ActionButton variant="secondary" onClick={() => generate("word")} disabled={Boolean(busy)} className="flex-1 sm:flex-none">
                    {busy === "word" ? "Creating Word…" : "Download Word"}
                  </ActionButton>
                  <ActionButton variant="ghost" onClick={openInStudio} disabled={Boolean(busy)} className="flex-1 sm:flex-none">
                    {busy === "studio" ? "Opening Studio…" : "Open in PDF Studio"}
                  </ActionButton>
                  <ActionButton variant="ghost" onClick={() => downloadTemplate("word")} className="flex-1 sm:flex-none">Blank Word</ActionButton>
                </div>
                {previewUrl && !previewExpanded && (
                  <div className="mt-7 overflow-hidden rounded-xl border border-[#2a5068] bg-[#061d31]">
                    <div className="flex items-center justify-between gap-3 border-b border-[#2a5068] bg-[#0b2b47] px-4 py-2">
                      <span className="text-xs font-medium text-[#c8dfe1]">PDF preview</span>
                      <button
                        type="button"
                        onClick={() => setPreviewExpanded(true)}
                        className="rounded-md border border-[#2f5b75] px-3 py-1.5 text-xs font-semibold text-[#c8dfe1] transition hover:border-[#f84f63] hover:text-white"
                      >
                        Expand preview
                      </button>
                    </div>
                    <iframe title="Generated report preview" src={previewUrl} className="h-[55dvh] min-h-[320px] w-full sm:h-[70vh] sm:min-h-[420px] lg:h-[720px]" />
                  </div>
                )}
                <AnimatePresence>
                  {previewUrl && previewExpanded && (
                    <motion.div
                      className="fixed inset-0 z-[100] flex flex-col bg-[#061523]/95 p-2 backdrop-blur-sm sm:p-4"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      role="dialog"
                      aria-modal="true"
                      aria-label="Expanded PDF preview"
                    >
                      <motion.div
                        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#2f5b75] bg-[#0b2b47] shadow-2xl"
                        initial={{ opacity: 0, y: 14, scale: 0.99 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.99 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      >
                        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#2f5b75] px-3 py-2.5 sm:px-5">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">PDF Preview</p>
                            <p className="text-[11px] text-[#9bbcc0]">Expanded view</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPreviewExpanded(false)}
                            className="shrink-0 rounded-md border border-[#2f5b75] px-3 py-2 text-xs font-semibold text-[#c8dfe1] transition hover:border-[#f84f63] hover:bg-[#f84f63]/10 hover:text-white"
                            aria-label="Minimize PDF preview"
                          >
                            Minimize ✕
                          </button>
                        </div>
                        <iframe
                          title="Expanded generated report PDF preview"
                          src={previewUrl}
                          className="min-h-0 w-full flex-1 bg-[#202124]"
                        />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <aside className="h-fit rounded-2xl border border-[#2a5068] bg-[#0b2b47] p-6">
                <h3 className="font-semibold text-white">Preview checklist</h3>
                <div className="mt-5 space-y-4 text-sm text-[#bdd6d6]">
                  <p><b className="text-[#f84f63]">{selected.length}</b> sections included</p>
                  <p><b className="text-[#f84f63]">{reportRows.length}</b> compliance rows</p>
                  <p><b className="text-[#f84f63]">{Object.values(files).filter(Boolean).length}</b> evidence files attached</p>
                </div>
                <div className="mt-8 rounded-xl bg-[#77c2bd]/10 p-4 text-xs leading-5 text-[#cbe3df]">
                  The certificate includes the standard verification QR and Australia watermark automatically.
                </div>
              </aside>
            </section>
          )}

          {route === "help" && (
            <section className={CARD}>
              <p className={EYEBROW}>Help & documentation</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">Help & documentation</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#b6d3d4]">
                Learn how to create trailer certification reports, manage project libraries, and issue final documents.
                Preview uses the same report engine as the final download. The Word file is a page-faithful visual
                companion of the controlled PDF; its pages are not independently editable. Check warnings and attached
                evidence before issuing the certification.
              </p>
              <div className="mt-7 space-y-4">
                <div className="rounded-xl border border-[#2f5b75] bg-[#0a2744] p-4">
                  <h4 className="font-semibold text-white mb-2">Getting started</h4>
                  <ul className="text-sm text-[#c8dfe1] space-y-2 list-disc pl-5">
                    <li>Enter RAE ID to look up project details automatically</li>
                    <li>Add materials from the project library</li>
                    <li>Complete compliance entries for each standard</li>
                    <li>Attach evidence images to report sections</li>
                    <li>Preview and export PDF or Word reports</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-[#2f5b75] bg-[#0a2744] p-4">
                  <h4 className="font-semibold text-white mb-2">Project libraries</h4>
                  <ul className="text-sm text-[#c8dfe1] space-y-2 list-disc pl-5">
                    <li>Standards library — browse applicable standards and clauses</li>
                    <li>Materials library — manage steel, bolt, and welding material data</li>
                    <li>Source standards — link compliance entries to source documents</li>
                  </ul>
                </div>
              </div>
            </section>
          )}

          {route === "faq" && (
            <section className={CARD}>
              <p className={EYEBROW}>FAQ</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">Raised and Answered Questions</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#b6d3d4]">
                Common questions and answers about trailer certification reports.
              </p>
              <div className="mt-7 space-y-3">
                <div className="rounded-xl border border-[#2f5b75] bg-[#0a2744] p-4">
                  <h4 className="font-semibold text-white mb-2">How do I find my project by RAE ID?</h4>
                  <p className="text-sm text-[#b6d3d4] mt-1">Enter the RAE ID in the Project information page and the project name will be filled in automatically using fuzzy matching.</p>
                </div>
                <div className="rounded-xl border border-[#2f5b75] bg-[#0a2744] p-4">
                  <h4 className="font-semibold text-white mb-2">How do I set my profile initials?</h4>
                  <p className="text-sm text-[#b6d3d4] mt-1">Open the profile menu from your avatar, enter initials (up to 5 characters), and they will appear on your Prepared By field automatically.</p>
                </div>
                <div className="rounded-xl border border-[#2f5b75] bg-[#0a2744] p-4">
                  <h4 className="font-semibold text-white mb-2">Can I attach images to sections?</h4>
                  <p className="text-sm text-[#b6d3d4] mt-1">Yes — use the + Add image button on any section card to upload evidence images. Captions and placement are configurable per image.</p>
                </div>
              </div>
            </section>
          )}
          {route === "not-found" && <section className={CARD}><p className="text-[#ff8e9c]">This report page does not exist.</p><Link href="/" className="mt-4 inline-block text-sm font-semibold text-[#8ed0c9] underline">Return to project details</Link></section>}
          <div data-tour="stage-nav" className={`${route === "dashboard" ? "hidden " : ""}mt-12 border-t border-[#2a5068]/40 pt-8 px-6`}>
            <div className="flex flex-wrap justify-between items-center gap-4">
              <div className="text-xs text-[#6b7c86] uppercase tracking-wider font-medium">Stage navigation</div>
              <div className="flex items-center gap-3 text-sm text-[#b9d2d3]">
                <span className="text-[#6b7c86]">{route === "home" ? "1" : route === "projects" ? "2" : route === "section" ? "3" : "4"} / 4</span>
              </div>
              <div className="flex w-full gap-3 sm:w-auto">
                <button
                  onClick={() => {
                    if (route === "home") router.push("/");
                    else if (route === "projects") router.push("/");
                    else if (route === "section") {
                      const idx = reportSections.findIndex((s) => s.id === activeSection.id);
                      router.push(idx > 0 ? `/section/${reportSections[idx - 1].id}` : "/projects");
                    } else if (route === "issue") router.push("/section/" + (reportSections[reportSections.length - 1]?.id || ""));
                  }}
                  className="min-h-10 flex-1 rounded-md px-4 py-2 text-sm font-semibold border border-[#2f5b75] bg-transparent text-[#b9d2d3] hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed sm:flex-none"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    if (route === "home") router.push("/projects");
                    else if (route === "projects") {
                      const firstSection = reportSections[0];
                      router.push(firstSection ? `/section/${firstSection.id}` : "/issue");
                    }
                    else if (route === "section") {
                      const idx = reportSections.findIndex((s) => s.id === activeSection.id);
                      router.push(idx < reportSections.length - 1 ? `/section/${reportSections[idx + 1].id}` : "/issue");
                    } else if (route === "issue") router.push("/issue");
                  }}
                  className="min-h-10 flex-1 rounded-md px-4 py-2 text-sm font-semibold border border-[#f84f63] bg-[#f84f63] text-[#0a1f36] hover:bg-[#ff667a] disabled:opacity-30 disabled:cursor-not-allowed sm:flex-none"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <TourGuide open={tourOpen} onClose={() => setTourOpen(false)} />

      <AnimatePresence>
      {profileModal && (
        <motion.div
          className="fixed inset-x-0 bottom-0 top-[64px] z-[70] flex items-start justify-end overflow-y-auto px-3 pb-4 pt-2 sm:px-6 lg:px-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeProfile();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-profile-title"
            className="relative mt-0 max-h-[calc(100dvh-82px)] w-full max-w-[390px] overflow-y-auto rounded-xl border border-[#47718a] bg-gradient-to-br from-[#123b59] via-[#0b2b47] to-[#09243d] p-4 shadow-[0_22px_70px_rgba(0,0,0,.48)] ring-1 ring-white/5 sm:rounded-2xl sm:p-5"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 28, mass: 0.8 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 id="manage-profile-title" className="text-sm font-semibold text-white">Manage Profile</h3>
              <button onClick={closeProfile} className="rounded-full border border-[#2f5b75] bg-transparent px-2 py-1 text-xs text-[#c8dfe1] hover:bg-white/5">&times;</button>
            </div>
            {profileStatus && (
              <p className={`mb-3 text-sm ${profileStatus === "Profile saved." || profileStatus === "Password changed." ? "text-[#6fd08a]" : "text-[#ff8e9c]"}`}>{profileStatus}</p>
            )}
            {resetMode ? (
              <form onChange={() => setProfileStatus("")} onSubmit={(e) => { e.preventDefault(); doResetPassword(); }}>
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Forgot password — authenticate</label>
                    <p className="mb-2 text-xs text-[#8fbcc0]">Enter your current password to verify, then set a new password.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Current password</label>
                    <div className="relative">
                      <input
                        className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-[13px] text-white pr-10 focus:outline-none focus:border-[#f84f63]"
                        type={passwordVisible ? "text" : "password"}
                        value={resetForm.current_password}
                        onChange={(e) => setResetForm((current) => ({ ...current, current_password: e.target.value }))}
                        placeholder="Current password"
                      />
                      <button
                        type="button"
                        onClick={() => setPasswordVisible((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[#2f5b75] bg-transparent px-1 py-0 text-[10px] text-[#8fbcc0] hover:text-[#c8dfe1]"
                        aria-label="Toggle password visibility"
                      >
                        {passwordVisible ? "🙈" : "👁"}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">New password</label>
                    <div className="relative">
                      <input
                        className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-[13px] text-white pr-10 focus:outline-none focus:border-[#f84f63]"
                        type={passwordVisible ? "text" : "password"}
                        value={resetForm.new_password}
                        onChange={(e) => setResetForm((current) => ({ ...current, new_password: e.target.value }))}
                        placeholder="New password (min 8 chars)"
                      />
                      <button
                        type="button"
                        onClick={() => setPasswordVisible((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[#2f5b75] bg-transparent px-1 py-0 text-[10px] text-[#8fbcc0] hover:text-[#c8dfe1]"
                        aria-label="Toggle password visibility"
                      >
                        {passwordVisible ? "🙈" : "👁"}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-[#8fbcc0]">Authentication required: your current password must be correct before the new password is saved.</p>
                </div>
                <div className="mt-4 flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => { setResetMode(false); setProfileStatus(""); }}
                    className="flex-1 rounded-md border border-[#2f5b75] bg-transparent px-4 py-2 text-sm font-semibold text-[#c8dfe1] hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={Boolean(profileBusy)}
                  >
                    Back to profile
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-md border border-[#f84f63] bg-[#f84f63] px-4 py-2 text-sm font-semibold text-[#0a1f36] hover:bg-[#ff667a] disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={Boolean(profileBusy)}
                  >
                    {profileBusy === "save" ? "Resetting…" : "Reset password"}
                  </button>
                </div>
              </form>
            ) : (
              <form onChange={() => setProfileStatus("")} onSubmit={(e) => { e.preventDefault(); updateProfile(); }}>
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Full name</label>
                    <input
                      className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#f84f63]"
                      value={profileForm.full_name}
                      onChange={(e) => setProfileForm((current) => ({ ...current, full_name: e.target.value }))}
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Email</label>
                    <input
                      className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#f84f63]"
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm((current) => ({ ...current, email: e.target.value }))}
                      placeholder="email@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Initials</label>
                    <input
                      className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#f84f63] uppercase"
                      maxLength={5}
                      value={profileForm.initials}
                      onChange={(e) => setProfileForm((current) => ({ ...current, initials: e.target.value.toUpperCase() }))}
                      placeholder="JD"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Profile picture (upload)</label>
                    <div className="relative group">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                        className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#f84f63]"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setProfileForm((current) => ({ ...current, avatar_file: file }));
                          const url = URL.createObjectURL(file);
                          setAvatarPreview(url);
                          uploadAvatar(file);
                        }}
                      />
                      {avatarPreview && (
                        <div className="absolute right-2 top-2 flex items-center gap-2">
                          <img src={avatarPreview} alt="Preview" className="w-8 h-8 rounded-full border border-[#2f5b75] object-cover" />
                          <span className="text-[10px] text-[#6fd08a] font-medium">Preview</span>
                        </div>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-[#6b7c86]">Upload a PNG, JPG, GIF, or WEBP image (max 2 MB). Saved to your profile.</p>
                  </div>
                  <div className="grid gap-3">
                    <div>
                      <label className="block text-xs text-[#8fbcc0] mb-1">Current password</label>
                      <div className="relative">
                        <input
                          className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-[13px] text-white pr-10 focus:outline-none focus:border-[#f84f63]"
                          type={passwordVisible ? "text" : "password"}
                          value={profileForm.current_password}
                          onChange={(e) => setProfileForm((current) => ({ ...current, current_password: e.target.value }))}
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setPasswordVisible((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[#2f5b75] bg-transparent px-1 py-0 text-[10px] text-[#8fbcc0] hover:text-[#c8dfe1]"
                          aria-label="Toggle password visibility"
                        >
                          {passwordVisible ? "🙈" : "👁"}
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-[#8fbcc0]">Initials are derived from your full name and shown on your profile avatar.</p>
                  <button
                    type="button"
                    onClick={() => { setResetMode(true); setProfileStatus(""); }}
                    className="w-full rounded-md border border-[#2f5b75] bg-transparent px-3 py-2 text-sm font-semibold text-[#8ed0c9] hover:bg-white/5"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="mt-4 flex gap-2.5">
                  <button
                    type="button"
                    onClick={closeProfile}
                    className="flex-1 rounded-md border border-[#2f5b75] bg-transparent px-4 py-2 text-sm font-semibold text-[#c8dfe1] hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={Boolean(profileBusy)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-md border border-[#f84f63] bg-[#f84f63] px-4 py-2 text-sm font-semibold text-[#0a1f36] hover:bg-[#ff667a] disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={Boolean(profileBusy)}
                  >
                    {profileBusy === "save" ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </Shell>
  );
}
