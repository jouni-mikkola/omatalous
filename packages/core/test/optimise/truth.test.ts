/**
 * Säästövinkit says only what it read: the car's cost holds a lease and shows a car bought apart from the running
 * cost, the other insights stand on the window of the findings and not on the first days of a month, and a check that
 * had no row to read is counted apart and not as looked at.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../../src/analysis/context.ts";
import { answeredInsights, insightDismissSubject, insightInputOf } from "../../src/analysis/insights/index.ts";
import { type AreaView, buildOptimise, type OptimiseData } from "../../src/optimise/index.ts";
import type { MarkKind, UserMark } from "../../src/types.ts";
import { randomHistory } from "../gen.ts";
import { tx } from "../helpers.ts";
import { enrich, FRAME, household, householdInput, joinHousehold, PARTS, type PartHousehold } from "./household.ts";
import * as car from "./parts/car.ts";
import { rowsOf } from "./parts/tax.ts";

const run = (...parts: PartHousehold[]) => buildOptimise(householdInput(joinHousehold(parts)));
const carOf = (data: OptimiseData): AreaView => data.areas.find((a) => a.id === "car")!;
const euros = (value: string | undefined) => Number((value ?? "").replace(/\D/g, ""));
/** The value of the summary line whose label starts with `label`. */
const line = (data: OptimiseData, label: string) => carOf(data).summary?.lines.find((l) => l.label.startsWith(label))?.value;
const mark = (subject: string, kind: MarkKind): UserMark => ({ subject, mark: kind, markedAt: "2026-10-10T12:00:00" });

const BASE = car.hit(FRAME);
const lease = (cents?: number): PartHousehold => ({ txs: rowsOf("lease", car.lease(FRAME, cents)) });
const dealer = (cents?: number, parts?: number): PartHousehold => ({ txs: rowsOf("dealer", car.dealer(FRAME, cents, parts)) });
const loan: PartHousehold = { txs: rowsOf("loan", car.carLoan(FRAME)) };

describe("the car's cost reads the rows that belong to it", () => {
  const base = run(BASE);

  it("puts a lease on its own line and in the monthly cost", () => {
    expect(line(base, "Leasing")).toBeUndefined();
    const data = run(BASE, lease());
    expect(euros(line(data, "Leasing"))).toBe(12 * 380);
    expect(euros(line(data, "Yhteensä")) - euros(line(base, "Yhteensä"))).toBe(12 * 380);
    // the yearly figure behind the cost per kilometre grows with it: 12 000 km
    expect(euros(line(data, "Kilometriltä"))).toBeGreaterThan(euros(line(base, "Kilometriltä")));
  });

  it("shows a car bought once apart, and the running cost stays what it was", () => {
    expect(line(base, "Auton osto")).toBeUndefined();
    const data = run(BASE, dealer());
    expect(euros(line(data, "Auton osto"))).toBe(15_000);
    expect(line(data, "Yhteensä")).toBe(line(base, "Yhteensä"));
    expect(line(data, "Kilometriltä")).toBe(line(base, "Kilometriltä"));
    // apart: the purchase comes after the total, so no reader takes it for a part of it
    const labels = carOf(data).summary!.lines.map((l) => l.label);
    expect(labels.findIndex((l) => l.startsWith("Auton osto"))).toBeGreaterThan(labels.indexOf("Yhteensä"));
  });

  it("adds a down payment and the balance into the one purchase, and takes a trade-in the dealer paid in off it", () => {
    const tradeIn: PartHousehold = { txs: rowsOf("trade", [{ merchant: "Esimerkki Autoliike Oy", counterparty: "ESIMERKKI AUTOLIIKE OY", description: "VAIHTOAUTO", bookingDate: "2026-02-03", amountCents: 300_000 }]) };
    expect(euros(line(run(BASE, dealer(1_500_000, 2)), "Auton osto"))).toBe(15_000);
    // money back from the same payee is a refund of the payment, as everywhere else (netCost)
    const data = run(BASE, dealer(1_500_000, 2), tradeIn);
    expect(euros(line(data, "Auton osto"))).toBe(12_000);
    expect(line(data, "Yhteensä")).toBe(line(base, "Yhteensä"));
  });

  it("keeps Rahoitus as it was for a car loan, and counts a row on one line", () => {
    const data = run(BASE, loan);
    expect(euros(line(data, "Rahoitus"))).toBe(12 * 290);
    expect(line(data, "Leasing")).toBeUndefined();
    const parts = carOf(data).summary!.lines.filter((l) => !/^(Yhteensä|Ajokilometrit|Kilometriltä|Auton osto)/.test(l.label));
    expect(parts.reduce((s, l) => s + euros(l.value), 0)).toBe(euros(line(data, "Yhteensä")));
    // a household with all four: the lines still add up to the total
    const all = run(BASE, loan, lease(), dealer());
    const lines = carOf(all).summary!.lines.filter((l) => !/^(Yhteensä|Ajokilometrit|Kilometriltä|Auton osto)/.test(l.label));
    expect(lines.reduce((s, l) => s + euros(l.value), 0)).toBe(euros(line(all, "Yhteensä")));
    expect(euros(line(all, "Rahoitus"))).toBe(12 * 290);
  });

  it("has no car summary for a household with no car row, and the area is not counted as looked at", () => {
    const data = run();
    const view = carOf(data);
    expect(view.summary).toBeUndefined();
    expect(view.checks.map((c) => `${c.id}:${c.status}`)).toEqual(["car:cost:no_rows"]);
    expect(data.checked.noRows).toBe(1);
    // looked at: what ran, found or found nothing
    const ran = data.areas.flatMap((a) => a.checks).filter((c) => c.status === "finding" || c.status === "clear").length;
    expect(data.checked.total - data.checked.unavailable - data.checked.noRows - data.checked.noSubject).toBe(ran);
  });
});

/** A service charged on one day of the given months, 12,99 € each: the overview's "Uusi toistuva maksu" once it has three. */
const service = (months: string[], day = "05"): PartHousehold => ({
  txs: months.map((m) => tx({ bookingDate: `${m}-${day}`, amountCents: -1299, merchant: "Viaplay", description: "VIAPLAY", accountId: "h-chk" })),
});
/** The same household judged on a day of October: the 20th's charge is in the rows only once the 20th has come. */
const insightsOn = (today: string) => {
  const frame = { ...FRAME, today };
  return buildOptimise(householdInput(joinHousehold([car.hit(frame), service(["2026-07", "2026-08", "2026-09", ...(today >= "2026-10-20" ? ["2026-10"] : [])], "20")], frame)));
};

describe("the other insights stand on the window of the findings", () => {
  it("are the same list with the same figures on the 2nd of a month and on the 28th", () => {
    const [early, late] = [insightsOn("2026-10-02"), insightsOn("2026-10-28")];
    const figures = (data: OptimiseData) => data.others.map((i) => `${i.id} ${i.yearlyCents}`);
    expect(figures(early)).toContain("new:out:h-chk:Viaplay 15588");
    expect(figures(early).length).toBeGreaterThan(1);
    expect(figures(early)).toEqual(figures(late));
    expect(early.months).toBe(12);
  });

  it("keep a dismissal made before the change, unless the figure moved over 25 %", () => {
    // charged in the running month too, so the running month up to today holds the insight
    const input = householdInput(joinHousehold([car.hit(FRAME), service(["2026-08", "2026-09", "2026-10"])]));
    // the insights of the running month up to today, each with its figure of that window
    const before = answeredInsights(insightInputOf(input.ctx, { from: "2026-10-01", to: FRAME.today }, input.inputs!)).map((a) => a.insight);
    expect(before.length).toBeGreaterThan(0);
    let compared = 0;
    for (const old of before) {
      const data = buildOptimise({ ...input, inputs: { marks: [mark(insightDismissSubject(old), "dismissed")], expectedBills: [] } });
      const now = [...data.others, ...data.othersDismissed.map((d) => d.insight)].find((i) => i.id === old.id);
      // an insight the new window does not hold has nothing to keep
      if (!now) continue;
      compared += 1;
      const moved = Math.abs(now.yearlyCents - old.yearlyCents) / old.yearlyCents;
      expect(
        data.othersDismissed.some((d) => d.insight.id === old.id),
        `${old.id}: ${old.yearlyCents} then, ${now.yearlyCents} now`,
      ).toBe(moved < 0.25);
    }
    expect(compared).toBeGreaterThan(0);
    // and the rule itself, at the figure of the new window: 20 % off it stays, 30 % off it returns
    const now = buildOptimise(input).others.find((i) => i.id === "new:out:h-chk:Viaplay")!;
    const dismissedAt = (cents: number) => buildOptimise({ ...input, inputs: { marks: [mark(`alert:${now.id}@${cents}`, "dismissed")], expectedBills: [] } });
    expect(dismissedAt(Math.round(now.yearlyCents / 1.2)).othersDismissed.map((d) => d.insight.id)).toEqual([now.id]);
    expect(dismissedAt(Math.round(now.yearlyCents / 1.3)).others.map((i) => i.id)).toContain(now.id);
  });
});

describe("what was checked adds up", () => {
  const homes: [string, PartHousehold[]][] = [
    ["every part together", []],
    ...Object.entries(PARTS).flatMap(([id, part]) => [[`${id} hit`, [part.hit(FRAME)]] as [string, PartHousehold[]], ...part.nearMiss(FRAME).map((n, i): [string, PartHousehold[]] => [`${id} near miss ${i}`, [n]])]),
    ["a lease and a car bought", [BASE, lease(), dealer()]],
    ["no car", []],
  ];

  function adds(label: string, data: OptimiseData) {
    const checks = data.areas.flatMap((a) => a.checks);
    const n = (...statuses: string[]) => checks.filter((c) => statuses.includes(c.status)).length;
    // findings, clean, waiting and no data: nothing counted twice and nothing left out
    expect(data.checked.total, label).toBe(n("finding") + n("clear") + n("needs_input", "no_data") + n("no_rows") + n("no_subject"));
    expect(data.checked.total, label).toBe(checks.length);
    expect(data.checked.unavailable, label).toBe(n("needs_input", "no_data"));
    expect(data.checked.noRows, label).toBe(n("no_rows"));
    expect(data.checked.noSubject, label).toBe(n("no_subject"));
  }

  it("holds for every household of the optimise tests", () => {
    for (const [label, parts] of homes) adds(label, label === "every part together" ? buildOptimise(householdInput(household())) : run(...parts));
  }, 30_000); // about 1 s alone, but the default 5 s is lost when several suites run: a red must mean a bug

  it("holds for random households", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { txs, accounts, rules } = randomHistory(seed, 600);
      adds(`seed ${seed}`, buildOptimise({ ctx: createContext(enrich(txs, accounts, rules), accounts, "2025-11-15"), balances: [] }));
    }
  }, 30_000); // random households take longer when several suites run: a red must mean a bug
});
