import { readFileSync } from "node:fs";
import { totalsOf } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bridgeDraws, bridgeFigures, bridgeParts, bridgeRows, bridgeSources, bridgeText } from "../src/components/month-parts.ts";
import { SurplusBridge } from "../src/components/SurplusBridge.tsx";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

/** Totals as the owner gives them, from made-up sums in euros. */
const period = (eur: { income?: number; consumption?: number; debt?: number; saved?: number; borrowed?: number }) =>
  totalsOf([{ income: (eur.income ?? 0) * 100, consumption: (eur.consumption ?? 0) * 100, debt: (eur.debt ?? 0) * 100, saved: (eur.saved ?? 0) * 100, borrowed: (eur.borrowed ?? 0) * 100 }]);
/** The text as a reader sees it: the spaces inside a sum are plain ones. */
const plain = (s: string) => s.replace(/\s/g, " ").replace(/−/g, "-");
const sum = (parts: { cents: number }[]) => parts.reduce((s, p) => s + p.cents, 0);
const said = (t: ReturnType<typeof period>) => {
  const text = bridgeText(t);
  return plain([text.gap, ...text.drawn.flatMap((l) => [l.text, l.stayed])].filter(Boolean).join(" "));
};
const html = (t: ReturnType<typeof period>) => plain(renderToStaticMarkup(createElement(SurplusBridge, { totals: t, title: "Tulojen käyttö" })));
const tiles = (out: string) => [...out.matchAll(/<span class="k">(?:<i[^>]*><\/i>)?([^<]+)<\/span><span class="v">([^<]+)<\/span>/g)].map((m) => `${m[1]} ${m[2]}`);

/** The rows of the table as they read: the label and the sum. */
const cells = (out: string) => [...out.matchAll(/<tr><td>(?:<strong>)?([^<]+)(?:<\/strong>)?<\/td><td class="num">(?:<strong>)?([^<]+)/g)].map((m) => `${m[1]} ${m[2]}`);

const usual = period({ income: 4000, consumption: 2500, debt: 400, saved: 500 });
const car = { income: 3000, consumption: 13_000 };

describe("the surplus bridge", () => {
  it("stands its head in the body, not as a second name strip", () => {
    const out = html(usual);
    expect(out).toContain('<div class="bridge-head">');
    expect(out).not.toContain("card-head");
  });
  it("keeps the order and gives every part a colour of its own", () => {
    const parts = bridgeParts(usual);
    expect(parts.map((p) => p.label)).toEqual(["Kulutus", "Velanhoito", "Säästöön", "Yli jäi"]);
    expect(new Set(parts.map((p) => p.color)).size).toBe(4);
  });

  it("what stayed is not drawn in the colour of the income in the cash flow chart under it", () => {
    const income = /key: "income"[^}]*?color: "(var\(--series-\d\))"/.exec(source("pages/reports/sections/Cashflow.tsx"))?.[1];
    expect(income).toBeDefined();
    expect(bridgeParts(usual).map((p) => p.color)).not.toContain(income);
    // the strip over the bar shows the income in the colour that chart gives it
    expect(bridgeSources(period({ ...car, borrowed: 20_000 }))[0]).toMatchObject({ label: "Tulot", color: income });
    // the component takes its parts from the one list
    expect(source("components/SurplusBridge.tsx")).toContain("bridgeParts(");
  });

  it("a negative remainder is no segment, and savings taken out are none either", () => {
    const over = bridgeParts(period({ income: 4000, consumption: 4250, saved: -50 }));
    expect(over.find((p) => p.key === "left")!.cents).toBe(0);
    expect(over.find((p) => p.key === "saved")!.cents).toBe(0);
  });
});

describe("the bridge of a period that took more than its income", () => {
  it("a household that borrowed nothing, drew no savings and lived within its income sees the bridge as before", () => {
    expect(bridgeSources(usual)).toEqual([]);
    expect(bridgeText(usual)).toEqual({ gap: null, drawn: [] });
    const out = html(usual);
    expect(tiles(out)).toEqual(["Tulot 4 000 €", "Kulutus 2 500 €", "Velanhoito 400 €", "Säästöön 500 €", "Yli jäi 600 €"]);
    expect(out.match(/% tuloista/g)).toHaveLength(4);
    for (const absent of ["bridge-from", "bridge-gap", "bridge-drawn", "Katettu", "Luotto", "Jaksolla"]) expect(out).not.toContain(absent);
  });

  it("pay 3 000, a credit of 20 000, a car for 13 000: 10 000 covered with credit and 10 000 stayed", () => {
    const t = period({ ...car, borrowed: 20_000 });
    expect(t.leftCents).toBe(1_000_000);
    expect(said(t)).toBe(
      "Menoihin meni 10 000 € enemmän kuin tuloja tuli. Ero katettiin luotolla. Luottoa nostettiin 20 000 €, velanhoitoon ei mennyt mitään. Luotosta 10 000 € on mukana luvussa Yli jäi.",
    );
    const out = html(t);
    expect(tiles(out)).toEqual(["Tulot 3 000 €", "Kulutus 13 000 €", "Velanhoito 0 €", "Säästöön 0 €", "Katettu luotolla 10 000 €", "Yli jäi 10 000 €"]);
    expect(out).toContain("bridge-from");
    // what stayed is credit, so it is told as no share of the income
    expect(out.match(/% tuloista/g)).toHaveLength(3);
  });

  it("the debt service of the period stands beside the credit drawn under the tile's own word, and nothing is said of where the credit is", () => {
    const t = period({ income: 3000, consumption: 11_800, debt: 1200, borrowed: 20_000 });
    // with debt paid, how much of the credit is in Yli jäi is true by the order of the covers only
    expect(said(t)).toBe("Menoihin meni 10 000 € enemmän kuin tuloja tuli. Ero katettiin luotolla. Luottoa nostettiin 20 000 €, velanhoitoon meni 1 200 €.");
    const out = html(t);
    expect(out).toContain("Luottoa nostettiin 20 000 €, velanhoitoon meni 1 200 €.");
    expect(tiles(out)).toContain("Velanhoito 1 200 €");
    for (const absent of ["velkoja", "mukana luvussa"]) expect(out).not.toContain(absent);
  });

  it("the same car with no credit: the third cover never says that money on an account paid, since a card may have carried the gap", () => {
    const t = period(car);
    expect(t.leftCents).toBe(-1_000_000);
    expect(said(t)).toBe("Menoihin meni 10 000 € enemmän kuin tuloja tuli. Ero katettiin tileillä olleilla rahoilla tai luottokortilla.");
    expect(tiles(html(t))).toEqual(["Tulot 3 000 €", "Kulutus 13 000 €", "Velanhoito 0 €", "Säästöön 0 €", "Tileiltä tai kortilta 10 000 €"]);
    // the demo household's October 2025: the current account grew by 419 € and 475 € more was owed on the card
    const demo = totalsOf([{ income: 395_000, consumption: 355_601, debt: 0, saved: 45_000, borrowed: 0 }]);
    expect(demo.leftCents).toBe(-5601);
    expect(said(demo)).toBe("Menoihin ja säästöön meni 56 € enemmän kuin tuloja tuli. Ero katettiin tileillä olleilla rahoilla tai luottokortilla.");
    const out = html(demo);
    expect(tiles(out)).toContain("Tileiltä tai kortilta 56 €");
    for (const claim of ["Katettu tililtä", "tilillä olleilla rahoilla.", "tililtä"]) expect(out).not.toContain(claim);
  });

  it("savings drawn and credit in one month: credit is counted first, and each cover has its sum", () => {
    const t = period({ income: 3000, consumption: 10_000, saved: -4000, borrowed: 5000 });
    expect(t.leftCents).toBe(200_000);
    // one tense in the two lines that stand under each other
    expect(said(t)).toBe(
      "Menoihin meni enemmän kuin tuloja tuli. Luotolla katettiin 5 000 € ja säästöistä 2 000 €. Luottoa nostettiin 5 000 €, velanhoitoon ei mennyt mitään. Säästöistä nostettiin 4 000 €, ja siitä 2 000 € on mukana luvussa Yli jäi.",
    );
    expect(tiles(html(t))).toEqual(["Tulot 3 000 €", "Kulutus 10 000 €", "Velanhoito 0 €", "Katettu luotolla 5 000 €", "Katettu säästöistä 2 000 €", "Yli jäi 2 000 €"]);
  });

  it("a credit drawn and paid back inside the month: both sums stand side by side, and no credit is said to be in Yli jäi", () => {
    const t = period({ income: 3000, debt: 20_000, borrowed: 20_000 });
    expect(t.leftCents).toBe(300_000);
    expect(said(t)).toBe("Menoihin meni 17 000 € enemmän kuin tuloja tuli. Ero katettiin luotolla. Luottoa nostettiin 20 000 €, velanhoitoon meni 20 000 €.");
  });

  it("credit, savings and the accounts together are told in one sentence", () => {
    const t = period({ income: 3000, consumption: 9000, saved: -1000, borrowed: 2000 });
    expect(t.leftCents).toBe(-300_000);
    expect(bridgeText(t).gap && plain(bridgeText(t).gap!)).toBe("Menoihin meni enemmän kuin tuloja tuli. Luotolla katettiin 2 000 €, säästöistä 1 000 € ja tileiltä tai kortilta 3 000 €.");
  });

  it("money put aside is named with the spending it was short for", () => {
    expect(said(period({ income: 3000, consumption: 2800, saved: 700 }))).toBe("Menoihin ja säästöön meni 500 € enemmän kuin tuloja tuli. Ero katettiin tileillä olleilla rahoilla tai luottokortilla.");
  });

  it("savings drawn in a month the income paid for are in Yli jäi, as before", () => {
    const t = period({ income: 4000, consumption: 2500, saved: -500 });
    expect(said(t)).toBe("Säästöistä nostettiin 500 €, ja se on mukana luvussa Yli jäi.");
    expect(tiles(html(t))).toEqual(["Tulot 4 000 €", "Kulutus 2 500 €", "Velanhoito 0 €", "Yli jäi 2 000 €"]);
  });

  it("credit drawn in a month the income paid for is told as credit that stayed, unless debt was paid too", () => {
    const t = period({ income: 4000, consumption: 2500, borrowed: 6000 });
    expect(said(t)).toBe("Luottoa nostettiin 6 000 €, velanhoitoon ei mennyt mitään. Nostettu luotto on mukana luvussa Yli jäi.");
    expect(bridgeFigures(t).some((f) => f.key === "credit")).toBe(false);
    expect(said(period({ income: 4000, consumption: 2500, debt: 1000, borrowed: 6000 }))).toBe("Luottoa nostettiin 6 000 €, velanhoitoon meni 1 000 €.");
  });

  it("a period with no income has no bar and no shares, and still tells how it was paid and what stayed", () => {
    // a credit of 20 000 and a car for 13 000 with no pay in the period
    const t = period({ consumption: 13_000, borrowed: 20_000 });
    const out = html(t);
    expect(out).toContain("Jaksolla ei ole tuloja.");
    expect(out).toContain("Menot katettiin luotolla.");
    expect(out).toContain("Luottoa nostettiin 20 000 €, velanhoitoon ei mennyt mitään. Luotosta 7 000 € on mukana luvussa Yli jäi.");
    expect(cells(out)).toEqual(["Tulot 0 €", "Luottoa nostettu 20 000 €", "Kulutus 13 000 €", "Velanhoito 0 €", "Säästöön 0 €", "Yli jäi 7 000 €"]);
    for (const absent of ["bridge-bar", "bridge-from", "bridge-legend", "tuloista", "enemmän kuin tuloja", "<button"]) expect(out).not.toContain(absent);
    // several covers, each with its sum, and money set aside named with the spending
    expect(said(period({ consumption: 9000, saved: -1000, borrowed: 2000 }))).toContain("Menoista katettiin luotolla 2 000 €, säästöistä 1 000 € ja tileiltä tai kortilta 6 000 €.");
    expect(said(period({ consumption: 500, debt: 100, saved: 200, borrowed: 2000 }))).toBe("Menot ja säästöön siirretyt rahat katettiin luotolla. Luottoa nostettiin 2 000 €, velanhoitoon meni 100 €.");
    // a period with nothing in it says only that
    const empty = html(period({}));
    expect(empty).toContain("Jaksolla ei ole tuloja.");
    expect(empty).not.toContain("<table");
  });

  it("a part below zero has no place on a bar: refunds above purchases are told by the table, signed and one sum", () => {
    // income 3 000, refunds 100 above purchases, a credit of 1 000: a strip of 4 000 over a bar of 4 100 would be two sums
    const t = period({ income: 3000, consumption: -100, borrowed: 1000 });
    expect(t.leftCents).toBe(410_000);
    expect(bridgeDraws(t)).toBe(false);
    const out = html(t);
    expect(cells(out)).toEqual(["Tulot 3 000 €", "Luottoa nostettu 1 000 €", "Kulutus -100 €", "Velanhoito 0 €", "Säästöön 0 €", "Yli jäi 4 100 €"]);
    for (const absent of ["bridge-bar", "bridge-from", "bridge-legend", "tuloista", "%", "<button"]) expect(out).not.toContain(absent);
    expect(bridgeDraws(period({ income: -500, consumption: 1000 }))).toBe(false);
    expect(bridgeDraws(period({ income: 3000, debt: -50 }))).toBe(false);
    expect(bridgeDraws(usual)).toBe(true);
    expect(html(usual)).toContain("bridge-bar");
  });

  it("never says more was spent than earned without saying how, and never calls borrowed money income", () => {
    const cases = [period(car), period({ ...car, borrowed: 20_000 }), period({ ...car, borrowed: 4000 }), period({ income: 3000, consumption: 10_000, saved: -4000, borrowed: 5000 })];
    for (const t of cases) {
      const text = bridgeText(t);
      expect(text.gap).toMatch(/katettiin/);
      // the income of the bridge is the income alone
      expect(bridgeFigures(t)[0]).toMatchObject({ label: "Tulot", cents: t.incomeCents });
      for (const l of text.drawn.filter((d) => d.key === "credit")) expect(`${l.text} ${l.stayed ?? ""}`).not.toMatch(/tulo/i);
      // text wears the text colour: a gap is a fact of the period, not an alarm
      expect(html(t)).not.toContain("Menoja");
    }
    expect(source("styles/month.css")).not.toMatch(/\.bridge-(gap|drawn)[^}]*--bad/);
  });

  it("is one sum to the cent: the strip, the bar, the covers and the table rows", () => {
    // made-up sums with cents in them, over every shape: a gap or none, credit drawn or paid back, savings in or out,
    // refunds above purchases and income taken back
    let seed = 7;
    const next = (max: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % max;
    };
    let drawn = 0;
    let tables = 0;
    for (let i = 0; i < 600; i++) {
      const t = totalsOf([
        {
          income: next(8) ? next(600_000) : next(3) ? 0 : -next(50_000),
          consumption: next(8) ? next(900_000) : -next(40_000),
          debt: next(4) ? next(150_000) : 0,
          saved: next(3) ? next(400_000) - 200_000 : 0,
          borrowed: next(2) ? next(2_500_000) - 100_000 : 0,
        },
      ]);
      const parts = bridgeParts(t);
      const sources = bridgeSources(t);
      const rows = bridgeRows(t);
      const needed = sum(parts.filter((p) => p.key !== "left"));
      // what came in less what went out is Yli jäi, the last row
      expect(sum(rows.filter((r) => r.side === "in")) - sum(rows.filter((r) => r.side === "out"))).toBe(t.leftCents);
      expect(rows.filter((r) => r.side === "stayed")).toEqual([expect.objectContaining({ key: "left", label: "Yli jäi", cents: t.leftCents })]);
      expect(rows.at(-1)!.key).toBe("left");
      if (!bridgeDraws(t)) {
        // no bar, so nothing is told as a share of the income
        tables++;
        expect(rows.some((r) => r.ofIncome)).toBe(false);
        continue;
      }
      drawn++;
      // what is drawn: a part with no money has no segment, and none is below zero
      const shown = (list: { cents: number }[]) => sum(list.filter((p) => p.cents > 0));
      for (const p of [...parts, ...sources]) expect(p.cents).toBeGreaterThanOrEqual(0);
      if (!sources.length) {
        // the income was all the money: the bar is the income
        expect(shown(parts)).toBe(t.incomeCents);
        continue;
      }
      expect(shown(sources)).toBe(shown(parts));
      const cover = sum(sources.filter((p) => p.key === "credit" || p.key === "savings" || p.key === "accounts"));
      const stayed = sum(sources.filter((p) => p.key === "credit-left" || p.key === "savings-left"));
      if (cover > 0) expect(t.incomeCents + cover).toBe(needed);
      // drawn money that paid for nothing is in what stayed, and the accounts cover only what went below zero
      expect(stayed).toBeLessThanOrEqual(Math.max(0, t.leftCents));
      expect(sources.find((p) => p.key === "accounts")!.cents).toBe(Math.max(0, -t.leftCents));
      expect(sources.find((p) => p.key === "credit")!.cents).toBeLessThanOrEqual(Math.max(0, t.borrowedCents));
    }
    expect(Math.min(drawn, tables)).toBeGreaterThan(50);
  });

  it("the table is the sum row by row, and its last row is Yli jäi, signed, with whether it is a share of the income", () => {
    const t = period({ ...car, borrowed: 4000 });
    expect(bridgeRows(t).map((r) => `${r.side} ${r.label}`)).toEqual(["in Tulot", "in Luottoa nostettu", "out Kulutus", "out Velanhoito", "out Säästöön", "stayed Yli jäi"]);
    expect(bridgeRows(t).at(-1)).toMatchObject({ cents: -600_000, ofIncome: false });
    expect(bridgeRows(period({ income: 4000, consumption: 2500, saved: -500 })).map((r) => `${r.label} ${r.ofIncome}`)).toEqual(["Tulot true", "Säästöistä nostettu false", "Kulutus true", "Velanhoito true", "Yli jäi false"]);
    expect(bridgeRows(usual).map((r) => `${r.label} ${r.ofIncome}`)).toEqual(["Tulot true", "Kulutus true", "Velanhoito true", "Säästöön true", "Yli jäi true"]);
    // the tile and the row of Yli jäi say the same
    expect(bridgeFigures(usual).at(-1)).toMatchObject({ key: "left", ofIncome: true });
    expect(bridgeFigures(period({ ...car, borrowed: 20_000 })).at(-1)).toMatchObject({ key: "left", ofIncome: false });
  });

  it("the views hold no sum of their own: the remainders come from coverOf, and the component prints the rows and lines as given", () => {
    // no sum is added to or taken from another outside the owner
    expect(source("components/month-parts.ts")).not.toMatch(/Cents\s*[-+]\s*[\w(]/);
    const component = source("components/SurplusBridge.tsx");
    expect(component).not.toMatch(/Cents\s*[-+]\s*[\w(]/);
    expect(component).not.toMatch(/\bleft\b\s*[<>]=?|stayed:\s*null|\.key === "(income|repaid|credit)"/);
  });
});
