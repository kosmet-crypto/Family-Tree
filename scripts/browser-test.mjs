// Runs src/lib/media/compress.ts in headless Chromium and checks the results with numbers.
// Local: npm run test:browser   (uses the preinstalled Playwright Chromium; override with CHROMIUM_PATH)
import { build } from "esbuild";
import { chromium } from "playwright-core";

const bundle = await build({
  entryPoints: ["src/lib/media/compress.ts"],
  bundle: true,
  format: "iife",
  globalName: "compress",
  write: false,
});
const code = bundle.outputFiles[0].text;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.setContent("<!doctype html><title>compress test</title>");
await page.addScriptTag({ content: code });

const results = await page.evaluate(async () => {
  const { compressImage } = window.compress;
  // 4000x3000 noisy photo-like PNG (hard to compress)
  const c = document.createElement("canvas");
  c.width = 4000;
  c.height = 3000;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 4000, 3000);
  g.addColorStop(0, "#335");
  g.addColorStop(1, "#fc8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4000, 3000);
  const img = ctx.getImageData(0, 0, 4000, 3000);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 60;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const png = await new Promise((r) => c.toBlob(r, "image/png"));

  const big = await compressImage(png);
  const jpeg = await compressImage(png, { mimeType: "image/jpeg", maxDimension: 800, thumbnailDimension: null });
  let heic = "no error";
  try {
    await compressImage(new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99])], { type: "image/heic" }));
  } catch (e) { heic = e.code; }
  let pdf = "no error";
  try { await compressImage(new Blob(["%PDF"], { type: "application/pdf" })); } catch (e) { pdf = e.code; }
  return {
    originalBytes: big.originalBytes,
    out: { w: big.width, h: big.height, bytes: big.blob.size, type: big.mimeType },
    thumb: { w: big.thumbnail.width, h: big.thumbnail.height, bytes: big.thumbnail.blob.size },
    jpeg: { w: jpeg.width, h: jpeg.height, bytes: jpeg.blob.size, type: jpeg.blob.type, thumb: jpeg.thumbnail === undefined },
    heic,
    pdf,
  };
});
await browser.close();

console.log(JSON.stringify(results, null, 2));
const checks = [
  ["no page errors", errors.length === 0],
  ["resized to 1600x1200", results.out.w === 1600 && results.out.h === 1200],
  ["under 500 KB", results.out.bytes <= 500 * 1024],
  ["webp", results.out.type === "image/webp"],
  ["much smaller than original", results.out.bytes < results.originalBytes / 5],
  ["thumbnail 320x240", results.thumb.w === 320 && results.thumb.h === 240],
  ["jpeg option 800x600", results.jpeg.w === 800 && results.jpeg.h === 600 && results.jpeg.type === "image/jpeg" && results.jpeg.thumb],
  ["undecodable HEIC -> unsupported_format", results.heic === "unsupported_format"],
  ["pdf -> not_an_image", results.pdf === "not_an_image"],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}
if (errors.length) console.log(errors);
process.exit(failed ? 1 : 0);
