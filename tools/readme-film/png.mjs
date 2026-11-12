// @ts-check
/**
 * The picture files of the README film, with no package and no video tool: PNG in (what Playwright writes), a still PNG out,
 * and an animated PNG (APNG) out and back in. The APNG has one palette for every frame. After the first frame, each frame
 * holds only the box of pixels that changed, and the pixels in that box that did not change are transparent, so a cursor
 * that moves costs a few hundred bytes and a held page costs nothing.
 */
import { deflateSync, inflateSync } from "node:zlib";

/** An RGB picture: three bytes a pixel, row after row. @typedef {{ width: number, height: number, rgb: Uint8Array }} Rgb */
/** A frame of the film and how long it shows. @typedef {Rgb & { ms: number }} Frame */

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc(/** @type {Uint8Array} */ buf) {
  let c = -1;
  for (const byte of buf) c = /** @type {number} */ (CRC[(c ^ byte) & 255]) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(/** @type {string} */ type, /** @type {Uint8Array} */ data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** The chunks of a PNG in order. @returns {{ type: string, data: Buffer }[]} */
function chunks(/** @type {Buffer} */ png) {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  const out = [];
  for (let at = 8; at + 12 <= png.length; ) {
    const len = png.readUInt32BE(at);
    out.push({ type: png.toString("latin1", at + 4, at + 8), data: png.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  return out;
}

function paeth(/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** The bytes of an image after PNG's row filters are undone: `bpp` bytes a pixel, `stride` bytes a row. */
function unfilter(/** @type {Buffer} */ raw, /** @type {number} */ height, /** @type {number} */ stride, /** @type {number} */ bpp) {
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? /** @type {number} */ (out[row + i - bpp]) : 0;
      const b = y ? /** @type {number} */ (out[row - stride + i]) : 0;
      const c = y && i >= bpp ? /** @type {number} */ (out[row - stride + i - bpp]) : 0;
      const x = /** @type {number} */ (raw[src + i]);
      out[row + i] = (x + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0)) & 255;
    }
  }
  return out;
}

/** The rows of an image with the filter each row compresses best under (the smallest sum of absolute bytes), deflated. */
function filterAndDeflate(/** @type {Uint8Array} */ pixels, /** @type {number} */ height, /** @type {number} */ stride, /** @type {number} */ bpp) {
  const out = Buffer.alloc(height * (stride + 1));
  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    let bestCost = Infinity;
    // a palette image keeps its rows as they are: its indexes are not quantities, and a difference of two says nothing
    for (const filter of bpp === 1 ? [0] : [0, 1, 2, 3, 4]) {
      let cost = 0;
      for (let i = 0; i < stride; i++) {
        const x = /** @type {number} */ (pixels[row + i]);
        const a = i >= bpp ? /** @type {number} */ (pixels[row + i - bpp]) : 0;
        const b = y ? /** @type {number} */ (pixels[row - stride + i]) : 0;
        const c = y && i >= bpp ? /** @type {number} */ (pixels[row - stride + i - bpp]) : 0;
        const v = (x - (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0)) & 255;
        trial[i] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        out[y * (stride + 1)] = filter;
        out.set(trial, y * (stride + 1) + 1);
      }
    }
  }
  return deflateSync(out, { level: 9, memLevel: 9 });
}

/** The RGB pixels of an 8-bit RGB or RGBA PNG without interlace (what Chromium writes); alpha is dropped. @returns {Rgb} */
export function decodePng(/** @type {Buffer} */ png) {
  const all = chunks(png);
  const ihdr = all.find((c) => c.type === "IHDR")?.data;
  if (!ihdr) throw new Error("a PNG without IHDR");
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const colour = ihdr[9];
  if (ihdr[8] !== 8 || ihdr[12] !== 0 || (colour !== 2 && colour !== 6)) throw new Error("only 8-bit RGB or RGBA PNGs without interlace");
  const channels = colour === 2 ? 3 : 4;
  const pixels = unfilter(inflateSync(Buffer.concat(all.filter((c) => c.type === "IDAT").map((c) => c.data))), height, width * channels, channels);
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    rgb[p * 3] = /** @type {number} */ (pixels[p * channels]);
    rgb[p * 3 + 1] = /** @type {number} */ (pixels[p * channels + 1]);
    rgb[p * 3 + 2] = /** @type {number} */ (pixels[p * channels + 2]);
  }
  return { width, height, rgb };
}

function ihdr(/** @type {number} */ width, /** @type {number} */ height, /** @type {number} */ colour) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = colour;
  return chunk("IHDR", data);
}

/** A still RGB PNG. */
export function encodePng(/** @type {Rgb} */ { width, height, rgb }) {
  return Buffer.concat([SIGNATURE, ihdr(width, height, 2), chunk("IDAT", filterAndDeflate(rgb, height, width * 3, 3)), chunk("IEND", new Uint8Array(0))]);
}

/** The weighted distance of two colours: green counts most and blue least, as the eye sees a difference. */
function distance(/** @type {number} */ r1, /** @type {number} */ g1, /** @type {number} */ b1, /** @type {number} */ r2, /** @type {number} */ g2, /** @type {number} */ b2) {
  return 3 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 2 * (b1 - b2) ** 2;
}

/**
 * One palette of at most `size` colours for all frames. The commonest exact colours are kept as they are (the page, the
 * text, the bars and the chips are flat colours), and the rest (the soft edges of letters and lines) are split by median
 * cut and then moved a few rounds towards the colours they stand for.
 * @param {Rgb[]} pictures
 * @returns {number[][]} [r, g, b] entries
 */
export function makePalette(pictures, size = 255, exact = 96) {
  const counts = new Uint32Array(1 << 24);
  for (const { rgb } of pictures) {
    for (let i = 0; i < rgb.length; i += 3) {
      const c = ((/** @type {number} */ (rgb[i]) << 16) | (/** @type {number} */ (rgb[i + 1]) << 8) | /** @type {number} */ (rgb[i + 2])) >>> 0;
      counts[c] = /** @type {number} */ (counts[c]) + 1;
    }
  }
  /** @type {number[]} */
  const colours = [];
  for (let c = 0; c < counts.length; c++) if (counts[c]) colours.push(c);
  const n = (/** @type {number} */ c) => /** @type {number} */ (counts[c]);
  colours.sort((a, b) => n(b) - n(a));
  if (colours.length <= size) return colours.map((c) => [c >> 16, (c >> 8) & 255, c & 255]);
  const kept = colours.slice(0, exact);
  const rest = colours.slice(exact);
  const channel = (/** @type {number} */ c, /** @type {number} */ k) => (c >> (16 - 8 * k)) & 255;
  // median cut of the rest: the box with the widest channel, weighted by how many pixels it holds, is split at its weighted median
  /** @type {number[][]} */
  let boxes = [rest];
  const spread = (/** @type {number[]} */ box) => {
    let best = { k: 0, range: -1 };
    for (let k = 0; k < 3; k++) {
      let lo = 255;
      let hi = 0;
      for (const c of box) {
        const v = channel(c, k);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > best.range) best = { k, range: hi - lo };
    }
    return best;
  };
  while (boxes.length < size - exact) {
    let pick = -1;
    let score = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const s = spread(box).range * Math.sqrt(box.reduce((sum, c) => sum + n(c), 0));
      if (s > score) {
        score = s;
        pick = i;
      }
    });
    if (pick < 0) break;
    const box = /** @type {number[]} */ (boxes[pick]);
    const { k } = spread(box);
    box.sort((a, b) => channel(a, k) - channel(b, k));
    const total = box.reduce((sum, c) => sum + n(c), 0);
    let at = 0;
    for (let acc = 0; at < box.length - 1 && acc + n(/** @type {number} */ (box[at])) < total / 2; at++) acc += n(/** @type {number} */ (box[at]));
    at = Math.min(Math.max(at, 1), box.length - 1);
    boxes = [...boxes.slice(0, pick), box.slice(0, at), box.slice(at), ...boxes.slice(pick + 1)];
  }
  const mean = (/** @type {number[]} */ box) => {
    const s = [0, 0, 0, 0];
    for (const c of box) {
      const w = n(c);
      s[0] = /** @type {number} */ (s[0]) + channel(c, 0) * w;
      s[1] = /** @type {number} */ (s[1]) + channel(c, 1) * w;
      s[2] = /** @type {number} */ (s[2]) + channel(c, 2) * w;
      s[3] = /** @type {number} */ (s[3]) + w;
    }
    return [0, 1, 2].map((k) => Math.round(/** @type {number} */ (s[k]) / /** @type {number} */ (s[3])));
  };
  const fixed = kept.map((c) => [channel(c, 0), channel(c, 1), channel(c, 2)]);
  let moving = boxes.filter((b) => b.length).map(mean);
  // a few rounds of k-means over the rest, with the kept colours standing still
  for (let round = 0; round < 4; round++) {
    const palette = [...fixed, ...moving];
    const sums = moving.map(() => [0, 0, 0, 0]);
    for (const c of rest) {
      const [r, g, b] = [channel(c, 0), channel(c, 1), channel(c, 2)];
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < palette.length; i++) {
        const p = /** @type {number[]} */ (palette[i]);
        const d = distance(r, g, b, /** @type {number} */ (p[0]), /** @type {number} */ (p[1]), /** @type {number} */ (p[2]));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < fixed.length) continue;
      const s = /** @type {number[]} */ (sums[best - fixed.length]);
      const w = n(c);
      s[0] = /** @type {number} */ (s[0]) + r * w;
      s[1] = /** @type {number} */ (s[1]) + g * w;
      s[2] = /** @type {number} */ (s[2]) + b * w;
      s[3] = /** @type {number} */ (s[3]) + w;
    }
    moving = moving.map((m, i) => {
      const s = /** @type {number[]} */ (sums[i]);
      return s[3] ? [0, 1, 2].map((k) => Math.round(/** @type {number} */ (s[k]) / /** @type {number} */ (s[3]))) : m;
    });
  }
  return [...fixed, ...moving];
}

/** Maps colours to the index of the nearest palette entry, remembering each colour it has seen. */
export function indexer(/** @type {number[][]} */ palette, offset = 0) {
  const seen = new Int16Array(1 << 24).fill(-1);
  return (/** @type {Uint8Array} */ rgb) => {
    const out = new Uint8Array(rgb.length / 3);
    for (let p = 0; p < out.length; p++) {
      const r = /** @type {number} */ (rgb[p * 3]);
      const g = /** @type {number} */ (rgb[p * 3 + 1]);
      const b = /** @type {number} */ (rgb[p * 3 + 2]);
      const key = (r << 16) | (g << 8) | b;
      let at = /** @type {number} */ (seen[key]);
      if (at < 0) {
        let bestD = Infinity;
        at = 0;
        for (let i = 0; i < palette.length; i++) {
          const c = /** @type {number[]} */ (palette[i]);
          const d = distance(r, g, b, /** @type {number} */ (c[0]), /** @type {number} */ (c[1]), /** @type {number} */ (c[2]));
          if (d < bestD) {
            bestD = d;
            at = i;
          }
        }
        at += offset;
        seen[key] = at;
      }
      out[p] = at;
    }
    return out;
  };
}

/** The box that holds every pixel where two index images differ, or null when they are the same. */
function changedBox(/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ b, /** @type {number} */ width, /** @type {number} */ height) {
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (a[y * width + x] === b[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * An APNG that loops for ever. `poster` is the image a viewer without APNG shows; it is not a frame. Every frame is
 * the size of the poster. Frames the same as the one before add their time to it.
 * @param {Frame[]} frames
 * @param {Rgb} poster
 */
export function encodeApng(frames, poster) {
  const { width, height } = poster;
  for (const f of frames) if (f.width !== width || f.height !== height) throw new Error(`a frame is ${f.width} x ${f.height}, the poster ${width} x ${height}`);
  const palette = makePalette([poster, ...frames]);
  // index 0 is transparent: the pixels of a frame's box that did not change
  const toIndex = indexer(palette, 1);
  const plte = Buffer.from([0, 0, 0, ...palette.flat()]);
  /** @type {{ index: Uint8Array, ms: number }[]} */
  const kept = [];
  for (const f of frames) {
    const index = toIndex(f.rgb);
    const last = kept[kept.length - 1];
    if (last && Buffer.from(last.index).equals(Buffer.from(index))) last.ms += f.ms;
    else kept.push({ index, ms: f.ms });
  }
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(kept.length, 0);
  const parts = [SIGNATURE, ihdr(width, height, 3), chunk("PLTE", plte), chunk("tRNS", Buffer.from([0])), chunk("acTL", actl)];
  parts.push(chunk("IDAT", filterAndDeflate(toIndex(poster.rgb), height, width, 1)));
  let sequence = 0;
  kept.forEach((frame, i) => {
    const before = kept[i - 1]?.index;
    const box = before ? (changedBox(before, frame.index, width, height) ?? { x: 0, y: 0, width: 1, height: 1 }) : { x: 0, y: 0, width, height };
    const pixels = new Uint8Array(box.width * box.height);
    for (let y = 0; y < box.height; y++) {
      for (let x = 0; x < box.width; x++) {
        const at = (box.y + y) * width + box.x + x;
        pixels[y * box.width + x] = before && before[at] === frame.index[at] ? 0 : /** @type {number} */ (frame.index[at]);
      }
    }
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(sequence++, 0);
    fctl.writeUInt32BE(box.width, 4);
    fctl.writeUInt32BE(box.height, 8);
    fctl.writeUInt32BE(box.x, 12);
    fctl.writeUInt32BE(box.y, 16);
    // the delay in milliseconds as a fraction of a second; dispose 0 (keep), blend 0 for the first frame (replace) and 1 after it (over)
    fctl.writeUInt16BE(Math.min(65535, Math.round(frame.ms)), 20);
    fctl.writeUInt16BE(1000, 22);
    fctl[24] = 0;
    fctl[25] = before ? 1 : 0;
    parts.push(chunk("fcTL", fctl));
    const seq = Buffer.alloc(4);
    seq.writeUInt32BE(sequence++, 0);
    parts.push(chunk("fdAT", Buffer.concat([seq, filterAndDeflate(pixels, box.height, box.width, 1)])));
  });
  parts.push(chunk("IEND", new Uint8Array(0)));
  return Buffer.concat(parts);
}

/**
 * The frames of an APNG as they show, each a whole RGB picture with its time, and the image a viewer without APNG shows.
 * Reads the palette APNGs `encodeApng` writes (dispose 0 or 1, blend 0 or 1).
 * @returns {{ poster: Rgb, frames: Frame[], plays: number }}
 */
export function decodeApng(/** @type {Buffer} */ png) {
  const all = chunks(png);
  const head = /** @type {Buffer} */ (all.find((c) => c.type === "IHDR")?.data);
  const width = head.readUInt32BE(0);
  const height = head.readUInt32BE(4);
  if (head[8] !== 8 || head[9] !== 3) throw new Error("only 8-bit palette APNGs");
  const plte = /** @type {Buffer} */ (all.find((c) => c.type === "PLTE")?.data);
  const trns = all.find((c) => c.type === "tRNS")?.data ?? Buffer.alloc(0);
  const actl = all.find((c) => c.type === "acTL")?.data;
  if (!actl) throw new Error("not an animated PNG: no acTL");
  const toRgb = (/** @type {Uint8Array} */ index, /** @type {number} */ w, /** @type {number} */ h) => {
    const rgb = new Uint8Array(w * h * 3);
    for (let p = 0; p < w * h; p++) rgb.set(plte.subarray(/** @type {number} */ (index[p]) * 3, /** @type {number} */ (index[p]) * 3 + 3), p * 3);
    return rgb;
  };
  const opaque = (/** @type {number} */ i) => (i < trns.length ? /** @type {number} */ (trns[i]) : 255) > 0;
  /** @type {Rgb | null} */
  let poster = null;
  /** @type {Frame[]} */
  const frames = [];
  const canvas = new Uint8Array(width * height * 3);
  /** @type {{ w: number, h: number, x: number, y: number, ms: number, dispose: number, blend: number } | null} */
  let control = null;
  /** @type {Buffer[]} */
  let data = [];
  const finish = () => {
    if (!control) return;
    const c = control;
    const index = unfilter(inflateSync(Buffer.concat(data)), c.h, c.w, 1);
    const before = canvas.slice();
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const i = /** @type {number} */ (index[y * c.w + x]);
        if (c.blend === 1 && !opaque(i)) continue;
        canvas.set(plte.subarray(i * 3, i * 3 + 3), ((c.y + y) * width + c.x + x) * 3);
      }
    }
    frames.push({ width, height, rgb: canvas.slice(), ms: c.ms });
    if (c.dispose === 1) for (let y = 0; y < c.h; y++) canvas.fill(0, ((c.y + y) * width + c.x) * 3, ((c.y + y) * width + c.x + c.w) * 3);
    if (c.dispose === 2) canvas.set(before);
    control = null;
    data = [];
  };
  for (const { type, data: d } of all) {
    if (type === "fcTL") {
      finish();
      const den = d.readUInt16BE(22) || 100;
      control = { w: d.readUInt32BE(4), h: d.readUInt32BE(8), x: d.readUInt32BE(12), y: d.readUInt32BE(16), ms: (d.readUInt16BE(20) * 1000) / den, dispose: /** @type {number} */ (d[24]), blend: /** @type {number} */ (d[25]) };
    } else if (type === "IDAT") {
      if (control) data.push(d);
      else {
        const idat = Buffer.concat(all.filter((c) => c.type === "IDAT").map((c) => c.data));
        if (!poster) poster = { width, height, rgb: toRgb(unfilter(inflateSync(idat), height, width, 1), width, height) };
      }
    } else if (type === "fdAT") data.push(d.subarray(4));
    else if (type === "IEND") finish();
  }
  return { poster: poster ?? /** @type {Frame} */ (frames[0]), frames, plays: actl.readUInt32BE(4) };
}
