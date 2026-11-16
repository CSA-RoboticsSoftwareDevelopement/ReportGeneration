"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ImageEditor from "./ImageEditor";

/* ------------------------------------------------------------------ */
/*  Design tokens (from the dark-technical login design)               */
/*  page #0a2744 · panel #16405c · card #0e3250 · field #16415f        */
/*  border #2f5b75 · coral #f84f63 · text #f3f8f7 · muted #9fb9c4      */
/* ------------------------------------------------------------------ */

const STEPS = [
  ["01", "Project", "Details & material"],
  ["02", "Report", "Scope & evidence"],
  ["03", "Layout", "Document styling"],
  ["04", "Issue", "Preview & export"],
];

const MATERIAL_IDS = new Set(["material", "fu", "fy", "young", "nu", "rho"]);
const DRAFT_KEY = "reportgenix-draft-v2";

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');
.rg { font-family: 'Poppins', ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.rg *:focus-visible { outline: 2px solid #f84f63; outline-offset: 2px; }
.rg select { color-scheme: dark; }
@media (prefers-reduced-motion: reduce) { .rg * { transition: none !important; animation: none !important; } }
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

            <form className="mt-9 space-y-6" onSubmit={submit}>
              {signup && (
                <label className="block">
                  <span className={AUTH_LABEL}>Full name *</span>
                  <input required value={authForm.full_name} onChange={set("full_name")} className={AUTH_INPUT} placeholder="Your full name" autoComplete="name" />
                </label>
              )}
              <label className="block">
                <span className={AUTH_LABEL}>Email address *</span>
                <input required type="email" autoComplete="email" value={authForm.email} onChange={set("email")} className={AUTH_INPUT} placeholder="you@example.com" />
              </label>
              <label className="block">
                <span className={AUTH_LABEL}>Password *</span>
                <div className="relative">
                  <input
                    required
                    minLength={8}
                    type={show ? "text" : "password"}
                    autoComplete={signup ? "new-password" : "current-password"}
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
            <p className="mt-5 text-lg font-light text-[#a9ccc9] xl:text-xl">Engineering Reports Automated</p>
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

/* ------------------------------------------------------------------ */
/*  Summary of compliance                                              */
/* ------------------------------------------------------------------ */

function ComplianceEditor({ rows, setRows, catalog, request }) {
  const manualTimers = useRef({});

  const addRow = () =>
    setRows((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        source: "library",
        conformity: "Full Compliance",
        standardId: "",
        clauseId: "",
        clauses: [],
        standard: "",
        requirement: "",
        manual: { code: "", edition_year: "", standard_title: "", clause_no: "", clause_title: "", requirement_text: "" },
      },
    ]);

  const update = (id, patch) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const selectStandard = async (row, standardId) => {
    update(row.id, { standardId, clauseId: "", clauses: [], standard: "", requirement: "", error: "" });
    if (!standardId) return;
    try {
      // request() returns a Response, so read the JSON body before using it
      const response = await request(`/api/standards/${standardId}/clauses`);
      const result = await response.json();
      update(row.id, { clauses: result.clauses || [] });
    } catch (error) {
      update(row.id, { error: error.message });
    }
  };

  const selectClause = (row, clauseId) => {
    const clause = row.clauses.find((item) => String(item.id) === String(clauseId));
    if (!clause) return;
    const code = catalog.find((item) => String(item.id) === String(row.standardId))?.code || "";
    update(row.id, {
      clauseId,
      standard: clause.summary_standard || `${code} - ${clause.clause_no}`,
      requirement: clause.summary_requirement || [clause.title, clause.requirement_text].filter(Boolean).join("\n"),
    });
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
      <p className="mb-5 text-sm text-[#b3ced0]">Select database records to build the report summary, or enter a manual row.</p>

      {rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-[#2f5b75] p-6 text-center text-sm text-[#a9c1ca]">
          No standards added yet. Use “Add standard” to create the first row.
        </div>
      )}

      <div className="space-y-4">
        {rows.map((row, index) => (
          <div key={row.id} className={INSET}>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-medium text-[#80bfbe]">Row {index + 1}</span>
              <button onClick={() => removeRow(row.id)} className="text-sm font-semibold text-[#ff8393] hover:text-[#ffb0ba]">Remove</button>
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
                  <Labeled label="Clause">
                    <select disabled={!row.standardId} className={INPUT} value={row.clauseId} onChange={(e) => selectClause(row, e.target.value)}>
                      <option value="">Select a clause</option>
                      {row.clauses.map((item) => (
                        <option key={item.id} value={item.id}>{item.clause_no ? `${item.clause_no} — ` : ""}{item.title}</option>
                      ))}
                    </select>
                  </Labeled>
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

            {row.standard && (
              <div className="mt-4 grid gap-3 rounded-lg border border-[#77c2bd]/20 bg-[#77c2bd]/5 p-3 text-sm md:grid-cols-2">
                <p><b className="font-semibold text-[#99cfca]">Standard:</b> {row.standard}</p>
                <p className="whitespace-pre-line"><b className="font-semibold text-[#99cfca]">Requirement:</b> {row.requirement}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Report sections                                                    */
/* ------------------------------------------------------------------ */

function EvidenceThumb({ file, onEdit }) {
  const [url, setUrl] = useState("");
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
        {url ? (
          <>
            <img src={url} alt="Preview" className="h-32 w-full rounded-md border border-[#2f5b75] bg-[#061d31] object-cover" />
            <button
              type="button"
              onClick={onEdit}
              className="absolute bottom-2 right-2 rounded-md bg-[#f84f63] px-2.5 py-1 text-xs font-semibold text-[#0a1f36] shadow hover:bg-[#ff667a]"
            >
              Open image in editor
            </button>
          </>
        ) : (
          <div className="flex h-32 w-full items-center justify-center rounded-md border border-dashed border-[#2f5b75]/50 bg-[#061d31]/50 text-xs text-[#5c7a86]">
            No image attached
          </div>
        )}
      </div>
    </div>
  );
}

function SectionEditor({ section, sections, data, setData, files, setFiles, extraImages, setExtraImages, removedSchemaImages, setRemovedSchemaImages, selected, setSelected, children, onOpenImageEditor, editingImage, onFileChange, originals }) {
  const enabled = selected.includes(section.id);
  const headingId = `heading__${section.id}`;
  const router = useRouter();
  const sectionIds = sections.map((s) => s.id);
  const currentIndex = sectionIds.indexOf(section.id);
  const prevSection = currentIndex > 0 ? sections[currentIndex - 1] : null;
  const nextSection = currentIndex < sectionIds.length - 1 ? sections[currentIndex + 1] : null;
  const goTo = (id) => router.push(`/section/${id}`);
  const sectionExtra = extraImages[section.id] || [];
  const allImages = [
    ...section.images.map((img) => ({ ...img, source: "schema" })),
    ...sectionExtra.map((img) => ({ ...img, source: "extra" })),
  ];

  return (
    <section className={`overflow-hidden rounded-2xl border ${enabled ? "border-[#2a5068] bg-[#0e3250]" : "border-[#2a5068]/50 bg-[#0b2b47]/60 opacity-70"}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2a5068]/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="font-semibold text-white">{section.title}</h3>
            <p className="mt-0.5 text-xs text-[#9bbcc0]">Report section</p>
          </div>
        </div>
      </header>

      {enabled && (
        <div className="space-y-5 p-5 sm:p-6">
          {children}
          <div className={INSET}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-[#83c6c0]">Editable report heading</p>
            <Labeled label="Main section heading">
              <input
                className={INPUT}
                value={data[headingId] ?? section.title}
                onChange={(event) => setData((current) => ({ ...current, [headingId]: event.target.value }))}
              />
            </Labeled>
          </div>
          {section.fields.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {section.fields.map((field) => (
                <Field key={field.id} field={field} value={data[field.id]} onChange={(value) => setData((current) => ({ ...current, [field.id]: value }))} />
              ))}
            </div>
          )}
          {allImages.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {allImages.map((image) => {
                const isSchema = image.source === "schema";
                const cardKey = isSchema ? `schema_${image.id}` : `extra_${image.id}`;
                if (removedSchemaImages[`${section.id}:${image.id}`]) return null;
                const isActive = editingImage?.id === image.id;
                return (
                  <div
                    key={cardKey}
                    className={`relative rounded-xl border border-dashed p-4 ${isActive ? "border-[#f84f63] bg-[#f84f63]/5" : "border-[#2f5b75] bg-[#0a2744]/60"}`}
                  >
                    <button
                      onClick={() => {
                        if (isSchema) {
                          setRemovedSchemaImages((current) => ({ ...current, [`${section.id}:${image.id}`]: true }));
                        } else {
                          setExtraImages((current) => ({
                            ...current,
                            [section.id]: (current[section.id] || []).filter((img) => img.id !== image.id),
                          }));
                          setFiles((current) => {
                            const next = { ...current };
                            delete next[image.id];
                            return next;
                          });
                        }
                      }}
                      className="absolute top-2 right-2 rounded-full border border-[#2f5b75] bg-[#0a2744] text-[#ff8e9c] text-xs p-1 hover:bg-[#ff8e9c]/20 hover:text-white"
                      aria-label="Remove image"
                    >
                      &#215;
                    </button>

                    <EvidenceThumb
                      file={files[image.id]}
                      onEdit={() =>
                        onOpenImageEditor({ id: image.id, label: data[`cap__${image.id}`] || image.label || "Image" })
                      }
                    />

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
                    <input
                      type="file"
                      accept="image/*"
                      className="mt-4 block w-full text-xs text-[#a8c9ca] file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-[#f84f63] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#0a1f36]"
                      onChange={(e) => onFileChange(image.id, e.target.files?.[0] || null)}
                    />
                    {files[image.id] && (
                      <p className="mt-2 break-all text-xs text-[#8fd0c8]">
                        {originals[image.id] ? "Edited in image editor" : `Attached: ${files[image.id].name}`}
                      </p>
                    )}
                  </div>
                );
              })}
              <button
                onClick={() => {
                  const newId = `extra_${section.id}_${Date.now()}`;
                  setExtraImages((current) => ({
                    ...current,
                    [section.id]: [...(current[section.id] || []), { id: newId, label: "", h: 60 }],
                  }));
                  setData((current) => ({ ...current, [`cap__${newId}`]: "" }));
                }}
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
  const submitFolder = (e) => {
    e.preventDefault();
    const err = onAddFolder(folderName);
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
/* ------------------------------------------------------------------ */

const SidebarNav = ({ steps, extraLinks, completeness, sidebarOpen, setSidebarOpen, user, openProfile, dashboardActive }) => {
  const close = () => setSidebarOpen(false);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[#2a5068]/60 bg-[#0a2744] shadow-2xl transition-transform duration-300 lg:translate-x-0 lg:shadow-none ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      aria-label="Report navigation"
    >
      {/* Brand */}
      <div className="flex items-center justify-between px-6 pb-5 pt-6">
        <Link href="/" onClick={close} className="flex items-center gap-3">
          <img src="/csa_logo.webp" alt="CSA Engineering" className="h-9 w-auto object-contain" />
          <span className="border-l border-[#2f5b75] pl-3 text-lg font-bold tracking-tight text-white">ReportGenix</span>
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
      <div className="px-6 pb-2">
        <Link
          href="/dashboard"
          onClick={close}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${dashboardActive ? "bg-[#f84f63] text-[#0a1f36]" : "border border-[#2f5b75] bg-[#0e3250] text-[#c8dfe1] hover:bg-white/5 hover:text-white"}`}
        >
          <Icon name="grid" className="h-[18px] w-[18px]" />
          <span>Dashboard</span>
        </Link>
      </div>

      {/* Steps */}
      <nav className="flex-1 overflow-y-auto px-6 py-4" aria-label="Report steps">
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
          <span aria-hidden="true" className="absolute bottom-1 left-4 top-10 -translate-x-1/2 border-l-2 border-dashed border-[#2f5b75]" />
        )}
        <Link href={step.href} onClick={close} aria-current={step.active ? "step" : undefined} className="group relative flex items-center gap-4">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition ${circle}`}>
            {step.done && !step.active ? "✓" : index + 1}
          </span>
          <span className="min-w-0">
            <span className={`block truncate text-[15px] ${step.active ? "font-semibold text-white" : "font-medium text-[#c8dfe1] group-hover:text-white"}`}>
              {step.label}
            </span>
            {step.sub && <span className="block truncate text-[11px] text-[#7f9fae]">{step.sub}</span>}
          </span>
        </Link>

        {step.children?.length > 0 && (
          <ul className="relative mt-5 space-y-4">
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

        <div className="mt-8 space-y-1 border-t border-[#2a5068]/60 pt-5">
          {extraLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={close}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${link.active ? "bg-[#f84f63] text-[#0a1f36]" : "text-[#c8dfe1] hover:bg-white/5 hover:text-white"}`}
            >
              <span className="text-[11px]">{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      {/* Completeness + profile */}
      <div className="border-t border-[#2a5068]/60 px-6 py-5">
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
        <button
          onClick={() => { close(); openProfile(); }}
          className="mt-5 flex w-full items-center gap-3 rounded-lg border border-[#2f5b75] bg-[#0e3250] px-4 py-3 text-sm text-[#c8dfe1] hover:bg-white/5"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f84f63] text-xs font-bold text-[#0a1f36]">
            {user?.initials || initials(user?.full_name || user?.email)}
          </span>
          <span className="truncate">Profile</span>
        </button>
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
  const [data, setData] = useState({});
  const [standardsCatalog, setStandardsCatalog] = useState([]);
  const [materialsCatalog, setMaterialsCatalog] = useState([]);
  const [standards, setStandards] = useState([]);
  const [selected, setSelected] = useState([]);
  const [files, setFiles] = useState({});
  const [layout, setLayout] = useState({ heading_align: "left", text_align: "justify", image_align: "center", caption_position: "below", caption_align: "center" });
  const [materialMode, setMaterialMode] = useState("library");
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [materialMeta, setMaterialMeta] = useState({ material_type: "", category: "steel", source_standard_id: "", notes: "" });
  const [materialStatus, setMaterialStatus] = useState(null);
  const [extraImages, setExtraImages] = useState({});
  const [removedSchemaImages, setRemovedSchemaImages] = useState({});
  const [step, setStep] = useState(1);
  const [previewUrl, setPreviewUrl] = useState("");
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
  /* Dashboard */
  const [reports, setReports] = useState([]);
  const [folders, setFolders] = useState([]);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [activeReportId, setActiveReportId] = useState("");
  const pendingId = useRef("");
  const sessionMedia = useRef({}); /* { [reportId]: { files, originals, editorStates } } */
  const raeTimer = useRef(null);

  /* Image editor + section preview state */
  const [editingImage, setEditingImage] = useState(null); /* { id, label, url, originalFile } */
  const [originals, setOriginals] = useState({}); /* { [imageId]: untouched original File } */
  const [editorStates, setEditorStates] = useState({}); /* { [imageId]: saved layers } */
  const [preview, setPreview] = useState(null); /* { pages: [{page,dataUrl}], section_pages: {...} } */
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sectionPreviewIndex, setSectionPreviewIndex] = useState(0);


  const request = useCallback(
    async (path, options = {}) => {
      const method = (options.method || "GET").toUpperCase();
      const headers = new Headers(options.headers || {});
      if (method !== "GET" && method !== "HEAD" && csrf) headers.set("X-CSRF-Token", csrf);
      const response = await fetch(path, { ...options, headers, cache: options.cache || "no-store", credentials: "include" });
      if (!response.ok) throw new Error(await messageFor(response));
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
      Object.fromEntries(
        nextSchema.general.map((field) => [field.id, saved.data?.[field.id] ?? current[field.id] ?? field.default ?? (field.type === "date" ? new Date().toISOString().slice(0, 10) : "")])
      )
    );
    setData((current) => ({ ...current, ...(saved.data || {}) }));
    setStandards(Array.isArray(saved.standards) ? saved.standards : []);
    setSelected(Array.isArray(saved.selected) ? saved.selected : nextSchema.sections.map((section) => section.id));
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
      setStep(1);
      setReports([]);
      setFolders([]);
      setReportsLoaded(false);
      setActiveReportId("");
      sessionMedia.current = {};
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
    (file, state) => {
      if (!editingImage) return;
      const { id, originalFile } = editingImage;
      setOriginals((current) => ({ ...current, [id]: current[id] || originalFile }));
      setEditorStates((current) => ({ ...current, [id]: state }));
      setFiles((current) => ({ ...current, [id]: file })); // flattened PNG replaces the slot image
      stopEditing(); // right half returns to the PDF preview
    },
    [editingImage, stopEditing]
  );

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
    () => standards.filter((row) => row.standard || row.requirement).map(({ standard, requirement, conformity }) => ({ standard, requirement, conformity })),
    [standards]
  );

  const currentSectionId = pathname.startsWith("/section/") ? decodeURIComponent(pathname.slice("/section/".length)) : "";
  const currentActiveSection = schema?.sections?.find((section) => section.id === currentSectionId);

  /*
   * The API records where each section starts.  Its next section start is the
   * end of this section's range, so retain every rendered page in between.
   * This intentionally leaves the PDF/preview API and report engine untouched.
   */
  const sectionPreviewPages = useMemo(() => {
    if (!preview || !preview.pages?.length || !currentActiveSection) return null;
    const startPage = preview.section_pages?.[currentActiveSection.id];
    if (typeof startPage !== "number" || startPage < 1 || startPage > preview.pages.length) return null;
    const nextStart = Object.values(preview.section_pages || {})
      .filter((page) => typeof page === "number" && page > startPage)
      .sort((a, b) => a - b)[0];
    const endPage = nextStart ? nextStart - 1 : preview.pages.length;
    return preview.pages.slice(startPage - 1, endPage);
  }, [preview, currentActiveSection]);

  const previewPage = sectionPreviewPages?.[sectionPreviewIndex] || null;

  useEffect(() => {
    // Always start at the first page when changing section or receiving a new render.
    setSectionPreviewIndex(0);
  }, [currentActiveSection?.id, preview]);

  const loadPreview = useCallback(async () => {
    if (!schema || !currentActiveSection) return;
    const payload = {
      data,
      standards: reportRows,
      selected,
      layout,
      extra_images: {},
      removed_images: Object.keys(removedSchemaImages)
        .filter((key) => removedSchemaImages[key])
        .map((key) => key.slice(key.indexOf(":") + 1)),
    };
    Object.entries(extraImages).forEach(([sid, images]) => {
      payload.extra_images[sid] = images.map((img) => ({
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
    setPreviewLoading(true);
    try {
      const response = await request("/api/preview/pages", { method: "POST", body: form });
      const result = await response.json();
      setPreview(result);
    } catch (error) {
      console.error("Preview failed", error);
    } finally {
      setPreviewLoading(false);
    }
  }, [request, schema, currentActiveSection, data, reportRows, selected, layout, extraImages, removedSchemaImages, files]);

  useEffect(() => {
    if (!schema || !currentActiveSection) return;
    const timer = window.setTimeout(loadPreview, 700);
    return () => window.clearTimeout(timer);
  }, [schema, currentActiveSection, loadPreview]);

  const generate = async (output) => {
    setBusy(output);
    try {
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
      form.append(
        "payload",
        JSON.stringify({
          data: { ...data, standards: reportRows },
          standards: reportRows,
          selected,
          layout,
          extra_images: extraImagesPayload,
          removed_images: removedImagesPayload,
          output: output === "preview" ? "pdf" : output,
        })
      );
      Object.entries(files).forEach(([key, file]) => {
        if (file) form.append(`img__${key}`, file);
      });
      const response = await request("/api/generate", { method: "POST", body: form });
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
  const storeKey = `reportgenix-reports-v1:${userKey}`;

  useEffect(() => {
    if (!userKey) return;
    try {
      const raw = JSON.parse(window.localStorage.getItem(storeKey) || "{}");
      setReports(Array.isArray(raw.reports) ? raw.reports : []);
      setFolders(Array.isArray(raw.folders) ? raw.folders : []);
    } catch {
      setReports([]);
      setFolders([]);
    }
    setReportsLoaded(true);
  }, [userKey, storeKey]);

  useEffect(() => {
    if (!reportsLoaded || !userKey) return;
    const write = (list) => window.localStorage.setItem(storeKey, JSON.stringify({ reports: list, folders }));
    try {
      write(reports);
    } catch {
      try { write(reports.map((r) => ({ ...r, thumb: "" }))); } catch { /* storage full */ }
    }
  }, [reports, folders, reportsLoaded, userKey, storeKey]);

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

  const stashMedia = () => {
    if (activeReportId) sessionMedia.current[activeReportId] = { files, originals, editorStates };
  };

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
    stashMedia();
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

  const openReport = (id) => {
    const rec = reports.find((r) => r.id === id);
    if (!rec) return;
    if (id !== activeReportId) {
      stashMedia();
      const s = rec.snapshot || {};
      const media = sessionMedia.current[id] || {};
      pendingId.current = "";
      setData(s.data || {});
      setStandards(s.standards || []);
      setSelected(s.selected || schema.sections.map((x) => x.id));
      setLayout(s.layout || layout);
      setMaterialMode(s.materialMode === "manual" ? "manual" : "library");
      setSelectedMaterialId(s.selectedMaterialId || "");
      setMaterialMeta(s.materialMeta || { material_type: "", category: "steel", source_standard_id: "", notes: "" });
      setExtraImages(s.extraImages || {});
      setRemovedSchemaImages(s.removedSchemaImages || {});
      setFiles(media.files || {});
      setOriginals(media.originals || {});
      setEditorStates(media.editorStates || {});
      setEditingImage(null);
      setPreview(null);
      setActiveReportId(id);
    }
    const snap = rec.snapshot || {};
    writeDraft({
      data: snap.data || {}, standards: snap.standards || [], selected: snap.selected || schema.sections.map((x) => x.id),
      layout: snap.layout || layout, materialMode: snap.materialMode === "manual" ? "manual" : "library",
      selectedMaterialId: snap.selectedMaterialId || "", materialMeta: snap.materialMeta || { material_type: "", category: "steel", source_standard_id: "", notes: "" },
      activeReportId: id, extraImages: snap.extraImages || {}, removedSchemaImages: snap.removedSchemaImages || {},
    });
    setReports((cur) => cur.map((r) => (r.id === id ? { ...r, lastViewedAt: Date.now() } : r)));
    router.push("/");
  };

  const updateReport = (id, patch) => setReports((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const duplicateReport = (id) => {
    const rec = reports.find((r) => r.id === id);
    if (!rec) return;
    const copyId = newId();
    const media = id === activeReportId ? { files, originals, editorStates } : sessionMedia.current[id];
    if (media) sessionMedia.current[copyId] = media;
    const now = Date.now();
    setReports((cur) => [{ ...rec, id: copyId, title: `${rec.title} (copy)`, status: "draft", starred: false, pinned: false, createdAt: now, updatedAt: now, lastViewedAt: now }, ...cur]);
  };

  const deleteReport = (id) => {
    if (!window.confirm("Delete this report from the dashboard? This can't be undone.")) return;
    delete sessionMedia.current[id];
    setReports((cur) => cur.filter((r) => r.id !== id));
    if (id === activeReportId) resetWorkspace();
  };

  const addFolder = (rawName) => {
    const name = String(rawName || "").trim();
    if (!name) return "Enter a folder name.";
    if (folders.some((f) => f.toLowerCase() === name.toLowerCase())) return "A folder with this name already exists.";
    setFolders((cur) => [...cur, name]);
    return "";
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
  const activeSection = schema.sections.find((section) => section.id === sectionId);
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
  const reportSections = schema.sections.filter((section) => section.id !== "summary");
  const navClass = (active) => `rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-[#f84f63] text-[#0a1f36]" : "text-[#c6dce2] hover:bg-white/5 hover:text-white"}`;

  /* ---- Sidebar data: built from the app's own routes and state ---- */
  const filled = (value) => String(value ?? "").trim() !== "";
  const sectionDone = (section) =>
    section.fields.some((field) => filled(data[field.id])) || section.images.some((image) => Boolean(files[image.id]));

  const sectionChildren = reportSections.map((section) => ({
  key: `section-${section.id}`,
  href: `/section/${section.id}`,
  label: section.title,
  active: route === "section" && activeSection?.id === section.id,
  done: sectionDone(section),
}));

const sidebarSteps = [
  { key: "home", href: "/", label: "Project", sub: "Report details", active: route === "home", done: filled(data.rae_no) && filled(data.project_name) },
  { key: "projects", href: "/projects", label: "Libraries", sub: "Materials & compliance", active: route === "projects", done: standards.length > 0 && filled(data.material) },
  {
    key: "sections",
    href: sectionChildren[0]?.href || "/projects",
    label: "Section",
    sub: "Report sections",
    active: route === "section",
    done: sectionChildren.length > 0 && sectionChildren.every((c) => c.done),
    children: sectionChildren,
  },
  { key: "layout", href: "/layout", label: "Layout", sub: "Document styling", active: route === "layout", done: false },
  { key: "issue", href: "/issue", label: "Issue", sub: "Preview & export", active: route === "issue", done: false },
];

  const sidebarExtraLinks = [
    { href: "/help", label: "Help", icon: "❓", active: route === "help" },
    { href: "/faq", label: "FAQ", icon: "❔", active: route === "faq" },
  ];

  /* Completeness: project fields filled, compliance rows added, evidence attached */
  const projectRatio = schema.general.length ? schema.general.filter((field) => filled(data[field.id])).length / schema.general.length : 0;
  const complianceRatio = reportRows.length > 0 ? 1 : 0;
  const evidenceRatio = Object.values(files).some(Boolean) ? 1 : 0;
  const completeness = Math.round(((projectRatio + complianceRatio + evidenceRatio) / 3) * 100);

  return (
    <Shell>
      {route !== "dashboard" && sidebarOpen && <div className="fixed inset-0 z-40 bg-[#0a1f36]/40 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />}
      {route !== "dashboard" && (
        <SidebarNav
          steps={sidebarSteps}
          extraLinks={sidebarExtraLinks}
          completeness={completeness}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          user={user}
          openProfile={openProfile}
          dashboardActive={false}
        />
      )}

      {/* Everything to the right of the fixed sidebar on large screens */}
        <div className={route === "dashboard" ? "" : "lg:pl-72"}>
        <header className="sticky top-0 z-30 border-b border-[#2a5068]/60 bg-[#0a2744]/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-10">
          <div className="mx-auto flex max-w-[1600px] items-center gap-3">
            {route !== "dashboard" && (
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
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden max-w-[220px] truncate text-sm text-[#b9d2d3] md:inline">{user.full_name || user.email}</span>
              <button
                onClick={openProfile}
                className="relative rounded-full border border-[#2f5b75] bg-[#0e3250] px-2 py-1 text-xs font-semibold text-[#c8dfe1] hover:bg-white/10 focus:outline-none focus:border-[#f84f63]"
                aria-label="Profile"
              >
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="Profile" className="rounded-full w-6 h-6 object-cover" />
                ) : (
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#f84f63] text-[#0a1f36] font-bold text-xs">{user.initials || initials(user.full_name || user.email)}</span>
                )}
              </button>
              <ActionButton variant="ghost" onClick={() => downloadTemplate("pdf")} className="hidden !px-4 !py-2 sm:inline-flex">Blank PDF</ActionButton>
              <ActionButton variant="ghost" onClick={logout} className="!px-4 !py-2">Sign out</ActionButton>
            </div>
          </div>
        </header>

        <div className={route === "dashboard" ? "px-4 py-4 sm:px-6" : "mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10"}>
          <div className={`${route === "dashboard" ? "hidden " : ""}mb-6 flex flex-col justify-between gap-4 rounded-2xl border border-[#2a5068] bg-[#0e3250] px-5 py-5 sm:flex-row sm:items-center sm:px-7`}><div><p className={EYEBROW}>{route === "home" ? "Project information" : route === "projects" ? "Project" : route === "section" ? "Report section" : route === "layout" ? "Layout controls" : route === "help" ? "Help & documentation" : route === "faq" ? "RAQ" : "Report issue"}</p><h1 className="mt-1 text-2xl font-semibold text-white">{route === "home" ? "Report details" : route === "projects" ? "Materials & compliance" : route === "section" ? (data[`heading__${activeSection.id}`] || activeSection.title) : route === "layout" ? "Layout controls" : route === "help" ? "Help & documentation" : route === "faq" ? "Raised and Answered Questions" : "Review and export"}</h1></div><div className="flex flex-wrap gap-2 lg:hidden"><Link href="/" className={navClass(route === "home")}>Project</Link><Link href="/projects" className={navClass(route === "projects")}>Libraries</Link><Link href="/help" className={navClass(route === "help")}>Help</Link><Link href="/faq" className={navClass(route === "faq")}>RAQ</Link><Link href="/issue" className={navClass(route === "issue")}>Issue</Link></div></div>

          <nav className={`${route === "dashboard" ? "hidden " : ""}flex items-center gap-1 text-xs text-[#8fbcc0] mt-4 ml-2`} aria-label="Breadcrumb">
            <Link href="/" className="hover:text-[#c8dfe1]">Home</Link>
            <span>/</span>
            <Link href="/projects" className="hover:text-[#c8dfe1]">Project</Link>
            {route === "home" ? null : <span>/</span>}
            {route === "projects" ? null : <Link href="/projects" className="hover:text-[#c8dfe1]">Libraries</Link>}
            {route === "projects" || route === "home" ? null : <span>/</span>}
            {route === "section" ? <Link href={`/section/${activeSection.id}`} className="hover:text-[#c8dfe1]">{activeSection.title}</Link> : null}
            {(route === "section" || route === "layout") ? <span>/</span> : null}
            {route === "layout" ? <span className="text-[#c8dfe1]">Layout</span> : null}
            {(route === "layout" || route === "section") ? <span>/</span> : null}
            {route === "issue" ? <span className="text-[#c8dfe1]">Issue</span> : null}
            {route === "help" ? <span className="text-[#c8dfe1]">Help</span> : null}
            {route === "faq" ? <span className="text-[#c8dfe1]">RAQ</span> : null}
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
            <div className="flex h-[calc(100vh-150px)] overflow-hidden border rounded-2xl border-[#2a5068] bg-[#0b2b47]">
              <div className="w-1/2 flex flex-col overflow-y-auto bg-[#0b2b47]/60">
                <SectionEditor sections={schema.sections} section={activeSection} data={data} setData={setData} files={files} setFiles={setFiles} extraImages={extraImages} setExtraImages={setExtraImages} removedSchemaImages={removedSchemaImages} setRemovedSchemaImages={setRemovedSchemaImages} selected={selected} setSelected={setSelected} onOpenImageEditor={openImageEditor} editingImage={editingImage} onFileChange={handleFileChange} originals={originals}>{activeSection.id === "requirements" && <p className="text-sm text-[#b7d1d2]">Requirements are generated from the Summary of Compliance entries in <Link href="/projects" className="font-semibold text-[#81c9c2] underline">Project </Link>.</p>}{activeSection.id === "cert" && <p className="text-sm text-[#b7d1d2]">The certificate QR code and Australia watermark are applied automatically in preview and final documents.</p>}</SectionEditor>
              </div>
              <div className="w-1/2 border-l border-[#2a5068]/60 flex flex-col overflow-hidden bg-[#0a2744]">
                {editingImage ? (
                  <div className="min-h-0 flex-1 p-3">
                    <ImageEditor
                      key={editingImage.id}
                      imageUrl={editingImage.url}
                      initialState={editorStates[editingImage.id]}
                      title={editingImage.label}
                      onSave={handleEditorSave}
                      onClose={closeImageEditor}
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col border-b border-[#2a5068]/40 overflow-hidden">
                    <div className="p-4 border-b border-[#2a5068]/40 bg-[#0a2744]/60">
                      <p className="text-xs font-medium text-[#f84f63]">PDF preview</p>
                      <h3 className="mt-1 text-sm font-semibold text-white">{activeSection.title}</h3>
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[#9bbcc0]">
                        <p>
                          {previewPage
                            ? `Page ${previewPage.page} of ${preview?.pages?.length || 0} · section page ${sectionPreviewIndex + 1} of ${sectionPreviewPages.length}`
                            : "No rendered pages"}
                        </p>
                        {sectionPreviewPages?.length > 1 && (
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              aria-label="Previous section preview page"
                              onClick={() => setSectionPreviewIndex((index) => Math.max(0, index - 1))}
                              disabled={sectionPreviewIndex === 0}
                              className="rounded border border-[#2a5068] px-2 py-0.5 text-[#b7d1d2] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Prev
                            </button>
                            <button
                              type="button"
                              aria-label="Next section preview page"
                              onClick={() => setSectionPreviewIndex((index) => Math.min(sectionPreviewPages.length - 1, index + 1))}
                              disabled={sectionPreviewIndex === sectionPreviewPages.length - 1}
                              className="rounded border border-[#2a5068] px-2 py-0.5 text-[#b7d1d2] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Next
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto p-4 bg-[#061d31] flex items-center justify-center">
                      {previewLoading ? (
                        <p className="text-xs text-[#9bbcc0]">Rendering preview…</p>
                      ) : previewPage ? (
                        <img
                          src={previewPage.dataUrl}
                          alt={`${activeSection.title}, page ${previewPage.page}`}
                          className="max-w-full max-h-full object-contain border border-[#2a5068]/40 rounded-md bg-black"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-xs text-[#5c7a86]">
                          <p>No preview available</p>
                          <p className="mt-1 text-[10px] text-[#6b7c86]">Generate a preview to see this section's PDF page.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {route === "issue" && (
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className={CARD}>
                <p className={EYEBROW}>Ready to issue</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Review and export</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#b6d3d4]">
                  Preview uses the same report engine as the final download. Check warnings and attached evidence before issuing the certification.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <ActionButton onClick={() => generate("preview")} disabled={Boolean(busy)} className="flex-1 sm:flex-none">
                    {busy === "preview" ? "Creating preview…" : "Preview PDF"}
                  </ActionButton>
                  <ActionButton variant="secondary" onClick={() => generate("pdf")} disabled={Boolean(busy)} className="flex-1 sm:flex-none">
                    {busy === "pdf" ? "Creating PDF…" : "Download PDF"}
                  </ActionButton>
                  <ActionButton variant="secondary" onClick={() => generate("word")} disabled={Boolean(busy)} className="flex-1 sm:flex-none">
                    {busy === "word" ? "Creating Word…" : "Download Word"}
                  </ActionButton>
                  <ActionButton variant="ghost" onClick={() => downloadTemplate("word")} className="flex-1 sm:flex-none">Blank Word</ActionButton>
                </div>
                {previewUrl && (
                  <div className="mt-7 overflow-hidden rounded-xl border border-[#2a5068] bg-[#061d31]">
                    <iframe title="Generated report preview" src={previewUrl} className="h-[70vh] min-h-[420px] w-full lg:h-[720px]" />
                  </div>
                )}
              </div>

              <aside className="h-fit rounded-2xl border border-[#2a5068] bg-[#0b2b47] p-6">
                <h3 className="font-semibold text-white">Issue checklist</h3>
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
          <div className={`${route === "dashboard" ? "hidden " : ""}mt-12 border-t border-[#2a5068]/40 pt-8 px-6`}>
            <div className="flex flex-wrap justify-between items-center gap-4">
              <div className="text-xs text-[#6b7c86] uppercase tracking-wider font-medium">Stage navigation</div>
              <div className="flex items-center gap-3 text-sm text-[#b9d2d3]">
                <span className="text-[#6b7c86]">{route === "home" ? "1" : route === "projects" ? "2" : route === "section" ? "3" : "4"} / 4</span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (route === "home") router.push("/");
                    else if (route === "projects") router.push("/");
                    else if (route === "section") {
                      const idx = schema.sections.findIndex((s) => s.id === activeSection.id);
                      router.push(idx > 0 ? `/section/${schema.sections[idx - 1].id}` : "/projects");
                    } else if (route === "issue") router.push("/section/" + (schema.sections.find((s) => s.id === "cert")?.id || schema.sections[0]?.id || ""));
                  }}
                  className="rounded-md px-4 py-2 text-sm font-semibold border border-[#2f5b75] bg-transparent text-[#b9d2d3] hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    if (route === "home") router.push("/projects");
                    else if (route === "projects") {
                      const firstSection = schema.sections[0];
                      router.push(firstSection ? `/section/${firstSection.id}` : "/issue");
                    }
                    else if (route === "section") {
                      const idx = schema.sections.findIndex((s) => s.id === activeSection.id);
                      router.push(idx < schema.sections.length - 1 ? `/section/${schema.sections[idx + 1].id}` : "/issue");
                    } else if (route === "issue") router.push("/issue");
                  }}
                  className="rounded-md px-4 py-2 text-sm font-semibold border border-[#f84f63] bg-[#f84f63] text-[#0a1f36] hover:bg-[#ff667a] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {profileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[#0a1f36]/60 backdrop-blur-sm" onClick={closeProfile} />
          <div className="relative bg-[#0b2b47] border border-[#2a5068] rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">Manage Profile</h3>
              <button onClick={closeProfile} className="rounded-full border border-[#2f5b75] bg-transparent px-2 py-1 text-xs text-[#c8dfe1] hover:bg-white/5">&times;</button>
            </div>
            {profileStatus && (
              <p className={`mb-3 text-sm ${profileStatus === "Profile saved." || profileStatus === "Password changed." ? "text-[#6fd08a]" : "text-[#ff8e9c]"}`}>{profileStatus}</p>
            )}
            {resetMode ? (
              <form onChange={() => setProfileStatus("")} onSubmit={(e) => { e.preventDefault(); doResetPassword(); }}>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Forgot password — authenticate</label>
                    <p className="mb-2 text-xs text-[#8fbcc0]">Enter your current password to verify, then set a new password.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Current password</label>
                    <div className="relative">
                      <input
                        className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-sm text-white pr-10 focus:outline-none focus:border-[#f84f63]"
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
                        className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-sm text-white pr-10 focus:outline-none focus:border-[#f84f63]"
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
                <div className="mt-6 flex gap-3">
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
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Full name</label>
                    <input
                      className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#f84f63]"
                      value={profileForm.full_name}
                      onChange={(e) => setProfileForm((current) => ({ ...current, full_name: e.target.value }))}
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Email</label>
                    <input
                      className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#f84f63]"
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm((current) => ({ ...current, email: e.target.value }))}
                      placeholder="email@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8fbcc0] mb-1">Initials</label>
                    <input
                      className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#f84f63] text-uppercase"
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
                        className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#f84f63]"
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
                          className="w-full rounded border border-[#2f5b75] bg-[#0a2744] px-3 py-2 text-sm text-white pr-10 focus:outline-none focus:border-[#f84f63]"
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
                <div className="mt-6 flex gap-3">
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
          </div>
        </div>
      )}
    </Shell>
  );
}
