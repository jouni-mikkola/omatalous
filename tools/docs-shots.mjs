// @ts-check
/**
 * `pnpm docs:shots`: remakes the pictures of the README and the docs in docs/images/ from the built app, with the example household.
 * It runs `tools/shots.mjs` for each household and screen width (the demo household, or the fake bank alone), with this file as the
 * `--steps` module: the step sets the screen to the size of the picture and clips the page to it, so each picture is the viewport and
 * not the whole page. The light look unless a picture says night, scale 1, animations run to their end, the pointer at the corner: all of it is shots.mjs's own.
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

/**
 * The pictures: the file, the household it shows (the demo's, or the fake bank's alone: no account is there twice), the page id of
 * `pnpm shots`, the screen it is taken at, the look (light unless it says night), the heading at the top of the picture and the account the list is filtered to, if any.
 * @typedef {{ file: string, household: string, route: string, width: number, height: number, look?: string, at?: string, account?: string }} Picture
 */
/** @type {Picture[]} */
export const PICTURES = [
  { file: "yhteenveto.png", household: "demo", route: "overview", width: 1280, height: 800 },
  { file: "yhteenveto-yo.png", household: "demo", route: "overview", width: 1280, height: 800, look: "night" },
  { file: "varallisuus.png", household: "demo", route: "overview", width: 1280, height: 800, at: "Varallisuus" },
  { file: "tilit.png", household: "bank", route: "settings", width: 1280, height: 800 },
  { file: "raportit.png", household: "demo", route: "reports", width: 1280, height: 800 },
  { file: "tapahtumat.png", household: "demo", route: "transactions", width: 1280, height: 800, account: "Käyttötili (esimerkki)" },
  { file: "tarkistettavat.png", household: "demo", route: "review", width: 1280, height: 800 },
  { file: "yhteenveto-puhelin.png", household: "demo", route: "overview", width: 390, height: 844 },
];
/** No picture is larger than this many bytes. */
export const MAX_BYTES = 300_000;

/** One start of the app makes the pictures of one household, width, look and heading: the label keeps their file names apart. */
function group(/** @type {Picture} */ p) {
  return [p.household, p.width, p.look ?? "light", p.at ?? "", p.account ?? ""].join("|");
}
function label(/** @type {Picture} */ p) {
  return [LABEL, p.look, p.at?.toLowerCase()].filter(Boolean).join("-");
}

/** The step of `shots.mjs`: the screen is the picture's size, and the page is put in a box of that height. */
export default async function step(/** @type {import("@playwright/test").Page} */ page, /** @type {string} */ route) {
  const width = page.viewportSize()?.width ?? 1280;
  const height = width < 600 ? 844 : 800;
  await page.setViewportSize({ width, height });
  const account = process.env.DOCS_SHOTS_ACCOUNT;
  if (account) {
    // the checking account's rows: the card's are mostly shop names
    await page.getByRole("button", { name: "Tili", exact: false }).first().click();
    await page.getByRole("option", { name: account }).click();
    await page.getByRole("button", { name: new RegExp(`Tili.*${account.replace(/[()]/g, "\\$&")}`) }).waitFor({ state: "visible", timeout: 30_000 });
  }
  let scroll = 0;
  const at = process.env.DOCS_SHOTS_AT;
  if (at) {
    // the heading's section at the top of the picture, under the top bar
    const heading = page.getByRole("heading", { name: at, exact: true }).first();
    await heading.waitFor({ state: "visible", timeout: 30_000 });
    scroll = await heading.evaluate((h) => {
      const section = h.closest("section") ?? h;
      // 48 px of top bar and 16 of room above the section
      return Math.max(0, Math.round(section.getBoundingClientRect().top + window.scrollY - 64));
    });
  } else if (route === "settings") {
    // the joint account's row, with the block of its months under it, at the top of the picture
    const heading = page.locator("#tilit").getByRole("heading", { name: "Tilille tullut ja lähtenyt raha kuukausittain", exact: true });
    await heading.waitFor({ state: "visible", timeout: 30_000 });
    scroll = await heading.evaluate((h) => {
      // the account's own row stands above its rows of use, split and months
      /** @type {Element | null} */
      let row = h.closest("tr");
      while (row?.classList.contains("edit-row") && row.previousElementSibling) row = row.previousElementSibling;
      // 48 px of top bar and 16 of room above the row
      return Math.max(0, Math.round((row ?? h).getBoundingClientRect().top + window.scrollY - 64));
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
    /** @type {Map<string, Picture[]>} */
    const groups = new Map();
    for (const p of PICTURES) groups.set(group(p), [...(groups.get(group(p)) ?? []), p]);
    for (const here of groups.values()) {
      const first = /** @type {Picture} */ (here[0]);
      const routes = [...new Set(here.map((p) => p.route))];
      const run = spawnSync(
        process.execPath,
        [join(ROOT, "tools/shots.mjs"), ...routes, first.household === "demo" ? "--demo" : "--fake-bank", "--look", first.look ?? "light", "--widths", String(first.width), "--name", label(first), "--steps", fileURLToPath(import.meta.url)],
        { cwd: ROOT, stdio: "inherit", env: { ...process.env, SHOTS_DIR: work, SHOTS_DISPLAY_NAME: "Matti", DOCS_SHOTS_AT: first.at ?? "", DOCS_SHOTS_ACCOUNT: first.account ?? "" } },
      );
      if (run.status !== 0) throw new Error(`tools/shots.mjs exited with ${run.status}`);
    }
    mkdirSync(IMAGES, { recursive: true });
    for (const p of PICTURES) {
      const from = join(work, shotName(p.route, label(p), p.width));
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
