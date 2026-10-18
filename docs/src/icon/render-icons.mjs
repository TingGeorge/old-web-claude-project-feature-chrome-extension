// Renders the extension icons from the SVGs: node docs/src/icon/render-icons.mjs
// Needs Playwright (npm i -g playwright) and a Chromium build.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH ?? "").split(":")] }));

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "..", "..", "extension", "icons");
// 16px gets its own simplified drawing; the detailed one turns to mush that small.
const sizes = [
  { size: 16, svg: "icon-16.svg" },
  { size: 32, svg: "icon.svg" },
  { size: 48, svg: "icon.svg" },
  { size: 128, svg: "icon.svg" },
];

const browser = await chromium.launch();
for (const { size, svg } of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const markup = fs.readFileSync(path.join(here, svg), "utf8");
  await page.setContent(
    `<html><body style="margin:0;background:transparent">` +
      markup.replace("<svg ", `<svg width="${size}" height="${size}" `) +
      `</body></html>`
  );
  await page.screenshot({ path: path.join(out, `icon${size}.png`), omitBackground: true });
  await page.close();
  console.log("wrote", `icon${size}.png`);
}
await browser.close();
