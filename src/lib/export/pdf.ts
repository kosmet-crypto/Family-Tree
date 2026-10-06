// Minimal PDF writer: one page with one JPEG image scaled to fit (no dependencies, no fonts).
// The tree is drawn on a canvas first, so Cyrillic text needs no embedded font.

export type PageSize = "A4" | "A3";
const SIZES: Record<PageSize, [number, number]> = { A4: [595.28, 841.89], A3: [841.89, 1190.55] };

const enc = new TextEncoder();

export function pdfFromJpeg(jpeg: Uint8Array, imgW: number, imgH: number, size: PageSize = "A3", title = ""): Uint8Array {
  const [short, long] = SIZES[size];
  const landscape = imgW >= imgH;
  const pw = landscape ? long : short;
  const ph = landscape ? short : long;
  const margin = 24;
  const scale = Math.min((pw - 2 * margin) / imgW, (ph - 2 * margin) / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const x = (pw - w) / 2;
  const y = (ph - h) / 2;
  const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
  const safeTitle = title.replace(/[^\x20-\x7e]/g, "?").replace(/[()\\]/g, "");

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === "string" ? enc.encode(b) : b; chunks.push(u); len += u.length; };
  const obj = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${body}`);
    if (stream) { push("\nstream\n"); push(stream); push("\nendstream"); }
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  obj(4, `<< /Length ${content.length} >>`, enc.encode(content));
  obj(5, `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  obj(6, `<< /Title (${safeTitle}) /Producer (Roots and Branches) >>`);
  const xref = len;
  push(`xref\n0 7\n0000000000 65535 f \n`);
  for (let i = 1; i <= 6; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
