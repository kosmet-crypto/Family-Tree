// Serves out/ like GitHub Pages does: under a base path, dir/index.html, 404.html fallback.
// Usage: node scripts/serve-static.mjs [port] [basePath]
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const port = Number(process.argv[2] ?? 3200);
const base = (process.argv[3] ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const root = join(process.cwd(), "out");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".woff2": "font/woff2" };

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (base && !path.startsWith(base)) { res.writeHead(404); res.end(); return; }
  path = normalize(path.slice(base.length) || "/");
  let file = join(root, path);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  const found = existsSync(file);
  if (!found) file = join(root, "404.html");
  res.writeHead(found ? 200 : 404, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving out/ at http://localhost:${port}${base}/`));
