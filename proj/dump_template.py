import fitz
doc = fitz.open("assets/Trailer_Report_TEMPLATE_v2.pdf")
out = []
for i, p in enumerate(doc, 1):
    out.append(f"\n===== PAGE {i}  {p.rect.width:.0f}x{p.rect.height:.0f} =====")
    for b in p.get_text("dict")["blocks"]:
        if b["type"] == 0:
            for l in b["lines"]:
                t = "".join(s["text"] for s in l["spans"]).strip()
                if t:
                    s = l["spans"][0]
                    out.append(f'{l["bbox"][0]:.0f},{l["bbox"][1]:.0f} | {s["font"]} {s["size"]:.1f} #{s["color"]:06x} | {t}')
        else:
            out.append(f'[image] {tuple(round(x) for x in b["bbox"])}')
    for w in p.widgets() or []:
        out.append(f'[field] {w.field_name} {tuple(round(x) for x in w.rect)}')
    out.append(f'[drawings] {len(p.get_drawings())}')
open("template_dump.txt", "w", encoding="utf-8").write("\n".join(out))