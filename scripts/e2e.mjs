// End-to-end check of the UI in local mode (no Supabase), phone-sized viewport.
// Usage: BASE_URL=http://localhost:3000 node scripts/e2e.mjs [--screenshot out.png]
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const shotArg = process.argv.indexOf("--screenshot");
const SHOT = shotArg > 0 ? process.argv[shotArg + 1] : null;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("dialog", (d) => void d.accept());

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); };
const nodes = () => page.locator('[data-testid="person-node"]').count();
const viewport = () => page.locator(".react-flow__viewport").getAttribute("style");

async function addViaPanel(personName, button, fill) {
  await page.locator(`[data-testid="person-node"]:has-text("${personName}")`).first().click();
  await page.getByTestId("mini-card").waitFor();
  check("mini card shows name", (await page.getByTestId("mini-name").textContent()).includes(personName));
  await page.getByTestId("open-panel").click();
  await page.getByTestId("person-panel").waitFor();
  await page.getByTestId(button).click();
  await page.getByTestId("person-dialog").waitFor();
  await fill();
  await page.getByTestId("save-person").click();
  await page.getByTestId("person-dialog").waitFor({ state: "hidden" });
}

async function fillPerson(first, last, gender, birth) {
  await page.getByTestId("first-name").fill(first);
  if (last !== null) await page.getByTestId("last-name").fill(last);
  await page.locator(`[data-testid="gender"] button:has-text("${gender}")`).click();
  if (birth) await page.getByTestId("birth-date").fill(birth);
}

try {
  // 1. home + create tree
  await page.goto(`${BASE}/`);
  await page.getByTestId("local-mode").waitFor();
  check("local mode notice", true);
  await page.getByTestId("new-tree").click();
  await page.getByTestId("tree-name").fill("Петровић");
  await page.getByTestId("create-tree").click();
  await page.waitForURL(/\/tree\/?\?id=/);
  await page.getByTestId("add-first").click();

  // 2. first person
  await fillPerson("Јован", "Петровић", "Мушко", "05.05.1960");
  await page.getByTestId("save-person").click();
  await page.locator('[data-testid="person-node"]').first().waitFor();
  check("first person on canvas", (await nodes()) === 1);

  // 3. relatives
  await addViaPanel("Јован", "add-child", () => fillPerson("Марко", null, "Мушко", "03.03.1990"));
  await addViaPanel("Јован", "add-partner", async () => {
    await fillPerson("Јелена", "Петровић", "Женско", "02.02.1962");
    await page.getByTestId("partner-status").selectOption("divorced");
  });
  await addViaPanel("Јован", "add-parent", () => fillPerson("Милан", "Петровић", "Мушко", "01.01.1930"));
  await addViaPanel("Јован", "add-sibling", () => fillPerson("Весна", null, "Женско", "01.01.1963"));
  await page.waitForTimeout(300);
  check("5 people after adding relatives", (await nodes()) === 5, String(await nodes()));
  check("inherited last name for child", (await page.locator('[data-testid="person-node"]:has-text("Марко Петровић")').count()) === 1);

  // 3b. edit a partnership in place (divorced -> active) without re-entering the partner
  const label = () => page.locator('.react-flow__edge-text:has-text("развод")').count();
  check("divorced label shown", (await label()) === 1, String(await label()));
  await page.getByLabel("Цело стабло").click();
  await page.waitForTimeout(700);
  await page.locator('[data-testid="person-node"]:has-text("Јован")').first().click();
  await page.getByTestId("open-panel").click();
  await page.getByTestId("person-panel").waitFor();
  await page.getByTestId("edit-partnership").first().click();
  await page.getByTestId("partnership-dialog").waitFor();
  await page.locator('[data-testid="pe-status"] button:has-text("Траје")').click();
  await page.getByTestId("save-partnership").click();
  await page.getByTestId("partnership-dialog").waitFor({ state: "hidden" });
  await page.waitForTimeout(300);
  check("partnership edited in place", (await label()) === 0, String(await label()));
  check("still 5 people", (await nodes()) === 5);

  // 4. validation: Marko cannot become Milan's parent (cycle); too-young parent warning
  await page.locator('[data-testid="person-node"]:has-text("Милан")').first().click();
  await page.getByTestId("open-panel").click();
  await page.getByTestId("add-parent").click();
  await page.getByTestId("person-dialog").locator('button:has-text("Постојећа")').click();
  await page.getByTestId("person-dialog").locator('li button:has-text("Марко")').click();
  await page.getByTestId("save-person").click();
  const issueText = await page.getByTestId("issues").innerText();
  check("cycle rejected in the form", issueText.includes("сопственим претком"), issueText);
  await page.getByTestId("person-dialog").locator('button[aria-label="Затвори"]').click();

  // 5. complex model shows extra fields
  await page.locator('[data-testid="person-node"]:has-text("Весна")').first().click();
  await page.getByTestId("open-panel").click();
  await page.getByTestId("edit-person").click();
  const simpleHasBirthName = await page.getByTestId("birth-name").count();
  await page.locator('[data-testid="mode-toggle"] button:has-text("Сложен")').click();
  const complexHasBirthName = await page.getByTestId("birth-name").count();
  check("simple/complex model toggles fields", simpleHasBirthName === 0 && complexHasBirthName === 1);
  await page.getByTestId("birth-name").fill("Петровић");
  await page.getByTestId("last-name").fill("Илић");
  await page.getByTestId("notes").fill("Удата у Нишу.");
  await page.getByTestId("save-person").click();
  await page.getByTestId("person-dialog").waitFor({ state: "hidden" });
  check("edit saved", (await page.locator('[data-testid="person-node"]:has-text("Весна Илић")').count()) === 1);

  // 6. kinship shown in the panel (root = Јован, the first person)
  await page.locator('[data-testid="person-node"]:has-text("Весна")').first().click();
  await page.getByTestId("open-panel").click();
  const rel = await page.getByTestId("panel-relation").innerText();
  check("kinship label in panel", rel === "сестра", rel);
  await page.keyboard.press("Escape");

  // 7. search (Latin query finds Cyrillic name) and fly-to
  await page.locator('button[aria-label="Цело стабло"]').click();
  await page.waitForTimeout(700);
  const before = await viewport();
  await page.getByTestId("search").fill("marko");
  await page.getByTestId("search-results").locator("button").first().click();
  await page.waitForTimeout(1000);
  const after = await viewport();
  const zoom = Number(/scale\(([\d.]+)\)/.exec(after ?? "")?.[1] ?? 0);
  check("search flies to person", before !== after && Math.abs(zoom - 1.25) < 0.01, `${before} -> ${after}`);
  const box = await page.locator('[data-testid="person-node"]:has-text("Марко")').first().boundingBox();
  check("found person centred on screen", box && Math.abs(box.x + box.width / 2 - 195) < 40, JSON.stringify(box));

  // 8. photo upload (compressed in the browser) becomes the avatar
  await page.locator('[data-testid="person-node"]:has-text("Марко")').first().click();
  await page.getByTestId("open-panel").click();
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 900;
    const g = c.getContext("2d"); g.fillStyle = "#2f6b4f"; g.fillRect(0, 0, 1200, 900); g.fillStyle = "#fc8"; g.beginPath(); g.arc(600, 450, 300, 0, 7); g.fill();
    const b = await new Promise((r) => c.toBlob(r, "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.getByTestId("photo-input").setInputFiles({ name: "marko.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await page.locator('[data-testid="person-node"]:has-text("Марко") img').waitFor({ state: "attached", timeout: 10000 });
  check("photo becomes avatar", true);
  await page.keyboard.press("Escape");

  // 9. generations list
  await page.locator('[data-testid="view-toggle"] button:has-text("Листа")').click();
  const sections = await page.getByTestId("generation-list").locator("section").count();
  const listText = await page.getByTestId("generation-list").innerText();
  check("list view by generations", sections === 3 && listText.toLowerCase().includes("родитељи") && listText.includes("син"), `${sections}`);
  await page.locator('[data-testid="view-toggle"] button:has-text("Стабло")').click();

  // 10. settings: About credit, JSON backup and import
  await page.goto(`${BASE}/settings/`);
  const credit = await page.getByTestId("credit").innerText();
  check("developer credit", credit === "Developed by: Ivan S. - Epicurus001, Oslo", credit);
  await page.getByTestId("theme-ocean").click();
  check("theme applied", (await page.evaluate(() => document.documentElement.dataset.theme)) === "ocean");
  await page.reload();
  check("theme persists after reload", (await page.evaluate(() => document.documentElement.dataset.theme)) === "ocean");
  await page.getByTestId("theme-bubblegum").click();
  await page.goto(`${BASE}/data/`);
  await page.getByTestId("export-json").waitFor();
  check("data screen has update check", (await page.getByTestId("check-update").count()) === 1);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-json").click()]);
  const path = await download.path();
  const backup = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
  check("JSON backup has 5 people and the photo", backup.persons.length === 5 && backup.media.length === 1 && backup.media[0].data_url?.startsWith("data:image/"), `${backup.persons.length}/${backup.media.length}`);
  await page.getByTestId("settings-import-input").setInputFiles(path);
  await page.waitForURL(/\/tree\/?\?id=/);
  await page.locator('[data-testid="person-node"]').first().waitFor();
  await page.waitForTimeout(500);
  check("imported backup as a new tree", (await nodes()) === 5 && (await page.locator('[data-testid="person-node"] img').count()) === 1);
  await page.goto(`${BASE}/`);
  await page.getByTestId("tree-list").waitFor();
  check("two trees listed", (await page.getByTestId("tree-list").locator("li").count()) === 2);

  // 10a. tree export: PDF and PNG are real files
  await page.getByTestId("tree-list").locator("li a").first().click().catch(() => {});
  await page.waitForURL(/\/tree\/?\?id=/);
  await page.locator('[data-testid="person-node"]').first().waitFor();
  await page.getByTestId("open-export").click();
  const [pdfDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-pdf").click()]);
  const pdfHead = (await (await import("node:fs/promises")).readFile(await pdfDl.path())).subarray(0, 5).toString();
  check("PDF export is a PDF", pdfHead === "%PDF-" && pdfDl.suggestedFilename().endsWith(".pdf"), pdfHead);
  const [pngDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-png").click()]);
  const pngHead = (await (await import("node:fs/promises")).readFile(await pngDl.path())).subarray(1, 4).toString();
  check("PNG export is a PNG", pngHead === "PNG", pngHead);
  await page.goto(`${BASE}/`);
  await page.getByTestId("tree-list").waitFor();

  // 10b. GEDCOM (Family Tree Maker export) becomes a separate new tree
  const ged = "0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Petar /Јовић/\n1 SEX M\n1 BIRT\n2 DATE 1 JAN 1940\n0 @I2@ INDI\n1 NAME Ana /Јовић/\n1 SEX F\n0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n0 TRLR\n";
  await page.getByTestId("import-file").setInputFiles({ name: "porodica", mimeType: "text/plain", buffer: Buffer.from(ged) });
  await page.waitForURL(/\/tree\/?\?id=/);
  await page.locator('[data-testid="person-node"]').first().waitFor();
  await page.waitForTimeout(300);
  check("GEDCOM imported as a new tree", (await nodes()) === 2);
  await page.goto(`${BASE}/`);
  await page.getByTestId("tree-list").waitFor();
  check("three trees listed", (await page.getByTestId("tree-list").locator("li").count()) === 3);

  // 11. data survives a reload (IndexedDB)
  await page.reload();
  await page.getByTestId("tree-list").waitFor();
  check("data persists after reload", (await page.getByTestId("tree-list").locator("li").count()) === 3);

  if (SHOT) {
    await page.getByTestId("tree-list").locator("a").last().click();
    await page.locator('[data-testid="person-node"]').first().waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: SHOT });
  }
} catch (e) {
  check("scenario finished", false, String(e?.stack ?? e));
}
await browser.close();

check("no page/console errors", errors.length === 0, errors.join("\n"));
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${!r.ok && r.detail ? `\n     ${r.detail}` : ""}`);
  if (!r.ok) failed++;
}
writeFileSync(process.env.E2E_REPORT ?? "/dev/null", JSON.stringify(results, null, 2));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
