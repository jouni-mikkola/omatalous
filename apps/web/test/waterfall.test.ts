import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Settlement, Waterfall } from "../src/components/overview/Waterfall.tsx";
import { CARD_GAP, openKey, settlementSentences, summaryOf, toggledRow, waterfallRows } from "../src/components/overview/waterfall.ts";
import type { WaterfallAnswer } from "../src/types.ts";
import { type Account, buildDashboard, createContext, type Transaction } from "@banking/core";

type Bar = WaterfallAnswer["bars"][number];
/** The bars as core sends them: each with the running total it starts and ends at. */
const run = (bars: Omit<Bar, "fromCents" | "toCents">[]): Bar[] => {
  let at = 0;
  return bars.map((b) => ({ ...b, fromCents: at, toCents: (at += b.cents) }));
};

const names = new Map([["groceries", "Ruoka"]]);
/**
 * Income 3 000 € from one payer, groceries 800 € at two shops, the rest of spending (three categories) 1 200 €, 100 € of
 * credit drawn and 50 € saved: 1 050 € left.
 */
const month: WaterfallAnswer = {
  month: "2026-10",
  bars: run([
    { key: "income", cents: 300_000, parts: [{ key: "payee:ESIMERKKI OY", cents: 300_000 }] },
    { key: "category:groceries", cents: -80_000, parts: [{ key: "payee:Prisma Esimerkki", cents: -50_000 }, { key: "payee:Lidl Esimerkki", cents: -20_000 }, { key: "rest", cents: -10_000, count: 3 }] },
    { key: "other", cents: -120_000, count: 3, parts: [{ key: "category:housing", cents: -70_000 }, { key: "category:transport", cents: -30_000 }, { key: "category:x", cents: -20_000 }] },
    { key: "transfers", cents: 5_000, parts: [{ key: "borrowed", cents: 10_000 }, { key: "saved", cents: -5_000 }] },
  ]),
  leftCents: 105_000,
  incomeCents: 300_000,
  spentCents: 200_000,
  transfersCents: 5_000,
};
const hrefs = { category: (id: string) => `#/transactions?category=${id}&from=2026-10-01&to=2026-10-31`, payee: (name: string) => `#/transactions?merchant=${encodeURIComponent(name)}&from=2026-10-01&to=2026-10-31`, income: "#/transactions?kind=income&from=2026-10-01&to=2026-10-31" };
const amp = (href: string) => href.replace(/&/g, "&amp;");
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
let seq = 0;
/** A booked row of the checking account, in cents (negative is money out). */
const row = (bookingDate: string, amountCents: number, category: string, merchant: string): Transaction => ({
  id: `r${++seq}`, accountId: "acc-1", currency: "EUR", status: "booked", counterparty: null, counterpartyIban: null, description: null, mcc: null, merchant, category, categorySource: "default", isTransfer: false, bookingDate, amountCents,
});
const plain = (s: string) => s.replace(/\s/g, " ");

describe("waterfallRows", () => {
  const rows = waterfallRows(month, names, hrefs);
  it("keeps the bars in the server's order and ends on Tulos", () => {
    expect(rows.map((r) => [r.label, r.kind])).toEqual([
      ["Tulot", "up"],
      ["Ruoka", "down"],
      ["Muut (3)", "down"],
      ["Säästöt ja luotot", "up"],
      ["Tulos", "left"],
    ]);
  });
  it("gives every bar its sign in text, so colour is not the only cue", () => {
    expect(rows.map((r) => plain(r.text))).toEqual(["+3 000,00 €", "−800,00 €", "−1 200,00 €", "+50,00 €", "1 050,00 €"]);
  });
  it("starts a falling bar where the total was and puts zero at the left while nothing is below it", () => {
    expect(rows[1]!.at).toBeCloseTo((220_000 / 300_000) * 100);
    expect(rows[1]!.span).toBeCloseTo((80_000 / 300_000) * 100);
    expect(rows[0]!.zero).toBe(0);
  });
  it("keeps zero inside the track when the month ends below it", () => {
    const over = waterfallRows({ month: "2026-10", bars: run([{ key: "income", cents: 100_000, parts: [] }, { key: "other", cents: -150_000, parts: [] }]), leftCents: -50_000, incomeCents: 100_000, spentCents: 150_000, transfersCents: 0 }, names, hrefs);
    expect(over[0]!.zero).toBeCloseTo(100 / 3);
    expect(over[2]!.at).toBeCloseTo(0);
    expect(over[2]!.span).toBeCloseTo((50_000 / 150_000) * 100);
  });
  describe("the usual tick", () => {
    const answer = (bars: Omit<Bar, "fromCents" | "toCents">[], leftCents: number): WaterfallAnswer => ({ month: "2026-10", bars: run(bars), leftCents, incomeCents: 0, spentCents: 0, transfersCents: 0 });
    const usualAts = (w: WaterfallAnswer) => waterfallRows(w, names, hrefs).map((r) => r.usualAt);
    it("keeps a usual income twice this month's inside the track, and the bar's own tick on the same scale", () => {
      const w = answer([{ key: "income", cents: 100_000, usualCents: 200_000, parts: [] }, { key: "other", cents: -40_000, usualCents: -80_000, parts: [] }], 60_000);
      const [income, other] = usualAts(w);
      expect(income).toBeCloseTo(100);
      // the usual spending starts at the income's end (100 000) and falls to 20 000 of a 200 000 track
      expect(other).toBeCloseTo(10);
      const rows = waterfallRows(w, names, hrefs);
      expect(rows[0]!.at + rows[0]!.span).toBeCloseTo(50);
    });
    it("keeps a usual spending bigger than the whole month's money above zero", () => {
      const w = answer([{ key: "income", cents: 100_000, usualCents: 100_000, parts: [] }, { key: "other", cents: -50_000, usualCents: -300_000, parts: [] }], 50_000);
      for (const at of usualAts(w)) expect(at === null || (at >= 0 && at <= 100)).toBe(true);
      expect(usualAts(w)[1]).toBeCloseTo(0);
      expect(waterfallRows(w, names, hrefs)[0]!.zero).toBeCloseTo(200 / 3);
    });
    it("stays between 0 and 100 when the usual is far beyond or below the month, and is null without one", () => {
      for (const usual of [-900_000, -1, 0, 1, 900_000, 5_000_000]) {
        const w = answer([{ key: "income", cents: 10_000, usualCents: usual, parts: [] }, { key: "category:groceries", cents: -4_000, usualCents: usual, parts: [] }, { key: "transfers", cents: 500, usualCents: null, parts: [] }], 6_500);
        const ats = usualAts(w);
        for (const at of ats.slice(0, 2)) expect(at).toBeGreaterThanOrEqual(0), expect(at).toBeLessThanOrEqual(100.0000001);
        expect(ats.slice(2)).toEqual([null, null]);
      }
    });
  });
  it("leaves a bar of nothing out and names an unknown category by its id", () => {
    const r = waterfallRows({ month: "2026-10", bars: run([{ key: "income", cents: 1000, parts: [] }, { key: "transfers", cents: 0, parts: [] }, { key: "category:x", cents: -1000, parts: [] }]), leftCents: 0, incomeCents: 1000, spentCents: 1000, transfersCents: 0 }, names, hrefs);
    expect(r.map((x) => x.label)).toEqual(["Tulot", "x", "Tulos"]);
  });
});

describe("summaryOf", () => {
  // the figures are the answer's (core monthWaterfall): the sentence adds up nothing
  const of = (incomeCents: number, spentCents: number, transfersCents: number, leftCents: number) => ({ month: "2026-10", bars: [], leftCents, incomeCents, spentCents, transfersCents });
  it("tells income, spending and what stayed", () => {
    expect(plain(summaryOf(of(300_000, 200_000, 0, 100_000)))).toBe("Tuloja 3 000,00 €, menoja 2 000,00 €. Tulos 1 000,00 €.");
  });
  it("names what went to savings and credit after the table's two figures, and leaves it out when nothing did", () => {
    expect(plain(summaryOf(of(400_000, 350_000, -20_000, 30_000)))).toBe("Tuloja 4 000,00 €, menoja 3 500,00 €. Säästöihin ja luottoihin meni 200,00 €. Tulos 300,00 €.");
    expect(plain(summaryOf(of(400_000, 350_000, 0, 50_000)))).toBe("Tuloja 4 000,00 €, menoja 3 500,00 €. Tulos 500,00 €.");
    // more credit drawn than saved: money came in, and the sentence says so instead of a negative sum
    expect(plain(summaryOf(of(400_000, 350_000, 10_000, 60_000)))).toBe("Tuloja 4 000,00 €, menoja 3 500,00 €. Säästöistä ja luotoista tuli 100,00 €. Tulos 600,00 €.");
  });
  it("says how much more went out than came in when Tulos is below zero, with and without savings", () => {
    expect(plain(summaryOf(of(100_000, 130_000, 0, -30_000)))).toBe("Tuloja 1 000,00 €, menoja 1 300,00 €. Rahaa meni 300,00 € enemmän kuin tuli.");
    expect(plain(summaryOf(of(100_000, 130_000, -40_000, -70_000)))).toBe("Tuloja 1 000,00 €, menoja 1 300,00 €. Säästöihin ja luottoihin meni 400,00 €. Rahaa meni 700,00 € enemmän kuin tuli.");
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
  const html = (w: WaterfallAnswer | null) => renderToStaticMarkup(createElement(Waterfall, { waterfall: w, categories: names, range: { from: "2026-10-01", to: "2026-10-12" }, scope: "own", hrefs, before: null, open: null, onToggle: () => {} }));
  it("makes the bar of income, a category and Tulos a button that opens its rows, and draws the other bars only", () => {
    const out = html(month);
    expect(out.match(/aria-label="Näytä tapahtumat: ([^"]+)"/g)).toEqual(['aria-label="Näytä tapahtumat: Tulot"', 'aria-label="Näytä tapahtumat: Ruoka"', 'aria-label="Näytä tapahtumat: Tulos"']);
    expect(out).not.toContain("Miksi?");
    expect(out.match(/<button[^>]*><span class="wf-bar">/g)).toHaveLength(3);
  });
  it("says in one line why no bar has a usual when the months to compare hold card bills, and draws no chip or tick", () => {
    const out = html({ ...month, cardGap: true });
    expect(out).toContain(`<p class="wf-gate">${CARD_GAP}</p>`);
    expect(out).not.toContain("wf-chip");
    expect(out).not.toContain("wf-usual");
    expect(html(month)).not.toContain("wf-gate");
  });
  it("tells an empty month in a sentence and draws no bar", () => {
    const out = html(null);
    expect(out).toContain("Tässä kuussa ei ole vielä tapahtumia.");
    expect(out).not.toContain("wf-row");
  });
});

/** The cents a line says: "−1 200,00 €" gives -120000. */
const centsOf = (text: string) => (text.startsWith("−") ? -1 : 1) * Number(text.replace(/\D/g, ""));
/** The lines of the open row as the page draws them: name, sum, link. */
const detail = (out: string) => [...(/<div class="wf-detail">(.*?)<\/div>/.exec(out)?.[1] ?? "").matchAll(/<li class="st-row"><span class="st-name"[^>]*>(?:<a href="([^"]*)">)?([^<]*)(?:<\/a>)?<\/span><span class="st-num">([^<]*)<\/span>/g)].map((m) => [plain(m[2]!), plain(m[3]!), m[1] ?? null]);
const allLink = (out: string) => /<p class="st-links"><a href="([^"]*)">Näytä kaikki tapahtumat<\/a>/.exec(out)?.[1] ?? null;

describe("Waterfall: a row opens in place", () => {
  const html = (open: string | null, w: WaterfallAnswer = month) => renderToStaticMarkup(createElement(Waterfall, { waterfall: w, categories: names, range: { from: "2026-10-01", to: "2026-10-31" }, scope: "own", hrefs, before: null, open, onToggle: () => {} }));

  it("gives every row but Tulos a button with aria-expanded, closed at first and open for the one open row only", () => {
    const closed = html(null);
    expect(closed.match(/<button type="button" class="themes-toggle wf-toggle" aria-expanded="(true|false)"/g)).toHaveLength(4);
    expect(closed).not.toContain('aria-expanded="true"');
    expect(closed).not.toContain("wf-detail");
    const open = html("category:groceries");
    expect(open.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(open).toMatch(/aria-expanded="true"><span class="wf-label" title="Ruoka">/);
    expect(open.match(/class="wf-detail"/g)).toHaveLength(1);
  });

  it("opens a category to its payees largest first with their sums, the rest as Muut (n), and one link to the category's rows in the month", () => {
    const out = html("category:groceries");
    expect(detail(out)).toEqual([["Prisma Esimerkki", "−500,00 €", amp(hrefs.payee("Prisma Esimerkki"))], ["Lidl Esimerkki", "−200,00 €", amp(hrefs.payee("Lidl Esimerkki"))], ["Muut (3)", "−100,00 €", null]]);
    expect(allLink(out)).toBe("#/transactions?category=groceries&amp;from=2026-10-01&amp;to=2026-10-31");
  });

  it("opens Tulot to its payers, each a link to that payer's rows in the month, and links to the month's income rows", () => {
    const out = html("income");
    expect(detail(out)).toEqual([["ESIMERKKI OY", "+3 000,00 €", amp(hrefs.payee("ESIMERKKI OY"))]]);
    expect(allLink(out)).toBe(amp(hrefs.income));
  });

  it("opens Muut (n) to the categories it folds, each a link as the category links are, and has no link of its own", () => {
    const out = html("other");
    const link = (id: string) => amp(hrefs.category(id));
    expect(detail(out)).toEqual([["housing", "−700,00 €", link("housing")], ["transport", "−300,00 €", link("transport")], ["x", "−200,00 €", link("x")]]);
    expect(allLink(out)).toBeNull();
  });

  it("opens Säästöt ja luotot to what was drawn and what was saved, as plain lines", () => {
    const out = html("transfers");
    expect(detail(out)).toEqual([["Luotonnostot", "+100,00 €", null], ["Säästöt", "−50,00 €", null]]);
    expect(allLink(out)).toBeNull();
  });

  it("does not open Tulos: a name and no button, and an open key of it draws nothing", () => {
    const out = html("left");
    expect(out).not.toContain("wf-detail");
    expect(out).toContain('<span class="wf-label" title="Tulos">Tulos</span>');
    expect(out).not.toContain('aria-expanded="true"');
  });

  it("adds the lines of every row up to the row's figure, in a month of real rows with a refund, savings and credit", () => {
    const shops = Array.from({ length: 11 }, (_, i) => row("2026-09-03", -(1_000 + i * 100), "groceries", `ESIMERKKI KAUPPA ${i}`));
    const tiny = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"].map((x, i) => row("2026-09-05", -(100 + i), x, `ESIMERKKI ${x}`));
    const rows = [row("2026-09-25", 300_000, "salary", "ESIMERKKI OY"), ...shops, ...tiny, row("2026-09-08", 500, "groceries", "ESIMERKKI KAUPPA 3"), row("2026-09-06", -50_000, "savings", "Oma säästö"), row("2026-09-14", 10_000, "credit_draw", "ESIMERKKI LUOTTO")];
    const w = buildDashboard(createContext(rows, [checking], "2026-10-12"), { from: "2026-09-01", to: "2026-09-30" }).waterfall!;
    const answered = waterfallRows(w, names, hrefs);
    // every bar but Tulos has lines, and those lines add up to the bar
    expect(answered.filter((r) => r.lines.length).map((r) => r.key)).toEqual(w.bars.map((b) => b.key));
    expect(w.bars.map((b) => b.key)).toContain("other");
    expect(w.bars.map((b) => b.key)).toContain("transfers");
    for (const r of answered) if (r.kind !== "left") expect(r.lines.reduce((n, l) => n + centsOf(l.text), 0)).toBe(r.cents);
    expect(answered[answered.length - 1]!.lines).toEqual([]);
  });
});

describe("the open row", () => {
  it("opens the row clicked and closes the one that was open, one at a time", () => {
    const first = toggledRow(null, "2026-10", "income");
    expect(openKey(first, "2026-10")).toBe("income");
    const second = toggledRow(first, "2026-10", "other");
    expect(openKey(second, "2026-10")).toBe("other");
    expect(openKey(toggledRow(second, "2026-10", "other"), "2026-10")).toBeNull();
  });

  it("is closed in any month but the one it was opened in: a switch of the month closes it", () => {
    const open = toggledRow(null, "2026-10", "category:groceries");
    expect(openKey(open, "2026-09")).toBeNull();
    // a click in the other month opens that month's own row, not the old one
    expect(openKey(toggledRow(open, "2026-09", "category:groceries"), "2026-09")).toBe("category:groceries");
  });
});

describe("Waterfall: the month before in the open row", () => {
  const before = { name: "Syyskuu", incomeCents: 290_000, categories: new Map([["groceries", 41_200]]) };
  const html = (open: string | null, b: typeof before | null) => renderToStaticMarkup(createElement(Waterfall, { waterfall: month, categories: names, range: { from: "2026-10-01", to: "2026-10-31" }, scope: "own", hrefs, before: b, open, onToggle: () => {} }));
  const said = (out: string) => [...out.matchAll(/<p class="wf-before">([^<]*)<\/p>/g)].map((m) => plain(m[1]!));

  it("tells what the month before had under an open category and under Tulot, from the fields it is given", () => {
    expect(said(html("category:groceries", before))).toEqual(["Syyskuu: 412,00 €"]);
    expect(said(html("income", before))).toEqual(["Syyskuu: 2 900,00 €"]);
  });

  it("tells a category the month before did not have as nothing, not as a missing line", () => {
    expect(said(html("category:groceries", { ...before, categories: new Map() }))).toEqual(["Syyskuu: 0,00 €"]);
  });

  it("has no line when the months do not compare, and none under the rows that are no sums of a month before", () => {
    expect(said(html("category:groceries", null))).toEqual([]);
    expect(said(html("income", null))).toEqual([]);
    expect(said(html("other", before))).toEqual([]);
    expect(said(html("transfers", before))).toEqual([]);
  });

  it("tells it for the open row only", () => {
    expect(said(html("income", before))).toHaveLength(1);
    expect(html(null, before)).not.toContain("wf-before");
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
