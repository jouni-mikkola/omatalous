// @ts-check
/**
 * `pnpm docs:shots`: remakes the pictures of the README and the docs in docs/images/ from the built app, with the example household.
 * It runs `tools/shots.mjs` for each household and screen width (the demo household, or the fake bank alone), with this file as the
 * `--steps` module: the step sets the screen to the size of the picture and clips the page to it, so each picture is the viewport and
 * not the whole page. Light theme, scale 1, animations run to their end, the pointer at the corner: all of it is shots.mjs's own.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shotName } from "./shots.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
export const IMAGES = join(ROOT, "docs/images");
const LABEL = "docs";

/** The pictures: the file, the household it shows (the demo's, or the fake bank's alone: no account is there twice), the page id of `pnpm shots`, the screen it is taken at. */
export const PICTURES = [
  { file: "yhteenveto.png", household: "demo", route: "overview", width: 1280, height: 800 },
  { file: "tilit.png", household: "bank", route: "settings", width: 1280, height: 800 },
  { file: "raportit.png", household: "demo", route: "reports", width: 1280, height: 800 },
  { file: "tapahtumat.png", household: "demo", route: "transactions", width: 1280, height: 800 },
  { file: "yhteenveto-puhelin.png", household: "demo", route: "overview", width: 390, height: 844 },
];
/** No picture is larger than this many bytes. */
export const MAX_BYTES = 350_000;

/** The step of `shots.mjs`: the screen is the picture's size, and the page is put in a box of that height. */
export default async function step(/** @type {import("@playwright/test").Page} */ page, /** @type {string} */ route) {
  const width = page.viewportSize()?.width ?? 1280;
  const height = width < 600 ? 844 : 800;
  await page.setViewportSize({ width, height });
  let scroll = 0;
  if (route === "settings") {
    // the joint account's row, with the block of its months under it, at the top of the picture
    const heading = page.locator("#tilit").getByRole("heading", { name: "Maksut ja menot kuukausittain", exact: true });
    await heading.waitFor({ state: "visible", timeout: 30_000 });
    scroll = await heading.evaluate((h) => {
      const edit = h.closest("tr");
      const row = edit?.previousElementSibling ?? edit;
      // the row ends up at the top bar's lower edge (48 px) once the page sits in its box: measured, the box moves it 65 px up
      return Math.max(0, Math.round((row ?? h).getBoundingClientRect().top + window.scrollY - 113));
    });
  }
  await page.evaluate(
    ({ h, y }) => {
      // the picture is the page's own height: the body holds one box of the screen's height with the page in it, scrolled to y. The room
      // readyForPicture makes under a bar fixed to the screen's bottom is not wanted: the bar is inside the box.
      const style = document.createElement("style");
      style.textContent = "html, body { overflow: hidden !important; height: auto !important; min-height: 0 !important; } body { padding-bottom: 0 !important; }";
      document.head.append(style);
      const box = document.createElement("div");
      box.style.cssText = `height: ${h}px; overflow: hidden; position: relative`;
      box.append(...Array.from(document.body.childNodes));
      document.body.append(box);
      box.scrollTop = y;
    },
    { h: height, y: scroll },
  );
}

function main() {
  const work = mkdtempSync(join(tmpdir(), "docs-shots-"));
  try {
    // one start of the app for each household and screen width: a page that scrolls sideways at the phone's width, and is not a picture, would fail the run
    const groups = new Set(PICTURES.map((p) => `${p.household} ${p.width}`));
    for (const group of groups) {
      const [household, width] = group.split(" ");
      const here = PICTURES.filter((p) => `${p.household} ${p.width}` === group);
      const routes = [...new Set(here.map((p) => p.route))];
      const run = spawnSync(
        process.execPath,
        [join(ROOT, "tools/shots.mjs"), ...routes, household === "demo" ? "--demo" : "--fake-bank", "--look", "light", "--widths", String(width), "--name", LABEL, "--steps", fileURLToPath(import.meta.url)],
        { cwd: ROOT, stdio: "inherit", env: { ...process.env, SHOTS_DIR: work, SHOTS_DISPLAY_NAME: "Matti" } },
      );
      if (run.status !== 0) throw new Error(`tools/shots.mjs exited with ${run.status}`);
    }
    mkdirSync(IMAGES, { recursive: true });
    for (const p of PICTURES) {
      const from = join(work, shotName(p.route, LABEL, p.width));
      if (!existsSync(from)) throw new Error(`no picture for ${p.file}: ${from}`);
      const kb = Math.round(statSync(from).size / 1000);
      if (statSync(from).size > MAX_BYTES) throw new Error(`${p.file} is ${kb} kB, over the ${MAX_BYTES / 1000} kB cap`);
      copyFileSync(from, join(IMAGES, p.file));
      console.log(`docs:shots: docs/images/${p.file} ${kb} kB`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`docs:shots: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
