// @ts-check
/**
 * `pnpm docs:shots`: remakes the pictures of the README in docs/images/ from the built app, with the example household. They are one
 * set: the same household, the same window (1440 x 900, and one phone at 390 x 844) and the same crop: the top of the page, one
 * window of it, or the whole page without its footer when the page is shorter than the window.
 * It runs `tools/shots.mjs` for each household and screen width (the demo household, or the fake bank alone), with this file as the
 * `--steps` module: the step sets the screen to the size of the picture and clips the page to it, so each picture is the viewport and
 * not the whole page. Scale 1, animations run to their end, the pointer at the corner: all of it is shots.mjs's own.
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
 * `pnpm shots`, the screen it is taken at, the heading at the top of the picture and the account the list is filtered to, if any.
 * @typedef {{ file: string, household: string, route: string, width: number, height: number, at?: string, account?: string }} Picture
 */
/** @type {Picture[]} */
export const PICTURES = [
  { file: "overview.png", household: "demo", route: "overview", width: 1440, height: 900 },
  { file: "bills.png", household: "demo", route: "bills", width: 1440, height: 900 },
  { file: "transactions.png", household: "demo", route: "transactions", width: 1440, height: 900 },
  { file: "reports.png", household: "demo", route: "reports", width: 1440, height: 900 },
  { file: "review.png", household: "demo", route: "review", width: 1440, height: 900 },
  { file: "overview-phone.png", household: "demo", route: "overview", width: 390, height: 844 },
];
/** No picture is larger than this many bytes. */
export const MAX_BYTES = 300_000;

/** One start of the app makes the pictures of one household, width and heading: the label keeps their file names apart. */
function group(/** @type {Picture} */ p) {
  return [p.household, p.width, p.at ?? "", p.account ?? ""].join("|");
}
function label(/** @type {Picture} */ p) {
  return [LABEL, p.at?.toLowerCase()].filter(Boolean).join("-");
}

/** The step of `shots.mjs`: the screen is the picture's size, and the page is put in a box of that height. */
export default async function step(/** @type {import("@playwright/test").Page} */ page) {
  const width = page.viewportSize()?.width ?? 1280;
  const height = width < 600 ? 844 : 900;
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
  }
  const end = await page.evaluate(
    ({ h, y }) => {
      // the picture is the page's own height: the body holds one box of the screen's height with the page in it, scrolled to y. A bar
      // fixed to the screen is held to the box instead, so readyForPicture finds none and makes no room under the page for it.
      const fixed = Array.from(document.body.querySelectorAll("*")).filter((e) => getComputedStyle(e).position === "fixed");
      for (const e of fixed) /** @type {HTMLElement} */ (e).style.position = "absolute";
      const style = document.createElement("style");
      style.textContent = "html, body { overflow: hidden !important; height: auto !important; min-height: 0 !important; } body { padding-bottom: 0 !important; }";
      document.head.append(style);
      const box = document.createElement("div");
      box.style.cssText = "overflow: hidden; position: relative";
      box.append(...Array.from(document.body.childNodes));
      document.body.append(box);
      // a page shorter than the window ends 32 px under its last row: no footer and no empty band under it
      const footer = /** @type {HTMLElement | null} */ (box.querySelector("footer"));
      const main = box.querySelector("main");
      let end = h;
      if (footer && main && y === 0) {
        const last = Array.from(main.querySelectorAll("*")).reduce((low, e) => Math.max(low, e.getBoundingClientRect().bottom), 0);
        const short = Math.ceil(last + window.scrollY) + 32;
        if (short < h) {
          footer.style.display = "none";
          end = short;
        }
      }
      box.style.height = `${end}px`;
      box.scrollTop = y;
      return end;
    },
    { h: height, y: scroll },
  );
  // the picture of a whole page is never shorter than the window, so the window follows the box
  if (end < height) await page.setViewportSize({ width, height: end });
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
        [join(ROOT, "tools/shots.mjs"), ...routes, first.household === "demo" ? "--demo" : "--fake-bank", "--widths", String(first.width), "--name", label(first), "--steps", fileURLToPath(import.meta.url)],
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
