// End-to-end test: loads the unpacked extension in Chromium and drives it on
// a stand-in claude.ai sidebar (tests/fixtures/sidebar.html).
// Run: node tests/e2e.mjs   (needs Playwright: npm i playwright && npx playwright install chromium)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH ?? "").split(":")] }));

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(root, "extension");
const fixture = fs.readFileSync(path.join(root, "tests/fixtures/sidebar.html"), "utf8");
const withScript = (js) => fixture.replace("</body>", `<script>${js}</script></body>`);

// Variant: links are not natively draggable and the page swallows every
// native drag event (what broke drag and drop on the real site).
const HOSTILE = withScript(`
  const off = () => document.querySelectorAll('nav a').forEach((a) => (a.draggable = false));
  off(); new MutationObserver(off).observe(document.body, { subtree: true, childList: true });
  for (const t of ['dragenter', 'dragover', 'drop']) window.addEventListener(t, (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
`);
// Variant: chat rows are buttons without an href; the URL only lives in JS.
const NO_LINKS = withScript(`
  for (const a of [...document.querySelectorAll('nav li a')]) {
    const row = document.createElement('div');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.style.cssText = 'display:flex;padding:7px 10px;color:#e8e6e3;cursor:pointer';
    row.innerHTML = '<span></span>';
    row.firstChild.textContent = a.textContent;
    const href = a.getAttribute('href');
    row.addEventListener('click', () => { history.pushState({}, '', href); syncActive(); });
    a.replaceWith(row);
  }
`);

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

async function withBrowser(html, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-e2e-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let body = html;
  await ctx.route("https://claude.ai/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body }));
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const sh = (sel, o) => page.locator("#claude-folders-root").locator(sel, o);
  const menu = (sel) => page.locator("#claude-folders-menu").locator(sel);
  const state = () =>
    page.evaluate(() => {
      const host = document.getElementById("claude-folders-root");
      return {
        url: location.pathname,
        mode: host?.dataset.mode,
        before: host?.nextElementSibling?.querySelector(".h span")?.textContent,
        hidden: [...document.querySelectorAll("[data-cf-hidden]")].map((e) => e.textContent.trim()),
        folders: [...(host?.shadowRoot.querySelectorAll(".cf-folder-row .cf-name") ?? [])].map((e) => e.textContent),
        items: [...(host?.shadowRoot.querySelectorAll(".cf-item") ?? [])].map((e) => e.textContent.trim()),
        pending: host?.shadowRoot.querySelector(".cf-pending")?.textContent.trim() ?? null,
      };
    });
  // A human-style drag: press, move a little, move to the target, release.
  const drag = async (src, dst, dy = 0) => {
    const a = await src.boundingBox();
    const b = await dst.boundingBox();
    await page.mouse.move(a.x + 30, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + a.height / 2 + 8, { steps: 4 });
    await page.mouse.move(b.x + 60, b.y + b.height / 2 + dy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  };
  const newFolder = async (name, parentRow) => {
    if (parentRow) {
      await parentRow.hover();
      await parentRow.locator('[data-action="folder-menu"]').click();
      await menu('[data-action="new-subfolder"]').click();
    } else {
      await sh('[data-action="new-folder"]').click();
    }
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
  };
  try {
    await fn({ ctx, page, sh, menu, state, drag, newFolder, setHtml: (h) => (body = h) });
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  eq(errors, [], "no page errors");
}

// --- main flow -------------------------------------------------------------
await withBrowser(fixture, async ({ ctx, page, sh, menu, state, drag, newFolder, setHtml }) => {
  await page.goto("https://claude.ai/code/session_s2");
  await page.waitForSelector("#claude-folders-root");
  let s = await state();
  eq([s.mode, s.before], ["inline", "Pinned"], "mounts in the sidebar above Pinned");

  await newFolder("Work");
  await drag(page.locator("nav a", { hasText: "Fix flaky CI" }), sh(".cf-folder-row"));
  await drag(page.locator("nav a", { hasText: "Refactor auth" }), sh(".cf-folder-row"));
  s = await state();
  eq(s.items, ["Fix flaky CI tests", "Refactor auth middleware"], "chats dragged into the folder");
  eq(s.hidden.sort(), ["Fix flaky CI tests", "Refactor auth middleware"], "filed chats hidden from Recents");
  eq(s.url, "/code/session_s2", "dropping does not open the dragged chat");
  eq(await page.evaluate(() => getSelection().toString()), "", "dragging selects no text");

  // Nav links are not chats.
  await drag(page.locator("nav a", { hasText: "Projects" }), sh(".cf-folder-row"));
  eq((await state()).items.length, 2, "nav links cannot be filed");

  // Subfolder, color, nesting by drag.
  const work = sh(".cf-folder-row", { hasText: "Work" });
  await newFolder("Backend", work);
  await work.hover();
  await work.locator('[data-action="folder-menu"]').click();
  await menu('[data-action="set-color"][data-color="#4f97d9"]').click();
  ok((await work.getAttribute("style")).includes("#4f97d9"), "folder color applied");
  await page.keyboard.press("Escape");
  await newFolder("Ideas");
  await drag(sh(".cf-folder-row", { hasText: "Ideas" }), sh(".cf-folder-row", { hasText: "Work" }));
  await drag(sh("a.cf-item", { hasText: "Refactor auth" }), sh(".cf-folder-row", { hasText: "Backend" }));
  s = await state();
  eq(s.folders, ["Work", "Backend", "Ideas"], "Ideas nested under Work");
  eq(s.items, ["Refactor auth middleware", "Fix flaky CI tests"], "chat moved into the subfolder");

  // New chat in folder is filed automatically.
  const ideas = sh(".cf-folder-row", { hasText: "Ideas" });
  await ideas.hover();
  await ideas.locator('[data-action="new-chat-in"]').click();
  await page.waitForTimeout(600);
  eq((await state()).url, "/code", "opens a new chat");
  ok((await state()).pending?.includes("Ideas"), "shows where the next chat goes");
  await page.evaluate(() => window.createChat("n1", "Brand new idea"));
  await page.waitForTimeout(1200);
  s = await state();
  ok(s.items.includes("Brand new idea") && s.pending === null, "new chat filed into Ideas");

  // Search.
  await sh('[data-action="toggle-search"]').click();
  await page.keyboard.type("flaky");
  await page.waitForTimeout(200);
  eq((await state()).items, ["Fix flaky CI tests"], "search filters chats");
  await page.keyboard.press("Escape");

  // Clicking a chat in a folder navigates inside the app.
  await sh("a.cf-item", { hasText: "Fix flaky CI" }).click();
  await page.waitForTimeout(400);
  eq(await page.locator("#title").textContent(), "Fix flaky CI tests", "item click navigates");

  // Remove from folder brings it back to Recents.
  const item = sh("a.cf-item", { hasText: "Fix flaky CI" });
  await item.hover();
  await item.locator('[data-action="remove-item"]').click();
  await page.waitForTimeout(400);
  ok(!(await state()).hidden.includes("Fix flaky CI tests"), "removed chat is back in Recents");

  // Right-click "Add to folder" path (background -> content script).
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get("claudeFolders")).claudeFolders);
  const workId = stored.folders.find((f) => f.name === "Work").id;
  await sw.evaluate(async (folderId) => {
    const [tab] = await chrome.tabs.query({ active: true });
    await chrome.tabs.sendMessage(tab.id, { type: "cf-add-link", folderId, url: "https://claude.ai/code/session_s4" });
  }, workId);
  await page.waitForTimeout(500);
  ok((await state()).items.includes("Postgres migration plan"), "right-click Add to folder");

  // Persists across reloads.
  const before = await state();
  await page.reload();
  await page.waitForSelector("#claude-folders-root");
  await page.waitForTimeout(800);
  eq((await state()).folders, before.folders, "folders persist after reload");

  // Chats have their own folders.
  await page.goto("https://claude.ai/chat/3f2a9c1e-0000-4000-8000-0000000000s1");
  await page.waitForTimeout(1000);
  s = await state();
  eq([s.before, s.folders], ["Starred", []], "chat sidebar has a separate tree");

  // Popup.
  const id = sw.url().split("/")[2];
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForTimeout(400);
  ok((await popup.locator("#stats").textContent()).includes("3 Code folders"), "popup shows stats");
  await popup.close();

  // Floating fallback when no sidebar can be found.
  setHtml("<html><body><main>No sidebar here</main></body></html>");
  await page.goto("https://claude.ai/code/session_s1");
  await page.waitForFunction(() => document.getElementById("claude-folders-root")?.dataset.mode === "floating", null, { timeout: 8000 });
  await sh(".cf-fab").click();
  ok(await sh(".cf-panel").isVisible(), "floating panel opens");
});

// --- page swallows native drag events -------------------------------------
await withBrowser(HOSTILE, async ({ page, sh, state, drag, newFolder }) => {
  await page.goto("https://claude.ai/code/session_s2");
  await page.waitForSelector("#claude-folders-root");
  await newFolder("AI cup");
  await drag(page.locator("nav a", { hasText: "Postgres" }), sh(".cf-folder-row"));
  await drag(page.locator("nav a", { hasText: "Team onboarding" }), sh("a.cf-item"));
  const s = await state();
  eq(s.items, ["Team onboarding guide", "Postgres migration plan"], "drag works when native DnD is blocked");
  eq(s.url, "/code/session_s2", "no accidental navigation");
});

// --- rows without links ----------------------------------------------------
await withBrowser(NO_LINKS, async ({ page, sh, state, drag, newFolder }) => {
  await page.goto("https://claude.ai/code/session_s2");
  await page.waitForSelector("#claude-folders-root");
  await newFolder("AI cup");
  await drag(page.locator('nav [role="button"]', { hasText: "Postgres" }), sh(".cf-folder-row"));
  await page.waitForTimeout(400);
  let s = await state();
  eq([s.url, s.items], ["/code/session_s4", ["Postgres migration plan"]], "link-less row opened and filed");
  ok(s.hidden.includes("Postgres migration plan"), "link-less row hidden from Recents by title");
  await drag(page.locator('nav [role="button"]', { hasText: "Fix flaky" }), sh(".cf-folder-row"));
  await page.waitForTimeout(400);
  await sh("a.cf-item", { hasText: "Postgres" }).click();
  await page.waitForTimeout(400);
  eq((await state()).url, "/code/session_s4", "item click navigates via the row");
});

console.log(`e2e: ${checks} checks passed`);
