import { describe, expect, it } from "vitest";
import { findDimmedPage, liftDimmedPage } from "../src/components/loans/dimmed-page.ts";

const W = 120;
const H = 90;
type Rect = [left: number, top: number, right: number, bottom: number, grey: number];
/** A picture of grey rectangles painted in order over a background, as RGBA. */
function paint(background: number, ...rects: Rect[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4).fill(background);
  for (const [left, top, right, bottom, grey] of rects) for (let y = top; y < bottom; y++) data.fill(grey, (y * W + left) * 4, (y * W + right) * 4);
  return data;
}
const at = (data: Uint8ClampedArray, x: number, y: number) => data[(y * W + x) * 4];

// The made-up view of e2e/fixtures/loan-views dims its page to a grey of 120 to 125 and draws the text at about 20.
const DIALOG: Rect = [40, 10, 80, 80, 255];
const DIMMED_TEXT: Rect = [5, 20, 30, 22, 20];
const DIALOG_TEXT: Rect = [45, 30, 75, 32, 27];

describe("a dialog over a dimmed page", () => {
  it("is found with its box and the dim's grey, also with text on the page and in the dialog", () => {
    expect(findDimmedPage(paint(122, DIALOG, DIMMED_TEXT, DIALOG_TEXT), W, H)).toEqual({ left: 40, top: 10, right: 80, bottom: 80, grey: 122 });
  });

  it("is lifted to the page alone: the dialog white, the dim's grey white and the page's text dark", () => {
    const data = paint(122, DIALOG, DIMMED_TEXT, DIALOG_TEXT);
    liftDimmedPage(data, W, H, findDimmedPage(data, W, H)!);
    expect([at(data, 50, 31), at(data, 2, 2), at(data, 10, 21)]).toEqual([255, 255, 42]);
  });

  it("is not found in a page with no dim: a white page, a light grey page with a white card, a dark page, a dialog alone", () => {
    expect(findDimmedPage(paint(255, DIALOG_TEXT), W, H)).toBeNull();
    expect(findDimmedPage(paint(242, DIALOG, DIALOG_TEXT), W, H)).toBeNull();
    expect(findDimmedPage(paint(20, DIALOG, DIALOG_TEXT), W, H)).toBeNull();
    expect(findDimmedPage(paint(255, [0, 0, W, H, 255], DIALOG_TEXT), W, H)).toBeNull();
  });

  it("is not found when the white is scattered or the page around it is no even grey", () => {
    expect(findDimmedPage(paint(122, [10, 10, 11, 11, 255], [100, 80, 101, 81, 255]), W, H)).toBeNull();
    const stripes = paint(122, ...Array.from({ length: 13 }, (_, i): Rect => [0, i * 7, W, i * 7 + 7, 40 + i * 12]), DIALOG);
    expect(findDimmedPage(stripes, W, H)).toBeNull();
  });
});
