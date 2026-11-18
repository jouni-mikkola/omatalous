/**
 * A bank's dialog over its dimmed page. The reader thresholds the picture as a whole: the white dialog is the paper and
 * the dimmed page around it turns as dark as its text, so nothing of the page is read. Here the dialog is found and the
 * page is drawn again on its own, the dialog blanked and the dimmed grey lifted to white, so a second read can find the
 * figures the dialog leaves out (the rate, the next payment).
 */

/** The dialog: the box around every white pixel, in the picture's pixels, end exclusive. */
export interface DimmedPage {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The grey of the dimmed page's background, as luminance 0 to 255. */
  grey: number;
}

/** A pixel this light in every channel is paper; nothing the dim covers is this light. */
const WHITE = 235;
/** The dialog covers this share of the picture at least and at most: a white page with no dim around it is no dialog. */
const MIN_BOX = 0.05;
const MAX_BOX = 0.85;
/** The share of the dialog's box that is white: a box drawn round scattered white pixels is no dialog. */
const MIN_WHITE_IN_BOX = 0.6;
/** The dim's grey lies in this range: lighter is a plain grey page, darker a dark page. */
const MIN_GREY = 40;
const MAX_GREY = 200;
/** The share of the page around the dialog that lies within NEAR of the dim's grey: a dimmed page is mostly its background. */
const MIN_GREY_SHARE = 0.4;
const NEAR = 12;

const luminance = (data: Uint8ClampedArray, i: number) => (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;

/** The dialog and the dim's grey, or null when the picture is no dialog over a dimmed page. `data` is RGBA, row by row. */
export function findDimmedPage(data: Uint8ClampedArray, width: number, height: number): DimmedPage | null {
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i]! < WHITE || data[i + 1]! < WHITE || data[i + 2]! < WHITE) continue;
      if (x < left) left = x;
      if (x >= right) right = x + 1;
      if (y < top) top = y;
      if (y >= bottom) bottom = y + 1;
    }
  }
  const area = width * height;
  const boxArea = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (boxArea < MIN_BOX * area || boxArea > MAX_BOX * area) return null;
  let white = 0;
  const greys = new Array<number>(256).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (x >= left && x < right && y >= top && y < bottom) {
        if (data[i]! >= WHITE && data[i + 1]! >= WHITE && data[i + 2]! >= WHITE) white++;
      } else greys[Math.round(luminance(data, i))]!++;
    }
  }
  if (white < MIN_WHITE_IN_BOX * boxArea) return null;
  let grey = 0;
  for (let g = 1; g < 256; g++) if (greys[g]! > greys[grey]!) grey = g;
  if (grey < MIN_GREY || grey > MAX_GREY) return null;
  let near = 0;
  for (let g = Math.max(0, grey - NEAR); g <= Math.min(255, grey + NEAR); g++) near += greys[g]!;
  return near >= MIN_GREY_SHARE * (area - boxArea) ? { left, top, right, bottom, grey } : null;
}

/** The page behind the dialog as dark text on white: the dialog's box white, every other pixel lifted so the dim's grey is white. Writes into `data`. */
export function liftDimmedPage(data: Uint8ClampedArray, width: number, height: number, found: DimmedPage): void {
  // the dialog's shadow falls just outside its box; a band of it goes with the box
  const band = Math.round(Math.min(width, height) * 0.01);
  const lift = 255 / found.grey;
  for (let y = 0; y < height; y++) {
    const inRows = y >= found.top - band && y < found.bottom + band;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = inRows && x >= found.left - band && x < found.right + band ? 255 : Math.min(255, Math.round(luminance(data, i) * lift));
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
}
