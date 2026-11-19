
/*
 * pdfExport.js — bakes the PdfEditor overlay items into a real PDF with pdf-lib.
 *
 * Coordinate system used by every item: PDF points, origin TOP-LEFT of the
 * unrotated page (pdf-lib's origin is bottom-left, so y is flipped here).
 *
 * edits = {
 *   items: { [pageKey]: Item[] },
 *   pages: { [pageKey]: { rot: 0|90|180|270, deleted: bool, blanks: number } }
 * }
 *
 * Blank pages inserted after page `k` use keys `${k}#b1`, `${k}#b2`, ...
 */

export const hexToRgb01 = (hex) => {
  let s = String(hex || "#000000").replace("#", "");

  if (s.length === 3) {
    s = s.split("").map((c) => c + c).join("");
  }

  return [0, 2, 4].map(
    (i) => (parseInt(s.slice(i, i + 2), 16) || 0) / 255
  );
};

export const b64ToBytes = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }

  return out;
};

export const dataUrlToBytes = (url) =>
  b64ToBytes(url.split(",")[1] || "");

/* ---- shared geometry (editor preview + export use the same numbers) ---- */

export function markSegments(it) {
  const { x, y, w } = it;
  const s = w;

  if (it.type === "check") {
    return [
      [
        x + 0.15 * s,
        y + 0.55 * s,
        x + 0.4 * s,
        y + 0.82 * s,
      ],
      [
        x + 0.4 * s,
        y + 0.82 * s,
        x + 0.88 * s,
        y + 0.18 * s,
      ],
    ];
  }

  if (it.type === "cross") {
    return [
      [
        x + 0.18 * s,
        y + 0.18 * s,
        x + 0.82 * s,
        y + 0.82 * s,
      ],
      [
        x + 0.82 * s,
        y + 0.18 * s,
        x + 0.18 * s,
        y + 0.82 * s,
      ],
    ];
  }

  return [];
}

export function arrowHead(it) {
  const ang = Math.atan2(it.y2 - it.y, it.x2 - it.x);
  const len = Math.max(9, (it.sw || 2) * 4.5);

  const a1 = ang + Math.PI - 0.45;
  const a2 = ang + Math.PI + 0.45;

  return [
    [
      it.x2,
      it.y2,
      it.x2 + len * Math.cos(a1),
      it.y2 + len * Math.sin(a1),
    ],
    [
      it.x2,
      it.y2,
      it.x2 + len * Math.cos(a2),
      it.y2 + len * Math.sin(a2),
    ],
  ];
}

export const FONT_FAMILIES = {
  Helvetica: "Helvetica, Arial, sans-serif",
  Times: "'Times New Roman', Times, serif",
  Courier: "'Courier New', Courier, monospace",
};

const STD = {
  Helvetica: [
    "Helvetica",
    "HelveticaBold",
    "HelveticaOblique",
    "HelveticaBoldOblique",
  ],
  Times: [
    "TimesRoman",
    "TimesRomanBold",
    "TimesRomanItalic",
    "TimesRomanBoldItalic",
  ],
  Courier: [
    "Courier",
    "CourierBold",
    "CourierOblique",
    "CourierBoldOblique",
  ],
};

async function toEmbeddableDataUrl(src) {
  if (/^data:image\/(png|jpeg|jpg)/i.test(src)) {
    return src;
  }

  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);

  return c.toDataURL("image/png");
}

function wrapLines(font, size, text, maxW) {
  const out = [];

  for (const para of String(text || "").split("\n")) {
    const words = para.split(" ");
    let line = "";

    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;

      if (
        line &&
        font.widthOfTextAtSize(trial, size) > maxW
      ) {
        out.push(line);
        line = word;
      } else {
        line = trial;
      }
    }

    out.push(line);
  }

  return out;
}

export async function exportPdf({
  bytes,
  keys,
  edits,
  scope = null,
  flattenPage = null,
}) {
  const PL = await import("pdf-lib");

  const {
    PDFDocument,
    StandardFonts,
    rgb,
    degrees,
    BlendMode,
    LineCapStyle,
    PDFString,
    PDFHexString,
  } = PL;

  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
  });

  const fontCache = {};
  const imgCache = {};

  const getFont = async (it) => {
    const fam = STD[it.font] ? it.font : "Helvetica";

    const name =
      STD[fam][(it.bold ? 1 : 0) + (it.italic ? 2 : 0)];

    return (
      fontCache[name] ||= await doc.embedFont(
        StandardFonts[name]
      )
    );
  };

  const safe = (font, s) => {
    let out = "";

    for (const ch of String(s)) {
      if (ch === "\n") {
        out += ch;
        continue;
      }

      try {
        font.encodeText(ch);
        out += ch;
      } catch {
        out += "?";
      }
    }

    return out;
  };

  const getImg = async (src) => {
    if (imgCache[src]) {
      return imgCache[src];
    }

    const url = await toEmbeddableDataUrl(src);
    const data = dataUrlToBytes(url);

    imgCache[src] = /^data:image\/png/i.test(url)
      ? await doc.embedPng(data)
      : await doc.embedJpg(data);

    return imgCache[src];
  };

  const col = (h) => {
    const [r, g, b] = hexToRgb01(h);
    return rgb(r, g, b);
  };

  const addAnnot = (page, dict) =>
    page.node.addAnnot(
      doc.context.register(doc.context.obj(dict))
    );

  const draw = async (page, H, items) => {
    for (const it of items) {
      const op = it.opacity ?? 1;
      const y0 = (yy) => H - yy;

      switch (it.type) {
        case "rect":
          page.drawRectangle({
            x: it.x,
            y: H - it.y - it.h,
            width: it.w,
            height: it.h,
            borderColor: col(it.color),
            borderWidth: it.sw || 2,
            borderOpacity: op,
            ...(it.fill
              ? {
                  color: col(it.fill),
                  opacity: op * 0.9,
                }
              : {}),
          });
          break;

        case "ellipse":
          page.drawEllipse({
            x: it.x + it.w / 2,
            y: H - it.y - it.h / 2,
            xScale: it.w / 2,
            yScale: it.h / 2,
            borderColor: col(it.color),
            borderWidth: it.sw || 2,
            borderOpacity: op,
            ...(it.fill
              ? {
                  color: col(it.fill),
                  opacity: op * 0.9,
                }
              : {}),
          });
          break;

        case "line":
        case "arrow": {
          const segs = [
            [it.x, it.y, it.x2, it.y2],
            ...(it.type === "arrow" ? arrowHead(it) : []),
          ];

          for (const [a, b, c, d] of segs) {
            page.drawLine({
              start: { x: a, y: y0(b) },
              end: { x: c, y: y0(d) },
              thickness: it.sw || 2,
              color: col(it.color),
              opacity: op,
              lineCap: LineCapStyle.Round,
            });
          }

          break;
        }

        case "ink": {
          if (!it.pts || it.pts.length < 2) {
            break;
          }

          const d = it.pts
            .map(
              ([px, py], i) =>
                `${i ? "L" : "M"}${px.toFixed(2)} ${py.toFixed(2)}`
            )
            .join(" ");

          page.drawSvgPath(d, {
            x: 0,
            y: H,
            borderColor: col(it.color),
            borderWidth: it.sw || 2,
            borderOpacity: op,
            borderLineCap: LineCapStyle.Round,
          });

          break;
        }

        case "highlight":
          page.drawRectangle({
            x: it.x,
            y: H - it.y - it.h,
            width: it.w,
            height: it.h,
            color: col(it.color),
            opacity: 0.45 * (it.opacity ?? 1) + 0.1,
            blendMode: BlendMode.Multiply,
          });
          break;

        case "underline":
          page.drawLine({
            start: {
              x: it.x,
              y: H - (it.y + it.h) + 0.5,
            },
            end: {
              x: it.x + it.w,
              y: H - (it.y + it.h) + 0.5,
            },
            thickness: 1.2,
            color: col(it.color),
            opacity: op,
          });
          break;

        case "strike":
          page.drawLine({
            start: {
              x: it.x,
              y: H - (it.y + it.h * 0.55),
            },
            end: {
              x: it.x + it.w,
              y: H - (it.y + it.h * 0.55),
            },
            thickness: 1.2,
            color: col(it.color),
            opacity: op,
          });
          break;

        case "whiteout":
          page.drawRectangle({
            x: it.x,
            y: H - it.y - it.h,
            width: it.w,
            height: it.h,
            color: col(it.color || "#ffffff"),
          });
          break;

        case "redact":
          page.drawRectangle({
            x: it.x,
            y: H - it.y - it.h,
            width: it.w,
            height: it.h,
            color: rgb(0, 0, 0),
          });
          break;

        case "check":
        case "cross":
          for (const [a, b, c, d] of markSegments(it)) {
            page.drawLine({
              start: { x: a, y: y0(b) },
              end: { x: c, y: y0(d) },
              thickness: it.sw || 2,
              color: col(it.color),
              lineCap: LineCapStyle.Round,
            });
          }
          break;

        case "dot":
          page.drawCircle({
            x: it.x + it.w / 2,
            y: H - it.y - it.w / 2,
            size: it.w * 0.3,
            color: col(it.color),
          });
          break;

        case "text": {
          const font = await getFont(it);
          const size = it.size || 12;

          const lines = wrapLines(
            font,
            size,
            safe(font, it.text),
            it.w
          );

          const [r, g, b] = hexToRgb01(it.color);

          lines.forEach((ln, i) => {
            const tw = font.widthOfTextAtSize(ln, size);

            const dx =
              it.align === "center"
                ? (it.w - tw) / 2
                : it.align === "right"
                  ? it.w - tw
                  : 0;

            page.drawText(ln, {
              x: it.x + dx,
              y: H - it.y - size * 0.97 - i * size * 1.25,
              size,
              font,
              color: rgb(r, g, b),
            });
          });

          break;
        }

        case "image": {
          const img = await getImg(it.src);

          page.drawImage(img, {
            x: it.x,
            y: H - it.y - it.h,
            width: it.w,
            height: it.h,
            opacity: op,
          });

          break;
        }

        case "note": {
          const [r, g, b] = hexToRgb01(
            it.color || "#fde047"
          );

          page.drawRectangle({
            x: it.x,
            y: H - it.y - 18,
            width: 18,
            height: 18,
            color: rgb(r, g, b),
            borderColor: rgb(0.45, 0.35, 0),
            borderWidth: 0.8,
          });

          addAnnot(page, {
            Type: "Annot",
            Subtype: "Text",
            Name: "Comment",
            F: 4,
            Rect: [
              it.x,
              H - it.y - 18,
              it.x + 18,
              H - it.y,
            ],
            Contents: PDFHexString.fromText(it.text || ""),
            C: [r, g, b],
          });

          break;
        }

        case "link":
          if (it.url) {
            addAnnot(page, {
              Type: "Annot",
              Subtype: "Link",
              Border: [0, 0, 0],
              Rect: [
                it.x,
                H - it.y - it.h,
                it.x + it.w,
                H - it.y,
              ],
              A: {
                Type: "Action",
                S: "URI",
                URI: PDFString.of(it.url),
              },
            });
          }
          break;

        default:
          break;
      }
    }
  };

  const applyRot = (page, rot) => {
    if (rot) {
      page.setRotation(
        degrees(((page.getRotation().angle || 0) + rot) % 360)
      );
    }
  };

  const n = Math.min(doc.getPageCount(), keys.length);

  for (let i = n - 1; i >= 0; i--) {
    const key = keys[i];
    const st = edits.pages?.[key] || {};
    const inScope = !scope || scope.has(key);

    let page = doc.getPage(i);

    const { width: W, height: H } = page.getSize();

    const items = edits.items?.[key] || [];
    let toDraw = items;

    const redacts = items.filter(
      (x) => x.type === "redact"
    );

    if (
      redacts.length &&
      flattenPage &&
      inScope &&
      !st.deleted
    ) {
      // Real redaction: rasterise the page with the black boxes burned in
      // so the hidden text no longer exists in the file.
      const png = await flattenPage(i + 1, redacts);
      const img = await doc.embedPng(png);

      const np = doc.insertPage(i + 1, [W, H]);

      np.drawImage(img, {
        x: 0,
        y: 0,
        width: W,
        height: H,
      });

      doc.removePage(i);
      page = doc.getPage(i);

      toDraw = items.filter(
        (x) => x.type !== "redact"
      );
    }

    if (inScope && !st.deleted) {
      await draw(page, H, toDraw);
      applyRot(page, st.rot || 0);
    }

    for (let k = st.blanks || 0; k >= 1; k--) {
      const bk = `${key}#b${k}`;
      const bst = edits.pages?.[bk] || {};

      if (!inScope || bst.deleted) {
        continue;
      }

      const bp = doc.insertPage(i + 1, [W, H]);

      await draw(
        bp,
        H,
        edits.items?.[bk] || []
      );

      applyRot(bp, bst.rot || 0);
    }

    if (st.deleted || !inScope) {
      doc.removePage(i);
    }
  }

  if (doc.getPageCount() === 0) {
    throw new Error(
      "All pages are deleted — nothing to export."
    );
  }

  return doc.save();
}
