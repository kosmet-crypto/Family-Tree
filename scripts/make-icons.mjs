// Renders public/icons/icon.svg to the PNG sizes needed by the PWA, iOS and Android.
// Run once after changing the SVG: node scripts/make-icons.mjs
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const svg = readFileSync("public/icons/icon.svg", "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const render = async (size, file, { padding = 0, background = "transparent", square = false } = {}) => {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - padding * 2;
  const art = square ? svg.replace('rx="112"', 'rx="0"') : svg;
  await page.setContent(`<html><body style="margin:0;background:${background}">
    <div style="width:${size}px;height:${size}px;display:grid;place-items:center">
      <div style="width:${inner}px;height:${inner}px">${art.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div>
    </div></body></html>`);
  await page.screenshot({ path: file, omitBackground: background === "transparent" });
};
await render(192, "public/icons/icon-192.png");
await render(512, "public/icons/icon-512.png");
// maskable: full-bleed background, art inside the 80% safe zone
await render(512, "public/icons/maskable-512.png", { padding: 52, background: "#2f6b4f", square: true });
await render(180, "public/icons/apple-touch-icon.png", { square: true, background: "#2f6b4f" });
await render(48, "public/favicon.png");
await browser.close();
console.log("icons written");

// ---- Android launcher icons and splash screens (only when android/ exists) ----
import { existsSync, readdirSync } from "node:fs";
if (existsSync("android/app/src/main/res")) {
  const res = "android/app/src/main/res";
  const b2 = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const p2 = await b2.newPage();
  const artOnly = svg.replace(/<rect[^>]*\/>/, "");
  const draw = async (w, h, file, { artSize, bg, rounded = false, circle = false }) => {
    await p2.setViewportSize({ width: w, height: h });
    const icon = rounded ? svg : artOnly;
    await p2.setContent(`<html><body style="margin:0;background:${circle ? "transparent" : bg}">
      <div style="width:${w}px;height:${h}px;display:grid;place-items:center;overflow:hidden;${circle ? `border-radius:50%;background:${bg};` : ""}">
        ${icon.replace("<svg ", `<svg width="${artSize}" height="${artSize}" `)}
      </div></body></html>`);
    await p2.screenshot({ path: file, omitBackground: bg === "transparent" || circle });
  };
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, s] of Object.entries(dens)) {
    const dir = `${res}/mipmap-${d}`;
    await draw(48 * s, 48 * s, `${dir}/ic_launcher.png`, { artSize: 48 * s, bg: "transparent", rounded: true });
    await draw(48 * s, 48 * s, `${dir}/ic_launcher_round.png`, { artSize: 48 * s * 0.92, bg: "#2f6b4f", circle: true });
    // adaptive foreground: 108dp canvas, art inside the 66dp safe zone
    await draw(108 * s, 108 * s, `${dir}/ic_launcher_foreground.png`, { artSize: 66 * s * 1.1, bg: "transparent" });
  }
  // splash screens: keep each file's size, icon in the middle on the app background
  for (const dir of readdirSync(res).filter((n) => n.startsWith("drawable"))) {
    const file = `${res}/${dir}/splash.png`;
    if (!existsSync(file)) continue;
    const buf = readFileSync(file);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    await draw(w, h, file, { artSize: Math.round(Math.min(w, h) * 0.32), bg: "#f7f4ee", rounded: true });
  }
  await b2.close();
  console.log("android icons written");
}
