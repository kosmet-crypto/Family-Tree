// Draws the whole tree onto a canvas (same layout, colours and sides as the screen) and turns it
// into a PNG or a print-ready PDF. Everything happens on the device; nothing is uploaded.

import { lifespanLabel } from "@/lib/dates";
import type { FamilyGraph } from "@/lib/graph/family-graph";
import { pdfFromJpeg, type PageSize } from "@/lib/export/pdf";
import { personDisplayName } from "@/lib/search";
import { layoutTree, NODE_H, NODE_W } from "./layout";

const GEN = ["#ffe0ea", "#ffecd2", "#fff7c2", "#d8f5df", "#d6ecff", "#e8ddff"];
const GEN_B = ["#ff8fb1", "#ffb865", "#f2d24b", "#5fcf80", "#5fb3ff", "#a583ff"];
const SIDE = { "-1": "#ff9f43", "1": "#3ea0ff" } as const;
const PAD = 60;
const HEADER = 90;

const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v * (1 - t) + y[i]! * t)).join(",")})`;
};

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fit(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

export function renderTreeCanvas(graph: FamilyGraph, rootId: string | null, treeName: string): HTMLCanvasElement {
  const layout = layoutTree(graph, rootId);
  const w = Math.max(layout.width, NODE_W) + PAD * 2;
  const h = layout.height + PAD * 2 + HEADER;
  const scale = Math.min(2, 7000 / Math.max(w, h)); // keep the bitmap within what phones can allocate
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const g = canvas.getContext("2d")!;
  g.scale(scale, scale);
  g.fillStyle = "#fff8f3";
  g.fillRect(0, 0, w, h);

  g.fillStyle = "#2a2140";
  g.font = "800 34px system-ui, sans-serif";
  g.textBaseline = "alphabetic";
  g.fillText(treeName, PAD, 52);
  g.font = "600 15px system-ui, sans-serif";
  g.fillStyle = "#7a6f93";
  g.fillText(`${graph.persons.size} особа · ${new Date().toLocaleDateString("sr-RS")}`, PAD, 76);
  if (layout.side.size) {
    let lx = w - PAD;
    for (const [label, color] of [["Мајчина страна", SIDE["1"]], ["Очева страна", SIDE["-1"]]] as const) {
      g.font = "700 13px system-ui, sans-serif";
      const tw = g.measureText(label).width + 22;
      lx -= tw;
      g.fillStyle = color + "88";
      roundRect(g, lx, 36, tw, 26, 13);
      g.fill();
      g.fillStyle = "#2a2140";
      g.fillText(label, lx + 11, 54);
      lx -= 8;
    }
  }

  const ox = PAD, oy = PAD + HEADER;
  const cx = (id: string) => ox + layout.positions.get(id)!.x + NODE_W / 2;
  const top = (id: string) => oy + layout.positions.get(id)!.y;

  // links: parent -> child as elbows, partners as a short line between the cards
  g.lineCap = "round";
  g.lineWidth = 3;
  for (const id of graph.persons.keys()) {
    if (!layout.positions.has(id)) continue;
    for (const e of graph.childEdgesOf(id)) {
      if (!layout.positions.has(e.child_id)) continue;
      const x1 = cx(e.parent_id), y1 = top(e.parent_id) + NODE_H, x2 = cx(e.child_id), y2 = top(e.child_id);
      const my = (y1 + y2) / 2;
      g.strokeStyle = "#c9b8e8";
      g.setLineDash(e.relation === "biological" ? [] : [8, 6]);
      g.beginPath();
      g.moveTo(x1, y1); g.lineTo(x1, my); g.lineTo(x2, my); g.lineTo(x2, y2);
      g.stroke();
    }
    for (const p of graph.partnershipsOf(id)) {
      if (p.person1_id !== id || !layout.positions.has(p.person2_id)) continue;
      const a = layout.positions.get(p.person1_id)!, b = layout.positions.get(p.person2_id)!;
      const ended = p.status === "divorced" || p.status === "separated" || p.status === "annulled";
      g.strokeStyle = ended ? "#c9b8e8" : "#ff6f91";
      g.setLineDash(ended ? [4, 6] : []);
      g.lineWidth = 4;
      g.beginPath();
      const y = oy + a.y + NODE_H / 2;
      const [l, r] = a.x <= b.x ? [a, b] : [b, a];
      g.moveTo(ox + l.x + NODE_W, y); g.lineTo(ox + r.x, y);
      g.stroke();
      g.lineWidth = 3;
    }
  }
  g.setLineDash([]);

  const minGen = Math.min(...layout.generation.values());
  for (const [id, pos] of layout.positions) {
    const p = graph.person(id)!;
    const gen = (((layout.generation.get(id) ?? minGen) % 6) + 6) % 6;
    const side = (layout.side.get(id) ?? 0) as -1 | 0 | 1;
    const fill = side === 0 ? GEN[gen]! : mix(GEN[gen]!, SIDE[String(side) as "-1" | "1"], 0.38);
    const border = side === 0 ? GEN_B[gen]! : mix(GEN_B[gen]!, SIDE[String(side) as "-1" | "1"], 0.55);
    const x = ox + pos.x, y = oy + pos.y;
    g.save();
    g.shadowColor = "rgba(124,77,255,0.25)"; g.shadowBlur = 14; g.shadowOffsetY = 5;
    roundRect(g, x, y, NODE_W, NODE_H, 28);
    g.fillStyle = fill; g.fill();
    g.restore();
    roundRect(g, x, y, NODE_W, NODE_H, 28);
    g.lineWidth = 3; g.strokeStyle = border; g.stroke();
    // avatar circle with initials, ring in the gender colour
    const ring = p.gender === "male" ? "#4aa8ff" : p.gender === "female" ? "#ff6f91" : p.gender === "other" ? "#ffb020" : "#c9b8e8";
    g.beginPath(); g.arc(x + 38, y + NODE_H / 2, 24, 0, Math.PI * 2);
    g.fillStyle = "#fff"; g.fill(); g.lineWidth = 4; g.strokeStyle = ring; g.stroke();
    g.fillStyle = "#7a6f93"; g.font = "800 15px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(((p.first_name[0] ?? "") + (p.last_name?.[0] ?? "")).toUpperCase() || "?", x + 38, y + NODE_H / 2 + 1);
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = "#2a2140"; g.font = "800 14px system-ui, sans-serif";
    const name = personDisplayName(p);
    const sp = name.lastIndexOf(" ");
    const [l1, l2] = sp > 0 && g.measureText(name).width > NODE_W - 78 ? [name.slice(0, sp), name.slice(sp + 1)] : [name, ""];
    g.fillText(fit(g, l1, NODE_W - 78), x + 70, y + (l2 ? 30 : 38));
    if (l2) g.fillText(fit(g, l2, NODE_W - 78), x + 70, y + 47);
    g.fillStyle = "#7a6f93"; g.font = "600 12px system-ui, sans-serif";
    const years = lifespanLabel({ date: p.birth_date, precision: p.birth_date_precision }, { date: p.death_date, precision: p.death_date_precision }, p.is_living);
    g.fillText(years, x + 70, y + (l2 ? 63 : 58));
  }
  return canvas;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("export_failed"))), type, q));

export async function treeToPng(graph: FamilyGraph, rootId: string | null, name: string): Promise<Blob> {
  return toBlob(renderTreeCanvas(graph, rootId, name), "image/png");
}

export async function treeToPdf(graph: FamilyGraph, rootId: string | null, name: string, size: PageSize = "A3"): Promise<Blob> {
  const canvas = renderTreeCanvas(graph, rootId, name);
  const jpeg = new Uint8Array(await (await toBlob(canvas, "image/jpeg", 0.92)).arrayBuffer());
  return new Blob([pdfFromJpeg(jpeg, canvas.width, canvas.height, size, name) as BlobPart], { type: "application/pdf" });
}
