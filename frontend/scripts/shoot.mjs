// Screenshot harness for visual QA and documentation.
// Drives a locally installed Chrome/Edge (puppeteer-core, no browser download) against the running dev server.
//
//   node scripts/shoot.mjs <shots.json> <outDir> [--url http://localhost:3000] [--size 1600x900]
//
// shots.json: [{ "name": "twin_auh", "js": "<evaluated in the page before the shot>", "wait": 8000 }, ...]
// Each shot runs in the same page, in order, so later shots can build on earlier state.

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const shotsFile = args[0];
const outDir = args[1];
if (!shotsFile || !outDir) {
  console.error("usage: node scripts/shoot.mjs <shots.json> <outDir> [--url URL] [--size WxH]");
  process.exit(2);
}
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = opt("--url", "http://localhost:3000");
const [W, H] = opt("--size", "1600x900").split("x").map(Number);

const candidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const { existsSync } = await import("node:fs");
const executablePath = process.env.CHROME_PATH ?? candidates.find((p) => existsSync(p));
if (!executablePath) { console.error("no Chrome/Edge found; set CHROME_PATH"); process.exit(2); }

const shots = JSON.parse(await readFile(shotsFile, "utf8"));
await mkdir(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=default", "--enable-unsafe-swiftshader", `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  protocolTimeout: 600000, // a shot may run the scenario for minutes (agents solving in the page)
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => Boolean(window.skypact && window.skypactUi), { timeout: 120000 });
  for (const s of shots) {
    if (s.js) {
      const r = await page.evaluate(async (code) => { const fn = new Function(`return (async () => { ${code} })()`); return fn(); }, s.js);
      if (r !== undefined) console.log(`[${s.name}]`, JSON.stringify(r).slice(0, Number(process.env.SHOT_LOG ?? 400)));
    }
    await new Promise((res) => setTimeout(res, s.wait ?? 3000));
    const file = path.join(outDir, `${s.name}.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log("saved", file);
  }
} finally {
  await browser.close();
}
