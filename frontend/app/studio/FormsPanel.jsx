"use client";

import { useEffect, useMemo, useState } from "react";
import { Btn, Empty, Fld, INPUT, Icon, Section } from "./ui";

export default function FormsPanel({ s }) {
  const forms = s.info?.forms || [];
  const [values, setValues] = useState({});
  const signature = useMemo(
    () => forms.map((field) => `${field.page}:${field.name}:${field.value}`).join("|"),
    [forms],
  );

  useEffect(() => {
    const next = {};
    forms.forEach((field) => {
      next[field.name] = field.value === true ? "Yes" : field.value === false ? "Off" : String(field.value ?? "");
    });    setValues(next);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const fill = () => s.run("Filling form fields...", () => s.mutate("/forms/fill", { values }));
  const flatten = () => {
    if (!window.confirm("Flattening makes the form fields permanent and no longer editable. Continue?")) return;
    s.run("Flattening form...", () => s.mutate("/forms/flatten"));
  };

  if (!forms.length) {
    return (
      <Section title="Form fields" hint="This document does not contain AcroForm fields.">
        <Empty>
          Scanned or flattened PDFs have no interactive fields. Use Markup to add text boxes instead,
          or create a new form before flattening.
        </Empty>
      </Section>
    );
  }

  return (
    <div className="space-y-3">
      <Section title="Form fields" hint={`${forms.length} field${forms.length === 1 ? "" : "s"} detected`}>
        <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
          {forms.map((field, index) => {
            const key = `${field.page}-${field.name}-${index}`;
            const type = String(field.type || "");
            const isCheck = /check|radio/i.test(type);
            const isChoice = /combo|list/i.test(type);
            return (
              <div key={key} className="rounded-lg border border-[#2d5871] bg-[#103a55] p-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-white">{field.label || field.name || "Unnamed field"}</span>
                  <button type="button" onClick={() => s.setPageNumber(field.page)}
                    className="shrink-0 rounded border border-[#2d5871] px-1.5 py-0.5 text-[10px] text-[#9db8c4] hover:border-[#f84f63] hover:text-white">
                    p.{field.page}
                  </button>
                </div>
                {isCheck ? (
                  <label className="flex items-center gap-2 text-[11px] text-[#c9dfe3]">
                    <input type="checkbox" className="accent-[#f84f63]"
                      checked={["1", "true", "yes", "on", "checked"].includes(String(values[field.name] ?? "").toLowerCase())}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.checked ? "Yes" : "Off" }))} />
                    Checked
                  </label>
                ) : isChoice ? (
                  <select className={INPUT} value={values[field.name] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}>
                    <option value="">(unchanged)</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                    <option value="N/A">N/A</option>
                  </select>
                ) : (
                  <input className={INPUT} value={values[field.name] ?? ""} placeholder={type || "Value"}
                    onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} />
                )}
                <p className="mt-1 truncate text-[10px] text-[#7f9dab]">{field.name}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex gap-1.5">
          <Btn size="sm" className="flex-1" icon="check" onClick={fill}>Apply values</Btn>
          <Btn size="sm" variant="danger" icon="shield" onClick={flatten}>Flatten</Btn>
        </div>
      </Section>
      <div className="rounded-lg bg-[#103a55] px-3 py-2 text-[11px] leading-4 text-[#9db8c4]">
        <span className="font-semibold text-[#c9dfe3]">Tip:</span> fill the fields, then use Export to save a
        completed copy. Flattening is permanent but keeps the values visible in every viewer.
      </div>
      <Fld label="Keyboard shortcut">
        <p className="rounded-lg border border-[#2d5871] bg-[#0c2b44] px-3 py-2 text-[11px] text-[#8faebb]">
          Enter moves to the next field in most PDF viewers. Use the page badge to jump to a field that is hard to find.
        </p>
      </Fld>
      <div className="flex items-center gap-2 text-[11px] text-[#8faebb]">
        <Icon name="info" className="h-3.5 w-3.5" /> Signatures are preserved but not cryptographically re-signed.
      </div>
    </div>
  );
}
