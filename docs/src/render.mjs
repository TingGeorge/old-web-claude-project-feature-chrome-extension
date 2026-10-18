// Renders the README images: node docs/src/render.mjs
// Needs Playwright (npm i -g playwright) and a Chromium build.
//
// 1. Loads the real extension in Chromium on the stand-in sidebar
//    (tests/fixtures/sidebar.html) with sample folders, and takes screenshots.
// 2. Renders banner.html and demo.html (which uses those screenshots).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Resolve playwright from a local or global install (ESM ignores NODE_PATH).
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH ?? "").split(":")] }));

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const out = path.join(here, "..", "images");
const shots = path.join(here, "shots");
fs.mkdirSync(shots, { recursive: true });

const SAMPLE = {
  version: 2,
  collapsed: { code: false, chat: false },
  settings: { hideInRecents: true },
  pending: null,
  folders: [
    { id: "work", name: "Work", space: "code", parentId: null, color: "#4f97d9", collapsed: false,
      items: [{ path: "/code/session_s2", title: "Fix flaky CI tests" }] },
    { id: "backend", name: "Backend", space: "code", parentId: "work", color: "", collapsed: false,
      items: [{ path: "/code/session_s1", title: "Refactor auth middleware" }, { path: "/code/session_s4", title: "Postgres migration plan" }] },
    { id: "side", name: "Side projects", space: "code", parentId: null, color: "#5fae6e", collapsed: false,
      items: [{ path: "/code/session_s6", title: "Rust CLI argument parser" }, { path: "/code/session_s7", title: "Docs site search" }] },
    { id: "learn", name: "Learning", space: "code", parentId: null, color: "#8b78e0", collapsed: true,
      items: [{ path: "/code/session_s8", title: "Interview prep notes" }] },
  ],
};

// --- 1. screenshots of the real extension --------------------------------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cf-render-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  viewport: { width: 900, height: 720 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  args: [`--disable-extensions-except=${path.join(root, "extension")}`, `--load-extension=${path.join(root, "extension")}`],
});
const fixture = fs.readFileSync(path.join(root, "tests/fixtures/sidebar.html"), "utf8");
await ctx.route("https://claude.ai/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: fixture }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
await sw.evaluate((s) => chrome.storage.local.set({ claudeFolders: s }), SAMPLE);

const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("https://claude.ai/code/session_s1");
await page.waitForSelector("#claude-folders-root");
await page.waitForTimeout(800);
const sh = (sel, o) => page.locator("#claude-folders-root").locator(sel, o);

// Mid-drag: a Recents chat over the "Side projects" folder.
const src = await page.locator("nav a", { hasText: "Landing page redesign" }).boundingBox();
const dst = await sh(".cf-folder-row", { hasText: "Side projects" }).boundingBox();
await page.mouse.move(src.x + 40, src.y + src.height / 2);
await page.mouse.down();
await page.mouse.move(src.x + 50, src.y + src.height / 2 - 10, { steps: 4 });
await page.mouse.move(dst.x + 120, dst.y + dst.height / 2, { steps: 12 });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shots, "drag.png") });
await page.keyboard.press("Escape");
await page.mouse.up();

// The folder menu.
const work = sh(".cf-folder-row", { hasText: "Work" });
await work.hover();
await work.locator('[data-action="folder-menu"]').click();
await page.waitForTimeout(200);
const box = await page.locator("#claude-folders-menu").evaluate((h) => {
  const r = h.shadowRoot.querySelector(".cf-menu").getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
await page.screenshot({ path: path.join(shots, "menu.png"), clip: { x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 } });
await page.keyboard.press("Escape");

// The popup / options page.
const id = sw.url().split("/")[2];
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 380, height: 470 });
await popup.goto(`chrome-extension://${id}/popup/popup.html`);
await popup.waitForTimeout(300);
await popup.screenshot({ path: path.join(out, "popup.png") });
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });

// --- 2. composed images ---------------------------------------------------
const browser = await chromium.launch();
const pages = [
  // JPEG: these are gradient-heavy, which PNG palettes band and full PNGs bloat.
  { src: "banner.html", out: "banner.jpg", width: 1280, height: 420 },
  { src: "demo.html", out: "demo.jpg", width: 1280, height: 880 },
];
for (const p of pages) {
  const pg = await browser.newPage({ viewport: { width: p.width, height: p.height }, deviceScaleFactor: 2 });
  await pg.goto("file://" + path.join(here, p.src));
  await pg.waitForLoadState("networkidle");
  await pg.screenshot({ path: path.join(out, p.out), type: "jpeg", quality: 88 });
  await pg.close();
  console.log("wrote", p.out);
}
await browser.close();
fs.rmSync(shots, { recursive: true, force: true });
console.log("wrote popup.png");
