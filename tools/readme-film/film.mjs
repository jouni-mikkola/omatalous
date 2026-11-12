// @ts-check
/**
 * `pnpm readme:film`: remakes the film at the top of the README (docs/images/tour.png, an animated PNG) and its still
 * (docs/images/tour-still.png, for a reader who asks for less motion). `tools/shots.mjs` starts the built app on an empty data
 * folder and runs ./steps.mjs, which clicks through the real app and saves a screenshot after each move; this file puts the
 * frames together (./compose.mjs) and writes the APNG (./png.mjs). No video tool is needed.
 * `pnpm readme:film --frames <dir>` writes each frame of the film in the README as a PNG of its own, with its time in
 * the name, to check it frame by frame.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stampPng } from "../privacy/png-stamp.mjs";
import { compose } from "./compose.mjs";
import { decodeApng, decodePng, encodeApng, encodePng } from "./png.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
export const IMAGES = join(ROOT, "docs/images");
export const FILES = { film: "tour.png", still: "tour-still.png" };
/** The film is under this many bytes, so the README opens without a long wait. */
export const MAX_BYTES = 5_000_000;
/** The film lasts this many seconds, at least and at most. */
export const SECONDS = { least: 20, most: 40 };

/** @typedef {import("./compose.mjs").Record} Record */

/** The frames of the film from what the steps saved, in the order they play. */
function frames(/** @type {Record[]} */ records) {
  /** @type {Map<string, import("./png.mjs").Rgb>} */
  const bars = new Map();
  return records.map((r) => {
    if (!bars.has(r.bar)) bars.set(r.bar, decodePng(readFileSync(r.bar)));
    const img = compose(r, decodePng(readFileSync(r.shot)), /** @type {import("./png.mjs").Rgb} */ (bars.get(r.bar)));
    return { ...img, ms: r.ms };
  });
}

function make() {
  const work = mkdtempSync(join(tmpdir(), "readme-film-"));
  try {
    // one start of the app: the computer's part first (it loads the example data), then the phone's
    const run = spawnSync(process.execPath, [join(ROOT, "tools/shots.mjs"), "overview", "--widths", "1000,390", "--name", "film", "--steps", fileURLToPath(new URL("./steps.mjs", import.meta.url))], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, SHOTS_DIR: join(work, "shots"), SHOTS_DISPLAY_NAME: "Matti", FILM_DIR: work },
    });
    if (run.status !== 0) throw new Error(`tools/shots.mjs exited with ${run.status}`);
    /** @type {Record[]} */
    const records = ["desk", "phone"].flatMap((part) => JSON.parse(readFileSync(join(work, `part-${part}.json`), "utf8")));
    const all = frames(records);
    const at = records.findIndex((r) => r.poster);
    if (at < 0) throw new Error("no frame is marked as the still");
    const poster = /** @type {import("./png.mjs").Frame} */ (all[at]);
    const seconds = all.reduce((s, f) => s + f.ms, 0) / 1000;
    if (seconds < SECONDS.least || seconds > SECONDS.most) throw new Error(`the film lasts ${seconds.toFixed(1)} s, not ${SECONDS.least} to ${SECONDS.most}`);
    // the stamp of `pnpm shots` (tools/privacy/png-stamp.mjs): the frames are of the app shots started, with the example household
    const film = stampPng(encodeApng(all, poster), "demo");
    if (film.length > MAX_BYTES) throw new Error(`the film is ${Math.round(film.length / 1000)} kB, over the ${MAX_BYTES / 1000} kB cap`);
    mkdirSync(IMAGES, { recursive: true });
    writeFileSync(join(IMAGES, FILES.film), film);
    const still = stampPng(encodePng(poster), "demo");
    writeFileSync(join(IMAGES, FILES.still), still);
    console.log(`readme:film: docs/images/${FILES.film} ${Math.round(film.length / 1000)} kB, ${seconds.toFixed(1)} s; docs/images/${FILES.still} ${Math.round(still.length / 1000)} kB`);
    console.log("readme:film: the captions, in order:");
    for (const caption of [...new Set(records.map((r) => r.caption))]) console.log(`  ${caption}`);
  } finally {
    if (!process.env.FILM_KEEP) rmSync(work, { recursive: true, force: true });
    else console.log(`readme:film: the screenshots are in ${work}`);
  }
}

/** Each frame of the film in the README to `dir`, named by its number and the time it starts. */
function extract(/** @type {string} */ dir) {
  const { frames: list, poster } = decodeApng(readFileSync(join(IMAGES, FILES.film)));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "poster.png"), encodePng(poster));
  let t = 0;
  list.forEach((f, i) => {
    writeFileSync(join(dir, `${String(i).padStart(4, "0")}-${(t / 1000).toFixed(2)}s.png`), encodePng(f));
    t += f.ms;
  });
  console.log(`readme:film: ${list.length} frames, ${(t / 1000).toFixed(1)} s, in ${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const at = process.argv.indexOf("--frames");
    if (at > 0) {
      const dir = process.argv[at + 1];
      if (!dir || dir.startsWith("-")) throw new Error("--frames takes a folder");
      extract(resolve(dir));
    } else make();
  } catch (err) {
    console.error(`readme:film: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
