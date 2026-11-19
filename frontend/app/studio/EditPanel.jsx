"use client";

import { useEffect, useRef, useState } from "react";
import { Btn, Empty, Fld, INPUT, Icon, Section } from "./ui";
import { ANNOT_COLORS } from "./MarkupPanel";

export default function EditPanel({ s }) {
  const [images, setImages] = useState(null);
  const [loading, setLoading] = useState(false);
  const addRef = useRef(null);
  const replaceRef = useRef(null);
  const replaceTarget = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    s.get(`/api/pdf/${s.docId}/images`)
      .then((data) => {
        if (active) setImages(data?.images || []);
      })
      .catch(() => {
        if (active) setImages([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [s.docId, s.version, s.get]);

  const addImage = (fileList) =>
    s.run("Placing image...", async () => {
      const file = fileList?.[0];
      if (!file) return;
      const form = new FormData();
      form.append("page", String(s.pageNumber));
      form.append("x", "0.25");
      form.append("y", "0.32");
      form.append("w", "0.5");
      form.append("h", "0.3");
      form.append("file", file);
      await s.mutate("/image", form);
      if (addRef.current) addRef.current.value = "";
    });

  const replaceImage = (fileList) => {
    const file = fileList?.[0];
    const target = replaceTarget.current;
    if (!file || !target) return;
    replaceTarget.current = null;
    s.run("Replacing image...", async () => {
      const form = new FormData();
      form.append("page", String(target.page));
      form.append("xref", String(target.xref));
      form.append("file", file);
      await s.mutate("/image/replace", form);
      if (replaceRef.current) replaceRef.current.value = "";
    });
  };

  const deleteImage = (image) =>
    s.run("Removing image...", () => s.mutate("/image/delete", { page: image.page, xref: image.xref }));

  return (
    <div className="space-y-3">
      <Section title="Text editing" hint="Click a line of text with Edit text. The original line is removed and replaced in place.">
        <div className="grid grid-cols-2 gap-1.5">
          <Btn size="sm" variant={s.tool === "edit-text" ? "primary" : "secondary"} icon="textCursor"
            onClick={() => s.setTool("edit-text")}>Edit text</Btn>
          <Btn size="sm" variant={s.tool === "textbox" ? "primary" : "secondary"} icon="text"
            onClick={() => s.setTool("textbox")}>Add text</Btn>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ANNOT_COLORS.slice(0, 6).map((color) => (
            <button key={color} type="button" onClick={() => s.setAnnotColor(color)}
              className={`h-6 w-6 rounded-full border ${s.annotColor === color ? "border-white" : "border-black/30"}`}
              style={{ background: color }} aria-label={`Text colour ${color}`} />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Fld label="Font size">
            <input type="number" min="6" max="96" className={INPUT} value={s.textSize}
              onChange={(event) => s.setTextSize(Number(event.target.value) || 12)} />
          </Fld>
          <Fld label="Opacity">
            <input type="number" min="10" max="100" className={INPUT} value={Math.round(s.annotOpacity * 100)}
              onChange={(event) => s.setAnnotOpacity(Number(event.target.value) / 100)} />
          </Fld>
        </div>
      </Section>

      <Section title="Images"
        hint={loading ? "Loading images..." : `${images?.length || 0} embedded images`}
        right={<Btn size="sm" icon="plus" onClick={() => addRef.current?.click()}>Place</Btn>}>
        <input ref={addRef} type="file" accept="image/*" className="hidden" onChange={(event) => addImage(event.target.files)} />
        <input ref={replaceRef} type="file" accept="image/*" className="hidden" onChange={(event) => replaceImage(event.target.files)} />
        {images?.length ? (
          <ul className="space-y-2">
            {images.map((image) => (
              <li key={`${image.page}-${image.xref}`} className="flex gap-2 rounded-lg border border-[#2d5871] bg-[#103a55] p-2">
                <img src={`/api/pdf/${s.docId}/images/${image.xref}?v=${s.version}`} alt=""
                  className="h-14 w-14 shrink-0 rounded object-contain bg-white/90" loading="lazy" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">Image {image.xref}</p>
                  <p className="text-[10px] text-[#8faebb]">Page {image.page} - {image.width}x{image.height} {String(image.ext || "").toUpperCase()}</p>
                  <div className="mt-1 flex gap-1">
                    <Btn size="sm" variant="ghost" onClick={() => {
                      replaceTarget.current = image;
                      replaceRef.current?.click();
                    }}>Replace</Btn>
                    <Btn size="sm" variant="ghost" className="!text-[#ff9eaa]" onClick={() => deleteImage(image)}>Remove</Btn>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No embedded images were found. Use Place to add a picture to the current page.</Empty>
        )}
      </Section>

      <Section title="Placement tips">
        <ul className="space-y-1.5 text-[11px] leading-4 text-[#9db8c4]">
          <li className="flex gap-2"><Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7fd3c9]" />Images are placed in the centre of the current page and scaled proportionally.</li>
          <li className="flex gap-2"><Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7fd3c9]" />Replacing an image removes the original pixels and inserts the new file at the same rectangle.</li>
          <li className="flex gap-2"><Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7fd3c9]" />Undo restores the previous page after any image operation.</li>
        </ul>
      </Section>
    </div>
  );
}
