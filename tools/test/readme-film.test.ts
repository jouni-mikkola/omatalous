import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pngTexts, scanImage, STAMP_KEY } from "../privacy/scan.mjs";
import { SIZE } from "../readme-film/compose.mjs";
import { FILES, IMAGES, MAX_BYTES, SECONDS } from "../readme-film/film.mjs";
import { decodeApng, decodePng, encodeApng, encodePng } from "../readme-film/png.mjs";
import { cents, englishDate, englishMonth, euros } from "../readme-film/steps.mjs";

const ROOT = join(import.meta.dirname, "../..");

/** A small picture of one colour with one pixel of another. */
function picture(colour: number[], dot: number[] | null = null, ms = 100) {
  const rgb = new Uint8Array(6 * 4 * 3);
  for (let p = 0; p < 24; p++) rgb.set(colour, p * 3);
  if (dot) rgb.set(dot, (2 * 6 + 3) * 3);
  return { width: 6, height: 4, rgb, ms };
}

describe("readme:film, the animated PNG", () => {
  it("decodes to the frames it was made of, with their times, and loops for ever", () => {
    const grey = [200, 200, 200];
    const frames = [picture(grey), picture(grey, [255, 0, 0], 200), picture(grey, [255, 0, 0], 300), picture([0, 0, 90], null, 400)];
    const film = decodeApng(encodeApng(frames, frames[1]!));
    expect(film.plays).toBe(0);
    // two frames that look the same are one frame shown for both times
    expect(film.frames.map((f) => f.ms)).toEqual([100, 500, 400]);
    expect(Buffer.from(film.frames[1]!.rgb)).toEqual(Buffer.from(frames[1]!.rgb));
    expect(Buffer.from(film.frames[2]!.rgb)).toEqual(Buffer.from(frames[3]!.rgb));
    expect(Buffer.from(film.poster.rgb)).toEqual(Buffer.from(frames[1]!.rgb));
  });

  it("writes a still PNG that decodes to its pixels", () => {
    const still = picture([10, 20, 30], [40, 50, 60]);
    expect(Buffer.from(decodePng(encodePng(still)).rgb)).toEqual(Buffer.from(still.rgb));
  });
});

describe("readme:film, the captions", () => {
  it("reads a sum as the app writes it and writes it back the same way", () => {
    expect(cents("4 905,68 €")).toBe(490568);
    expect(cents("−78,26 €")).toBe(-7826);
    expect(cents("Menot 2 103 €")).toBe(210300);
    expect(euros(482742)).toBe("4 827,42 €");
    expect(euros(-7826)).toBe("−78,26 €");
    expect(() => cents("ei summaa")).toThrow();
  });

  it("writes the app's Finnish dates and months in English", () => {
    expect(englishDate("1.10.2025")).toBe("1 Oct 2025");
    expect(englishDate("25.11.")).toBe("25 Nov");
    expect(englishMonth("Marraskuu 2026")).toBe("November");
    expect(() => englishMonth("Viikko 46")).toThrow();
  });
});

describe("readme:film, the film in docs/images/", () => {
  const film = readFileSync(join(IMAGES, FILES.film));
  const still = readFileSync(join(IMAGES, FILES.still));

  // the privacy check lets a picture in only with the stamp of shots, which took these frames of the example household
  it("both pictures carry the stamp of the example household and pass the privacy check", () => {
    for (const [file, png] of [
      [FILES.film, film],
      [FILES.still, still],
    ] as const) {
      expect(pngTexts(png)[STAMP_KEY], file).toBe("demo");
      expect(scanImage(`docs/images/${file}`, png), file).toEqual([]);
    }
  });

  it("loops, lasts 20 to 40 seconds, fits the README and stays small", () => {
    const { frames, plays, poster } = decodeApng(film);
    const seconds = frames.reduce((s, f) => s + f.ms, 0) / 1000;
    expect(plays).toBe(0);
    expect(seconds).toBeGreaterThanOrEqual(SECONDS.least);
    expect(seconds).toBeLessThanOrEqual(SECONDS.most);
    expect(film.length).toBeLessThan(MAX_BYTES);
    expect([poster.width, poster.height]).toEqual([SIZE.width, SIZE.page + SIZE.bar]);
    const { width, height } = decodePng(still);
    expect([width, height]).toEqual([SIZE.width, SIZE.page + SIZE.bar]);
  });

  // a reader who asks the browser for less motion gets the still; everyone gets a text in place of the picture
  it("is at the top of the README, with the still for less motion and a text for a reader who cannot see it", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const top = readme.slice(0, readme.indexOf("\n## "));
    expect(top).toMatch(new RegExp(`<source media="\\(prefers-reduced-motion: reduce\\)" srcset="docs/images/${FILES.still}">`));
    expect(top).toMatch(new RegExp(`<img src="docs/images/${FILES.film}" alt="[^"]{40,}"`));
  });
});
