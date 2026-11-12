// @ts-check
/**
 * One frame of the README film from what the steps recorded: the page as the browser drew it, the caption bar under it, and
 * on top the pointer, the ring of a press and the outline round what the caption speaks of. The phone's page stands in the
 * middle of the frame. Nothing here draws a part of the app: the page is the screenshot as it is.
 */

/** @typedef {import("./png.mjs").Rgb} Rgb */
/** @typedef {{ x: number, y: number, width: number, height: number }} Box */
/**
 * What the steps saved for one frame: the screenshot, its time, the caption bar, the pointer and a press (where and how many
 * frames ago), the outlined boxes, all in the page's own pixels.
 * @typedef {{ shot: string, ms: number, caption: string, bar: string, phone: boolean, pointer: { x: number, y: number } | null,
 *   press: { x: number, y: number, age: number } | null, marks: Box[], poster?: boolean }} Record
 */

/** The frame: the page of the computer's screen, and the caption bar under it. */
export const SIZE = { width: 1000, page: 640, bar: 64 };
/** The phone's screen and where it stands in the frame. */
export const PHONE = { width: 390, height: 616, x: 305, y: 12 };

const BACKDROP = [214, 220, 228];
const EDGE = [120, 130, 146];
const MARK = [232, 152, 0];
const BLACK = [16, 20, 28];
const WHITE = [255, 255, 255];

/** @param {Rgb} img @param {number} x @param {number} y @param {number[]} colour @param {number} alpha 0 to 1 */
function blend(img, x, y, colour, alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const a = Math.min(1, alpha);
  const at = (y * img.width + x) * 3;
  for (let k = 0; k < 3; k++) img.rgb[at + k] = Math.round(/** @type {number} */ (img.rgb[at + k]) * (1 - a) + /** @type {number} */ (colour[k]) * a);
}

/** The outline of a box with round corners, `stroke` pixels wide, its edges smoothed. */
export function outline(/** @type {Rgb} */ img, /** @type {Box} */ box, stroke = 3, radius = 8, colour = MARK) {
  const pad = stroke + 2;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const hx = box.width / 2;
  const hy = box.height / 2;
  for (let y = Math.floor(box.y - pad); y <= Math.ceil(box.y + box.height + pad); y++) {
    for (let x = Math.floor(box.x - pad); x <= Math.ceil(box.x + box.width + pad); x++) {
      // the signed distance from the pixel's centre to the rounded box
      const qx = Math.abs(x + 0.5 - cx) - hx + radius;
      const qy = Math.abs(y + 0.5 - cy) - hy + radius;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      blend(img, x, y, colour, stroke / 2 + 0.5 - Math.abs(d - stroke / 2));
    }
  }
}

/** A ring round a point, or a disc when `fill` is set. */
function ring(/** @type {Rgb} */ img, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r, stroke = 3, colour = MARK, fill = 0) {
  for (let y = Math.floor(cy - r - stroke); y <= Math.ceil(cy + r + stroke); y++) {
    for (let x = Math.floor(cx - r - stroke); x <= Math.ceil(cx + r + stroke); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r;
      if (fill) blend(img, x, y, colour, Math.min(fill, 0.5 - d));
      else blend(img, x, y, colour, stroke / 2 + 0.5 - Math.abs(d));
    }
  }
}

/** The arrow pointer, its tip at the point: # its edge, . its body. */
const ARROW = [
  "#",
  "##",
  "#.#",
  "#..#",
  "#...#",
  "#....#",
  "#.....#",
  "#......#",
  "#.......#",
  "#........#",
  "#.........#",
  "#..........#",
  "#......#####",
  "#...#..#",
  "#..##..#",
  "#.#  #..#",
  "##   #..#",
  "#     #..#",
  "      #..#",
  "       ##",
];

function pointer(/** @type {Rgb} */ img, /** @type {number} */ px, /** @type {number} */ py) {
  ARROW.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      if (line[x] === "#") blend(img, Math.round(px) + x, Math.round(py) + y, BLACK, 1);
      if (line[x] === ".") blend(img, Math.round(px) + x, Math.round(py) + y, WHITE, 1);
    }
  });
}

/** Copies a picture into another at x, y. */
function paste(/** @type {Rgb} */ into, /** @type {Rgb} */ from, /** @type {number} */ x, /** @type {number} */ y) {
  for (let row = 0; row < from.height; row++) {
    into.rgb.set(from.rgb.subarray(row * from.width * 3, (row + 1) * from.width * 3), ((y + row) * into.width + x) * 3);
  }
}

/**
 * The frame of one record.
 * @param {Record} record
 * @param {Rgb} shot the page as the browser drew it
 * @param {Rgb} bar the caption bar
 * @returns {Rgb}
 */
export function compose(record, shot, bar) {
  const img = { width: SIZE.width, height: SIZE.page + SIZE.bar, rgb: new Uint8Array(SIZE.width * (SIZE.page + SIZE.bar) * 3) };
  const want = record.phone ? PHONE : { width: SIZE.width, height: SIZE.page, x: 0, y: 0 };
  if (shot.width !== want.width || shot.height !== want.height) throw new Error(`${record.shot} is ${shot.width} x ${shot.height}, not ${want.width} x ${want.height}`);
  if (bar.width !== SIZE.width || bar.height !== SIZE.bar) throw new Error(`${record.bar} is ${bar.width} x ${bar.height}, not ${SIZE.width} x ${SIZE.bar}`);
  if (record.phone) {
    for (let p = 0; p < SIZE.width * SIZE.page; p++) img.rgb.set(BACKDROP, p * 3);
    outline(img, { x: PHONE.x - 1, y: PHONE.y - 1, width: PHONE.width + 2, height: PHONE.height + 2 }, 2, 10, EDGE);
  }
  paste(img, shot, want.x, want.y);
  paste(img, bar, 0, SIZE.page);
  for (const m of record.marks) outline(img, { x: m.x + want.x - 6, y: m.y + want.y - 6, width: m.width + 12, height: m.height + 12 });
  if (record.press) {
    const { x, y, age } = record.press;
    // a finger on the phone, a growing ring under the pointer on the computer
    if (record.phone) ring(img, x + want.x, y + want.y, 20 + age * 3, 3, BLACK, 0.25 / (1 + age));
    ring(img, x + want.x, y + want.y, record.phone ? 20 + age * 3 : 10 + age * 6, 3);
  }
  if (record.pointer && !record.phone) pointer(img, record.pointer.x, record.pointer.y);
  return img;
}
