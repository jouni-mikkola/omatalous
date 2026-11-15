import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pngTexts, scanImage, STAMP_KEY } from "../privacy/scan.mjs";
import { SIZE } from "../readme-film/compose.mjs";
import { FILES, IMAGES, MAX_BYTES, SECONDS } from "../readme-film/film.mjs";
import { decodeApng, decodePng, encodeApng, encodePng } from "../readme-film/png.mjs";
import { cents, englishDate, englishDays, euros, readMs } from "../readme-film/steps.mjs";

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

  it("writes the app's Finnish dates and spans of days in English", () => {
    expect(englishDate("1.10.2025")).toBe("1 Oct 2025");
    expect(englishDate("25.11.")).toBe("25 Nov");
    expect(englishDays("1.–12.11.")).toEqual({ text: "1–12 Nov", days: 12 });
    // the 1st of a month is one day, which the caption names as "that day"
    expect(englishDays("1.11.")).toEqual({ text: "1 Nov", days: 1 });
    expect(() => englishDays("Viikko 46")).toThrow();
  });

  // 17 characters a second, the pace of subtitles for adults; a short caption still stays long enough to notice
  it("holds a caption by its length", () => {
    expect(readMs("x".repeat(170))).toBe(10_000);
    expect(readMs("Short.")).toBe(2600);
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

  // read without decodeApng, so a mistake the encoder and the decoder share does not pass: the APNG specification's order
  it("is an APNG by its chunks: valid CRCs, the still as the default image, frames numbered in order inside the picture", () => {
    const list: { type: string; data: Buffer }[] = [];
    for (let at = 8; at < film.length; ) {
      const length = film.readUInt32BE(at);
      const type = film.toString("latin1", at + 4, at + 8);
      const data = film.subarray(at + 8, at + 8 + length);
      expect(film.readUInt32BE(at + 8 + length), `CRC of ${type}`).toBe(crc32(film.subarray(at + 4, at + 8 + length)));
      list.push({ type, data });
      at += 12 + length;
    }
    const types = list.map((c) => c.type);
    expect(types[0]).toBe("IHDR");
    expect(types.at(-1)).toBe("IEND");
    const ihdr = list[0]!.data;
    const [width, height] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4)];
    const actl = list.find((c) => c.type === "acTL")!.data;
    expect(types.indexOf("acTL")).toBeLessThan(types.indexOf("IDAT"));
    const fctl = list.filter((c) => c.type === "fcTL");
    expect(actl.readUInt32BE(0)).toBe(fctl.length);
    expect(actl.readUInt32BE(4), "plays").toBe(0);
    // no fcTL before IDAT: the IDAT image is the still, outside the animation, which a viewer without APNG shows
    expect(types.indexOf("fcTL")).toBeGreaterThan(types.lastIndexOf("IDAT"));
    const numbered = list.filter((c) => c.type === "fcTL" || c.type === "fdAT").map((c) => c.data.readUInt32BE(0));
    expect(numbered).toEqual(numbered.map((_, i) => i));
    for (const { data } of fctl) {
      const [w, h, x, y] = [data.readUInt32BE(4), data.readUInt32BE(8), data.readUInt32BE(12), data.readUInt32BE(16)];
      expect(x + w).toBeLessThanOrEqual(width);
      expect(y + h).toBeLessThanOrEqual(height);
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
