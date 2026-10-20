// @ts-check
/**
 * `pnpm shots:diff <before> <after> [--threshold share] [--tolerance share] [--out dir]`: the visual regression check.
 * Compares every PNG of a folder of `pnpm shots` pictures with the picture of the same name in another, pixel by pixel,
 * and fails when one changed in more than `--threshold` of its pixels (default 0.2 %), or changed size, or is missing.
 * A pixel is changed when a channel moved by more than `--tolerance` of its range (default 0.1), so antialiasing that
 * moves by a shade passes and a moved line or a new colour does not. Each failing picture gets a diff picture in
 * `--out` (default `<after>/diff`): changed pixels red over a faint copy of the before. The PNGs are decoded in the
 * Playwright Chromium the shots already need, so the check adds no dependency. `tools/visual-check.sh` takes both sets
 * of pictures (a base commit and the working tree) and runs this.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = { threshold: 0.002, tolerance: 0.1 };

const USAGE = `pnpm shots:diff <before> <after> [--threshold share] [--tolerance share] [--out dir]

  <before>, <after>  folders of PNGs from pnpm shots (SHOTS_DIR), compared by file name
  --threshold s      share of a picture's pixels that may change, 0 to 1 (default ${DEFAULTS.threshold}: 0.2 %)
  --tolerance s      how far a channel may move before its pixel counts as changed, 0 to 1 (default ${DEFAULTS.tolerance})
  --out dir          where the diff pictures go (default <after>/diff)

Exit 1 when a picture changed over the threshold, changed size or is missing from <after>; a picture only <after> has is listed and passes.`;

/**
 * @param {string[]} argv
 * @returns {{ help: boolean; before: string; after: string; threshold: number; tolerance: number; out: string | null }}
 */
export function parseDiffArgs(argv) {
  const o = { help: false, before: "", after: "", threshold: DEFAULTS.threshold, tolerance: DEFAULTS.tolerance, out: /** @type {string | null} */ (null) };
  const dirs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    const share = (/** @type {string} */ flag) => {
      const v = Number(argv[++i]);
      if (!(v >= 0 && v <= 1)) throw new Error(`${flag} takes a share from 0 to 1 (got: ${argv[i]})`);
      return v;
    };
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--threshold") o.threshold = share(a);
    else if (a === "--tolerance") o.tolerance = share(a);
    else if (a === "--out") o.out = argv[++i] ?? "";
    else if (a.startsWith("-")) throw new Error(`unknown option ${a} (pnpm shots:diff --help)`);
    else dirs.push(a);
  }
  if (!o.help && dirs.length !== 2) throw new Error("give two folders: the pictures before and after");
  [o.before = "", o.after = ""] = dirs;
  return o;
}

/**
 * The pixels of two pictures of one size that differ: a pixel is changed when any of its four channels moved by more
 * than `tolerance` of 255. `mask` holds 1 for each changed pixel. Self-contained: it also runs inside the browser page.
 * @param {ArrayLike<number>} a RGBA
 * @param {ArrayLike<number>} b RGBA, the same length
 * @param {number} tolerance
 */
export function diffPixels(a, b, tolerance) {
  const limit = tolerance * 255;
  const n = a.length / 4;
  const mask = new Uint8Array(n);
  let changed = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    let moved = false;
    for (let c = 0; c < 4 && !moved; c++) moved = Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0)) > limit;
    if (moved) {
      mask[p] = 1;
      changed++;
    }
  }
  return { changed, total: n, mask };
}

/**
 * @typedef {{ file: string; kind: "same" | "changed" | "size" | "missing" | "new"; share?: number; size?: string }} Result
 */

/**
 * The lines of the report and whether the check passes. Over the threshold, a new size and a missing picture fail.
 * @param {Result[]} results
 * @param {number} threshold
 */
export function verdict(results, threshold) {
  const lines = [];
  let bad = 0;
  for (const r of results) {
    if (r.kind === "changed" && (r.share ?? 0) > threshold) {
      bad++;
      lines.push(`CHANGED ${r.file}: ${((r.share ?? 0) * 100).toFixed(2)} % of the pixels`);
    } else if (r.kind === "size") {
      bad++;
      lines.push(`SIZE ${r.file}: ${r.size}`);
    } else if (r.kind === "missing") {
      bad++;
      lines.push(`MISSING ${r.file}: no picture of that name after`);
    } else if (r.kind === "new") lines.push(`new ${r.file}: no picture of that name before`);
  }
  const same = results.filter((r) => r.kind === "same" || (r.kind === "changed" && (r.share ?? 0) <= threshold)).length;
  lines.push(`shots:diff: ${same} of ${results.filter((r) => r.kind !== "new").length} pictures within ${(threshold * 100).toFixed(2)} %`);
  return { ok: bad === 0, lines };
}

/** The PNGs of a folder, by name. */
const pngs = (/** @type {string} */ dir) => readdirSync(dir).filter((f) => f.endsWith(".png")).sort();

async function main() {
  const o = parseDiffArgs(process.argv.slice(2));
  if (o.help) return console.log(USAGE);
  for (const d of [o.before, o.after]) if (!existsSync(d)) throw new Error(`no folder ${d}`);
  const out = o.out ?? join(o.after, "diff");
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
  /** @type {Result[]} */
  const results = [];
  try {
    const page = await browser.newPage();
    const before = pngs(o.before);
    const after = new Set(pngs(o.after));
    for (const file of before) {
      if (!after.has(file)) {
        results.push({ file, kind: "missing" });
        continue;
      }
      const url = (/** @type {string} */ dir) => `data:image/png;base64,${readFileSync(join(dir, file)).toString("base64")}`;
      const r = await page.evaluate(
        async ([src, a, b, tolerance]) => {
          const diff = new Function(`return (${src})`)();
          const pixels = async (/** @type {string} */ u) => {
            const img = new Image();
            img.src = u;
            await img.decode();
            const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
            const g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext("2d"));
            g.drawImage(img, 0, 0);
            return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
          };
          const [pa, pb] = [await pixels(a), await pixels(b)];
          if (pa.w !== pb.w || pa.h !== pb.h) return { size: `${pa.w}x${pa.h} before, ${pb.w}x${pb.h} after` };
          const d = diff(pa.data, pb.data, tolerance);
          if (!d.changed) return { share: 0 };
          // the picture of the change: red where a pixel moved, a faint grey copy of the before elsewhere
          const shown = new ImageData(pa.w, pa.h);
          for (let p = 0; p < d.total; p++) {
            const i = p * 4;
            const grey = ((pa.data[i] ?? 0) + (pa.data[i + 1] ?? 0) + (pa.data[i + 2] ?? 0)) / 3;
            const v = d.mask[p] ? [230, 0, 60, 255] : [grey, grey, grey, 60];
            shown.data.set(v, i);
          }
          const c = new OffscreenCanvas(pa.w, pa.h);
          /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext("2d")).putImageData(shown, 0, 0);
          const blob = await c.convertToBlob({ type: "image/png" });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return { share: d.changed / d.total, png: btoa(bin) };
        },
        /** @type {[string, string, string, number]} */ ([diffPixels.toString(), url(o.before), url(o.after), o.tolerance]),
      );
      if ("size" in r) results.push({ file, kind: "size", size: r.size });
      else {
        results.push({ file, kind: r.share ? "changed" : "same", share: r.share });
        if (r.png && r.share > o.threshold) {
          mkdirSync(out, { recursive: true });
          writeFileSync(join(out, file), Buffer.from(r.png, "base64"));
        }
      }
    }
    for (const file of after) if (!before.includes(file)) results.push({ file, kind: "new" });
  } finally {
    await browser.close();
  }
  const v = verdict(results, o.threshold);
  for (const l of v.lines) console.log(l);
  if (!v.ok) {
    console.log(`shots:diff: the diff pictures are in ${out}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`shots:diff: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  });
}
