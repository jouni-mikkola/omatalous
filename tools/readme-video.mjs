// @ts-check
/**
 * `pnpm readme:video`: remakes the animated picture at the top of the README (docs/images/omatalous.png, an APNG) and the
 * still picture for readers who ask for reduced motion (docs/images/omatalous-still.png). The scenes are real pages of the built app
 * with the example household, in English, taken by `tools/shots.mjs` with this file as the `--steps` module, which adds a
 * caption bar. Nothing is mocked. No video tool is needed: the frames are put in one 256-colour palette and written as an APNG here.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { shotName } from "./shots.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
export const IMAGES = join(ROOT, "docs/images");
export const FILES = { video: "omatalous.png", still: "omatalous-still.png" };
/** The video is under this many bytes, so the README holds it. */
export const MAX_BYTES = 1_000_000;
const WIDTH = 960;
const HEIGHT = 600;
const LABEL = "video";

/**
 * The scenes, in the order they play: the page id of `pnpm shots`, the heading of the section at the top of the picture (if any),
 * the caption and how long it stays.
 * @typedef {{ route: string, at?: string, caption: string, ms: number }} Scene
 */
/** @type {Scene[]} */
export const SCENES = [
  { route: "overview", at: "Month", caption: "Omatalous reads your bank accounts and shows where the money goes.", ms: 3200 },
  { route: "overview", at: "Assets and debts", caption: "Net assets, debts and how many months the buffer lasts.", ms: 2600 },
  { route: "transactions", caption: "Every transaction is listed and sorted into a category.", ms: 2800 },
  { route: "reports", caption: "Reports answer six questions: spending, income, fixed costs, debts and more.", ms: 2800 },
  { route: "review", caption: "What it cannot settle itself, it asks you, one question at a time.", ms: 3200 },
];

const sceneLabel = (/** @type {Scene} */ _s, /** @type {number} */ i) => `${LABEL}${i}`;

/** The step of `shots.mjs`: English, the size of the video, and the caption bar over the bottom of the page. */
export default async function step(/** @type {import("@playwright/test").Page} */ page) {
  const scene = /** @type {Scene} */ (SCENES[Number(process.env.VIDEO_SCENE)]);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  const set = await page.evaluate(async () => {
    const r = await fetch("/api/language", { method: "PUT", headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" }, body: JSON.stringify({ language: "en" }) });
    return r.ok;
  });
  if (!set) throw new Error("the language was not set");
  await page.reload();
  await page.getByRole("main").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  let scroll = 0;
  if (scene.at) {
    const heading = page.getByRole("heading", { name: scene.at, exact: true }).first();
    await heading.waitFor({ state: "visible", timeout: 30_000 });
    scroll = await heading.evaluate((h) => Math.max(0, Math.round((h.closest("section") ?? h).getBoundingClientRect().top + window.scrollY - 8)));
  }
  await page.evaluate(
    ({ h, y, text }) => {
      // one box of the video's height holds the page, scrolled to y, and the frame around it holds the caption bar under it, so no caption hides a part of the page. The CSS object model, since the
      // page's policy allows no style attribute in the markup.
      const hide = document.createElement("style");
      hide.textContent = "html, body { overflow: hidden !important; height: auto !important; min-height: 0 !important; } body { padding-bottom: 0 !important; }";
      document.head.append(hide);
      const box = document.createElement("div");
      box.style.cssText = `height: ${h - 54}px; overflow: hidden`;
      box.append(...Array.from(document.body.childNodes));
      const frame = document.createElement("div");
      frame.style.cssText = `height: ${h}px; overflow: hidden; position: relative`;
      frame.append(box);
      document.body.append(frame);
      box.scrollTop = y;
      const bar = document.createElement("div");
      bar.textContent = text;
      bar.style.cssText = "position: absolute; left: 0; right: 0; bottom: 0; height: 54px; box-sizing: border-box; padding: 14px 24px; background: #0f2a43; color: #fff; font: 600 20px/1.3 system-ui, sans-serif; z-index: 100000";
      frame.append(bar);
    },
    { h: HEIGHT, y: scroll, text: scene.caption },
  );
}

/** Pixels (RGBA, row after row) of a PNG that Playwright wrote: 8 bits, no interlace. */
export function decodePng(/** @type {Buffer} */ png) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  /** @type {Buffer[]} */
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("latin1", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const colour = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (colour !== 2 && colour !== 6)) throw new Error("only 8-bit RGB or RGBA PNGs without interlace");
      channels = colour === 2 ? 3 : 4;
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4, 255);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? /** @type {number} */ (line[i - channels]) : 0;
      const b = /** @type {number} */ (prev[i]);
      const c = i >= channels ? /** @type {number} */ (prev[i - channels]) : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (/** @type {number} */ (line[i]) + add) & 255;
    }
    for (let x = 0; x < width; x++) for (let k = 0; k < channels; k++) out[(y * width + x) * 4 + k] = /** @type {number} */ (line[x * channels + k]);
    prev = line;
  }
  return { width, height, rgba: out };
}

/** One palette of at most 256 colours for all frames: the commonest colours at 5 bits a channel, each at its bucket's mean. */
export function makePalette(/** @type {Buffer[]} */ frames) {
  /** @type {Map<number, { n: number, r: number, g: number, b: number }>} */
  const buckets = new Map();
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4) {
      const r = /** @type {number} */ (f[i]);
      const g = /** @type {number} */ (f[i + 1]);
      const b = /** @type {number} */ (f[i + 2]);
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
      buckets.set(key, e);
    }
  }
  return [...buckets.values()]
    .sort((x, y) => y.n - x.n)
    .slice(0, 256)
    .map((e) => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)]);
}

/** The index of the palette entry nearest each pixel. */
export function indexFrame(/** @type {Buffer} */ rgba, /** @type {number[][]} */ palette) {
  const out = Buffer.alloc(rgba.length / 4);
  /** @type {Map<number, number>} */
  const seen = new Map();
  for (let p = 0; p < out.length; p++) {
    const r = /** @type {number} */ (rgba[p * 4]);
    const g = /** @type {number} */ (rgba[p * 4 + 1]);
    const b = /** @type {number} */ (rgba[p * 4 + 2]);
    const key = (r << 16) | (g << 8) | b;
    let at = seen.get(key);
    if (at === undefined) {
      let best = Infinity;
      at = 0;
      palette.forEach((c, i) => {
        const d = (r - /** @type {number} */ (c[0])) ** 2 + (g - /** @type {number} */ (c[1])) ** 2 + (b - /** @type {number} */ (c[2])) ** 2;
        if (d < best) {
          best = d;
          at = i;
        }
      });
      seen.set(key, at);
    }
    out[p] = at;
  }
  return out;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc(/** @type {Buffer} */ buf) {
  let c = -1;
  for (const byte of buf) c = /** @type {number} */ (CRC[(c ^ byte) & 255]) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(/** @type {string} */ type, /** @type {Buffer} */ data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** The scanlines of an indexed image, each with the filter (none, sub or up) whose bytes add up smallest, deflated. */
function compress(/** @type {Buffer} */ index, /** @type {number} */ width, /** @type {number} */ height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = index.subarray(y * width, (y + 1) * width);
    const above = y ? index.subarray((y - 1) * width, y * width) : Buffer.alloc(width);
    const sub = Buffer.from(row.map((v, x) => (v - (x ? /** @type {number} */ (row[x - 1]) : 0)) & 255));
    const up = Buffer.from(row.map((v, x) => (v - /** @type {number} */ (above[x])) & 255));
    const cost = (/** @type {Buffer} */ b) => b.reduce((s, v) => s + (v < 128 ? v : 256 - v), 0);
    const options = [Buffer.from(row), sub, up];
    const costs = options.map(cost);
    const best = costs.indexOf(Math.min(...costs));
    rows.push(Buffer.from([best]), /** @type {Buffer} */ (options[best]));
  }
  return deflateSync(Buffer.concat(rows), { level: 9 });
}

/** An APNG of indexed frames of one size that plays once through and repeats, each frame shown for its own milliseconds. */
export function writeApng(/** @type {Buffer[]} */ indexed, /** @type {number[][]} */ palette, /** @type {number[]} */ ms, /** @type {number} */ width, /** @type {number} */ height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(indexed.length, 0);
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("PLTE", Buffer.from(palette.flat())), chunk("acTL", actl)];
  let sequence = 0;
  indexed.forEach((frame, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(sequence++, 0);
    fctl.writeUInt32BE(width, 4);
    fctl.writeUInt32BE(height, 8);
    fctl.writeUInt16BE(ms[i] ?? 1000, 20);
    fctl.writeUInt16BE(1000, 22);
    parts.push(chunk("fcTL", fctl));
    const data = compress(frame, width, height);
    if (i === 0) parts.push(chunk("IDAT", data));
    else {
      const seq = Buffer.alloc(4);
      seq.writeUInt32BE(sequence++, 0);
      parts.push(chunk("fdAT", Buffer.concat([seq, data])));
    }
  });
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function main() {
  const work = mkdtempSync(join(tmpdir(), "readme-video-"));
  try {
    // each scene is its own start of the app: the step reads which scene it is from the environment
    SCENES.forEach((scene, i) => {
      const run = spawnSync(
        process.execPath,
        [join(ROOT, "tools/shots.mjs"), scene.route, "--demo", "--widths", String(WIDTH), "--name", sceneLabel(scene, i), "--steps", fileURLToPath(import.meta.url)],
        { cwd: ROOT, stdio: "inherit", env: { ...process.env, SHOTS_DIR: work, SHOTS_DISPLAY_NAME: "Matti", VIDEO_SCENE: String(i) } },
      );
      if (run.status !== 0) throw new Error(`tools/shots.mjs exited with ${run.status}`);
    });
    const pngs = SCENES.map((s, i) => readFileSync(join(work, shotName(s.route, sceneLabel(s, i), WIDTH))));
    const frames = pngs.map((p) => decodePng(p));
    for (const f of frames) if (f.width !== WIDTH || f.height !== HEIGHT) throw new Error(`a frame is ${f.width} x ${f.height}, not ${WIDTH} x ${HEIGHT}`);
    const palette = makePalette(frames.map((f) => f.rgba));
    const indexed = frames.map((f) => indexFrame(f.rgba, palette));
    const apng = writeApng(indexed, palette, SCENES.map((s) => s.ms), WIDTH, HEIGHT);
    if (apng.length > MAX_BYTES) throw new Error(`the video is ${Math.round(apng.length / 1000)} kB, over the ${MAX_BYTES / 1000} kB cap`);
    mkdirSync(IMAGES, { recursive: true });
    writeFileSync(join(IMAGES, FILES.video), apng);
    // the still is the first scene as it was taken: what the video shows first, with no motion
    writeFileSync(join(IMAGES, FILES.still), /** @type {Buffer} */ (pngs[0]));
    console.log(`readme:video: docs/images/${FILES.video} ${Math.round(apng.length / 1000)} kB, ${FILES.still} ${Math.round(statSync(join(IMAGES, FILES.still)).size / 1000)} kB`);
  } finally {
    if (!process.env.VIDEO_KEEP) rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`readme:video: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
