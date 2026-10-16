import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Settlement, Waterfall } from "../src/components/overview/Waterfall.tsx";
import { settlementSentences, summaryOf, waterfallRows } from "../src/components/overview/waterfall.ts";
import type { WaterfallAnswer } from "../src/types.ts";

const names = new Map([["groceries", "Ruoka"]]);
/** Income 3 000 €, groceries 800 €, the rest of spending 1 200 €, 100 € moved in, 50 € of unknown rows out: 950 € left. */
const month: WaterfallAnswer = {
  month: "2026-10",
  bars: [
    { key: "income", cents: 300_000 },
    { key: "category:groceries", cents: -80_000 },
    { key: "other", cents: -120_000 },
    { key: "transfers", cents: 10_000 },
    { key: "unknown", cents: -5_000 },
  ],
  leftCents: 105_000,
};
const plain = (s: string) => s.replace(/\s/g, " ");

describe("waterfallRows", () => {
  const rows = waterfallRows(month, names);
  it("runs the total through the bars and ends on Yli jäi", () => {
    expect(rows.map((r) => [r.label, r.kind, r.total])).toEqual([
      ["Tulot", "up", 300_000],
      ["Ruoka", "down", 220_000],
      ["Muut menot", "down", 100_000],
      ["Säästöt ja luotot", "up", 110_000],
      ["Ei tiedossa", "down", 105_000],
      ["Yli jäi", "left", 105_000],
    ]);
    expect(rows[rows.length - 2]!.total).toBe(month.leftCents);
  });
  it("gives every bar its sign in text, so colour is not the only cue", () => {
    expect(rows.map((r) => plain(r.text))).toEqual(["+3 000,00 €", "−800,00 €", "−1 200,00 €", "+100,00 €", "−50,00 €", "1 050,00 €"]);
  });
  it("starts a falling bar where the total was and puts zero at the left while nothing is below it", () => {
    expect(rows[1]!.at).toBeCloseTo((220_000 / 300_000) * 100);
    expect(rows[1]!.span).toBeCloseTo((80_000 / 300_000) * 100);
    expect(rows[0]!.zero).toBe(0);
  });
  it("keeps zero inside the track when the month ends below it", () => {
    const over = waterfallRows({ month: "2026-10", bars: [{ key: "income", cents: 100_000 }, { key: "other", cents: -150_000 }], leftCents: -50_000 }, names);
    expect(over[0]!.zero).toBeCloseTo(100 / 3);
    expect(over[2]!.at).toBeCloseTo(0);
    expect(over[2]!.span).toBeCloseTo((50_000 / 150_000) * 100);
  });
  it("leaves a bar of nothing out and names an unknown category by its id", () => {
    const r = waterfallRows({ month: "2026-10", bars: [{ key: "income", cents: 1000 }, { key: "transfers", cents: 0 }, { key: "category:x", cents: -1000 }], leftCents: 0 }, names);
    expect(r.map((x) => x.label)).toEqual(["Tulot", "x", "Yli jäi"]);
  });
});

describe("summaryOf", () => {
  it("tells income, spending and what stayed", () => {
    expect(plain(summaryOf({ ...month, leftCents: 100_000, bars: [{ key: "income", cents: 300_000 }, { key: "other", cents: -200_000 }] }))).toBe("Tuloja 3 000,00 €, menoja 2 000,00 €. Yli jäi 1 000,00 €.");
  });
  it("says how much more went out than came in when Yli jäi is negative", () => {
    expect(plain(summaryOf({ month: "2026-10", bars: [{ key: "income", cents: 100_000 }, { key: "other", cents: -130_000 }], leftCents: -30_000 }))).toBe("Tuloja 1 000,00 €, menoja 1 300,00 €. Menoja oli 300,00 € enemmän kuin tuloja.");
  });
});

describe("settlementSentences", () => {
  const line = (name: string, overCents: number) => ({ owner: `u:${name}`, name, overCents });
  it("names who paid more or less than their share, by the furthest from it", () => {
    expect(settlementSentences([{ accountKey: "a", month: "2026-10", lines: [line("Matti", 5_000), line("Maija", -5_000)] }]).map(plain)).toEqual(["Matti on maksanut 50,00 € enemmän kuin osuutensa."]);
    expect(settlementSentences([{ accountKey: "a", month: "2026-10", lines: [line("Matti", 1_000), line("Maija", -4_000)] }]).map(plain)).toEqual(["Maija on maksanut 40,00 € vähemmän kuin osuutensa."]);
  });
  it("says all is even only when every pool is, and nothing without a pool", () => {
    const even = { accountKey: "a", month: "2026-10", lines: [line("Matti", 0), line("Maija", 0)] };
    expect(settlementSentences([even, { ...even, accountKey: "b" }])).toEqual(["Yhteiset menot ovat tasan."]);
    expect(settlementSentences([even, { accountKey: "b", month: "2026-10", lines: [line("Maija", 100)] }]).map(plain)).toEqual(["Maija on maksanut 1,00 € enemmän kuin osuutensa."]);
    expect(settlementSentences([])).toEqual([]);
  });
});

describe("Waterfall", () => {
  const html = (w: WaterfallAnswer | null) => renderToStaticMarkup(createElement(Waterfall, { waterfall: w, categories: names, range: { from: "2026-10-01", to: "2026-10-12" }, scope: "own" }));
  it("makes the bar of income, a category and Yli jäi a button that opens its rows, and draws the other bars only", () => {
    const out = html(month);
    expect(out.match(/aria-label="Näytä rivit: ([^"]+)"/g)).toEqual(['aria-label="Näytä rivit: Tulot"', 'aria-label="Näytä rivit: Ruoka"', 'aria-label="Näytä rivit: Yli jäi"']);
    expect(out).not.toContain("Miksi?");
    expect(out.match(/<button[^>]*><span class="wf-bar">/g)).toHaveLength(3);
  });
  it("holds a table of the same figures with the running total, hidden from the eye", () => {
    const out = html(month);
    expect(out).toContain("<caption>Tulot ja menot taulukkona</caption>");
    expect(out).toContain('<th scope="col">Erä</th><th scope="col">Summa</th><th scope="col">Kertymä</th>');
    expect(out.match(/<tr><th scope="row">/g)).toHaveLength(6);
    expect(out).toContain('class="sr-only">Tuloja');
  });
  it("tells an empty month in a sentence and draws no bar", () => {
    const out = html(null);
    expect(out).toContain("Tässä kuussa ei ole vielä tapahtumia.");
    expect(out).not.toContain("wf-row");
  });
});

describe("Settlement", () => {
  it("links to Yhteiset menot in Raportit and draws nothing without a pool", () => {
    const out = renderToStaticMarkup(createElement(Settlement, { pools: [{ accountKey: "a", month: "2026-10", lines: [{ owner: "u:1", name: "Matti", overCents: 0 }] }], anchor: "yhteiset-menot" }));
    expect(out).toContain('<a href="#/reports#yhteiset-menot">Yhteiset menot</a>');
    expect(out).toContain("Yhteiset menot ovat tasan.");
    expect(renderToStaticMarkup(createElement(Settlement, { pools: [], anchor: "yhteiset-menot" }))).toBe("");
  });
});
