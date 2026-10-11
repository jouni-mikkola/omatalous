import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { detectRecurring, parseSeriesId, seriesId, type SeriesIdParts } from "../src/recurring.ts";
import { randomHistory, rng } from "./gen.ts";

const PIECES = ["#", ":", "#habit", "#12", "#-3", "#0", "#007", "Foo", "K-Market", " ", "24", "7", "ä", "::", "##", "Spotify 2", "a#b"];

/** A merchant name made of the pieces that a series id's separators and suffixes are made of. */
function oddName(next: () => number): string {
  const n = 1 + Math.floor(next() * 4);
  let name = "";
  for (let i = 0; i < n; i++) name += PIECES[Math.floor(next() * PIECES.length)];
  return name;
}

describe("series id", () => {
  it("round-trips odd merchant names: #, :, digits and product suffixes at the end", () => {
    const next = rng(9);
    for (let i = 0; i < 5000; i++) {
      const roll = next();
      const parts: SeriesIdParts = {
        direction: next() < 0.5 ? "in" : "out",
        accountId: next() < 0.5 ? "eb-0a1b2c3d4e5f60718293a4b5" : "csv-1",
        merchant: oddName(next),
        product: roll < 0.4 ? null : roll < 0.6 ? "habit" : Math.round((next() - 0.2) * 100000),
      };
      const id = seriesId(parts);
      expect(parseSeriesId(id), id).toEqual(parts);
      expect(seriesId(parseSeriesId(id)!), id).toBe(id);
    }
  });

  it("keeps the stored format for every name the app derives (stored ids do not change)", () => {
    const next = rng(4);
    for (let i = 0; i < 2000; i++) {
      const merchant = normalizeMerchant(oddName(next), null);
      expect(merchant).not.toMatch(/[#:]/);
      expect(seriesId({ direction: "out", accountId: "a", merchant, product: null })).toBe(`out:a:${merchant}`);
      expect(seriesId({ direction: "out", accountId: "a", merchant, product: 1299 })).toBe(`out:a:${merchant}#1299`);
      expect(seriesId({ direction: "in", accountId: "a", merchant, product: "habit" })).toBe(`in:a:${merchant}#habit`);
    }
  });

  it("reads back every series the detector finds in random histories", () => {
    let seen = 0;
    for (const seed of [1, 2, 3]) {
      const { txs, accounts, rules } = randomHistory(seed, 400);
      const enriched = enrichTransactions(txs, accounts, rules);
      const today = enriched.reduce((max, t) => (t.bookingDate > max ? t.bookingDate : max), "");
      for (const s of detectRecurring(enriched, today)) {
        const parts = parseSeriesId(s.id);
        expect(parts?.merchant, s.id).toBe(s.merchant);
        expect(seriesId(parts!)).toBe(s.id);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(10);
  }, 30_000);

  it("is null for a subject that is no series id", () => {
    for (const subject of ["Wolt", "video", "both:acc:Wolt", "out:acc:", ""]) expect(parseSeriesId(subject)).toBeNull();
  });
});
