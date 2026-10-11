/**
 * O6: Ruoka, Pienet tavat and Vuosimenot on the base household with their parts. Each near miss stays quiet, and the
 * sibling without its guard fires, so the test shows which rule keeps it quiet. The figures shown are the calc lines.
 */
import { describe, expect, it } from "vitest";
import { buildAlerts, habitItems } from "../../src/analysis/alerts.ts";
import { gateMonthly } from "../../src/analysis/insights/shared.ts";
import { expensiveMonths } from "../../src/analysis/insights/seasons.ts";
import type { InsightArgs } from "../../src/analysis/insights/types.ts";
import { addDays, monthRange, weekdayOf } from "../../src/dates.ts";
import { food } from "../../src/optimise/areas/food.ts";
import { habits } from "../../src/optimise/areas/habits.ts";
import { seasons } from "../../src/optimise/areas/seasons.ts";
import { allFindings, type Area, areaInputOf, buildOptimise, type FindingDraft } from "../../src/optimise/index.ts";
import { createContext } from "../../src/analysis/context.ts";
import { randomHistory, rng } from "../gen.ts";
import { enrich, FRAME, type Frame, householdInput, joinHousehold, type PartHousehold } from "./household.ts";
import * as F from "./parts/food.ts";
import * as H from "./parts/habits.ts";
import * as S from "./parts/seasons.ts";

const AREAS: readonly Area[] = [food, habits, seasons];

function run(parts: readonly PartHousehold[], frame: Frame = FRAME) {
  const input = householdInput(joinHousehold(parts, frame));
  const a = areaInputOf(input);
  const results = AREAS.map((area) => area.assess(a));
  return { input, a, findings: results.flatMap((r) => r.findings).map(plainText), checks: results.flatMap((r) => r.checks) };
}

/** The texts with plain spaces in place of the no-break spaces of Finnish number formats, so the tests read as written. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const plainText = (f: FindingDraft): FindingDraft => ({
  ...f,
  title: plain(f.title),
  action: plain(f.action),
  calc: f.calc.map((c) => ({ ...c, label: plain(c.label), value: plain(c.value) })),
});

const ids = (parts: readonly PartHousehold[], frame: Frame = FRAME) => run(parts, frame).findings.map((f) => f.id).sort();
const byId = (findings: readonly FindingDraft[], id: string) => findings.find((f) => f.id === id)!;
const calcValue = (f: FindingDraft, label: RegExp) => f.calc.find((c) => label.test(c.label))!.value;
/** "1 234 €" or "29,92 €" in cents. */
const cents = (value: string) => Math.round(Number(value.replace(/[^\d,]/g, "").replace(",", ".")) * 100);
const count = (value: string) => Number(value.replace(/[^\d,]/g, "").replace(",", "."));

const LONG: Frame = { ...FRAME, start: "2023-10-01", months: monthRange("2023-10", "2026-09") };
const SHORT: Frame = { ...FRAME, start: "2025-06-01", months: monthRange("2025-06", "2026-09") };

describe("Ruoka", () => {
  const { input, findings } = run([F.hit(FRAME)]);
  const out = byId(findings, "food:eating_out");
  const wolt = byId(findings, "food:delivery:Wolt");

  it("prices eating out from the medians a year apart and Wolt from its orders", () => {
    expect(findings.map((f) => f.id).sort()).toEqual(["food:delivery:Wolt", "food:eating_out"]);
    const now = cents(calcValue(out, /^Huhti–syyskuu 2026/));
    const then = cents(calcValue(out, /^Huhti–syyskuu 2025/));
    const cheapest = cents(calcValue(out, /^Kolmen edullisimman/));
    // the values are rounded to euros on the page, the euros come from the same cents
    expect(Math.abs(out.euros!.midCents - (now - then) * 12)).toBeLessThan(12 * 100);
    expect(out.euros!.lowCents).toBe(Math.round(out.euros!.midCents / 2));
    expect(Math.abs(out.euros!.highCents - Math.max(out.euros!.midCents, (now - cheapest) * 12))).toBeLessThan(12 * 100);
    expect(out.action).toBe(`Varaa ravintoloihin ja ruoan kotiinkuljetukseen ${calcValue(out, /^Huhti–syyskuu 2025/)} kuussa, kuten vuotta aiemmin.`);
    expect(out.weaknesses.map((w) => w.id)).toEqual(["estimate"]);

    expect(calcValue(wolt, /2026, kertaa/)).toBe("8");
    expect(calcValue(wolt, /2025, kertaa/)).toBe("3");
    const ticket = cents(calcValue(wolt, /^Keskiostos/));
    expect(Math.abs(wolt.euros!.midCents - 5 * ticket * 12)).toBeLessThanOrEqual(12);
    expect(wolt.title).toMatch(/^Wolt: 8 kertaa kuussa, vuotta aiemmin 3\. Keskiostos /);
    // tilaus is a subscription in this app: a delivery order is counted in kertaa
    expect(JSON.stringify([wolt.title, wolt.action, wolt.euros!.assumption, wolt.calc])).not.toMatch(/tilau/i);
  });

  it("strikes the party dinner and lists it", () => {
    const party = input.ctx.txs.find((t) => t.merchant === "Kotipizza" && t.amountCents === -32000)!;
    expect(out.struck).toEqual([party.id]);
    expect(out.rows).toContain(party.id);
    expect(out.calc.find((c) => c.struck)).toMatchObject({ label: "Kertaosto Kotipizza 13.6.2026", value: "320,00 €" });
  });

  it("counts the overlap of eating out and delivery once, and Wolt is korkea", () => {
    const data = buildOptimise({ ...input, areas: AREAS });
    const shown = allFindings(data);
    expect(shown.find((f) => f.id === "food:eating_out")!.certainty.level).toBe("keskitaso");
    expect(shown.find((f) => f.id === "food:delivery:Wolt")!.certainty.level).toBe("korkea");
    expect(data.headline.count).toBe(1);
    expect(data.headline.midCents).toBe(Math.max(out.euros!.midCents, wolt.euros!.midCents));
  });

  it("leaves MobilePay to a friend out of food even when it was filed under restaurants", () => {
    const { add, out: rows } = F.rows("friend");
    for (const month of FRAME.months.slice(-6))
      for (const date of F.spread(month, 4))
        add({ bookingDate: date, amountCents: -9000, merchant: "Liisa Virtanen", counterparty: "LIISA VIRTANEN", description: "MOBILEPAY", category: "restaurants", categorySource: "user" });
    const again = run([F.hit(FRAME), { txs: rows }]).findings;
    expect(byId(again, "food:eating_out").euros).toEqual(out.euros);
  });

  it("stays quiet on its near misses, and each fires without its guard", () => {
    for (const near of F.nearMiss(FRAME)) expect(ids([near])).toEqual([]);
    expect(ids([F.noisyRise(FRAME, true)])).toEqual(["food:eating_out"]);
    expect(ids([F.partyMonths(FRAME, 8000)])).toEqual(["food:eating_out"]);
    expect(ids([F.deliverySwitch(FRAME, true)])).toEqual(["food:delivery:Wolt", "food:eating_out"]);
    expect(ids([F.friendViaMobilePay(FRAME, "restaurant")])).toEqual(["food:eating_out"]);
    expect(ids([F.newCard(FRAME, "start")])).toEqual(["food:eating_out"]);
  });

  it("needs 18 complete months", () => {
    const { findings: none, checks } = run([F.hit(SHORT)], SHORT);
    expect(none.filter((f) => f.area === "food")).toEqual([]);
    expect(checks.filter((c) => c.id.startsWith("food:")).map((c) => c.status)).toEqual(["no_data", "no_data"]);
  });
});

describe("Pienet tavat", () => {
  const { input, a, findings } = run([H.hit(FRAME)]);
  const kiosk = byId(findings, "habits:repeat:R-Kioski Kamppi");

  it("prices the rise of the visits against a year earlier with the mean ticket", () => {
    expect(findings.map((f) => f.id)).toEqual(["habits:repeat:R-Kioski Kamppi"]);
    expect(calcValue(kiosk, /^Huhti–syyskuu 2026, kertaa kuussa tavallisesti/)).toBe("14");
    expect(calcValue(kiosk, /^Huhti–syyskuu 2025, kertaa kuussa tavallisesti/)).toBe("8");
    const ticket = cents(calcValue(kiosk, /^Keskiostos/));
    expect(kiosk.euros).toMatchObject({ midCents: 6 * ticket * 12, lowCents: 3 * ticket * 12, highCents: 6 * ticket * 12 });
    expect(kiosk.euros!.assumption).toBe("Jos käyntejä on yhtä monta kuin vuotta aiemmin.");
    expect(kiosk.title).toMatch(/^R-Kioski Kamppi: 14 kertaa kuussa, vuotta aiemmin 8\. Keskiostos \d+,\d\d €, huhti–syyskuu 2026 verrattuna samaan aikaan vuotta aiemmin\.$/);
    expect(kiosk.action).toBe("Tarkista käyntien määrä: vuotta aiemmin 8 kertaa kuussa.");
    expect(kiosk.weaknesses).toEqual([]);
  });

  it("names the merchant the habit alert names", () => {
    const alerts = buildAlerts(input.ctx, { from: addDays(a.end, -89), to: a.end });
    expect(alerts.filter((x) => x.kind === "habit").map((x) => x.merchant)).toEqual(["R-Kioski Kamppi"]);
  });

  it("is one step lower when the visits fall on weekdays", () => {
    const recent = H.recentMonths(FRAME);
    const { add, out } = F.rows("work");
    let k = 0;
    for (const month of FRAME.months) {
      const days = Array.from({ length: 28 }, (_, d) => F.on(month, d + 1)).filter((d) => weekdayOf(d) < 5);
      for (const date of days.slice(0, recent.has(month) ? 16 : 8)) add({ bookingDate: date, amountCents: -(420 + ((k++ * 97) % 240)), merchant: "R-Kioski Kamppi", description: "R-KIOSKI KAMPPI", mcc: "5411" });
    }
    const work = run([{ txs: out }]);
    const draft = byId(work.findings, "habits:repeat:R-Kioski Kamppi");
    expect(draft.weaknesses.map((w) => w.reason)).toEqual(["Osa voi olla työpäivän ostoksia."]);
    const shown = allFindings(buildOptimise({ ...work.input, areas: AREAS }));
    expect(shown.find((f) => f.id === draft.id)!.certainty.level).toBe("keskitaso");
  });

  it("stays quiet on its near misses, and each fires without its guard", () => {
    for (const near of H.nearMiss(FRAME)) expect(ids([near])).toEqual([]);
    expect(ids([H.mild(FRAME, 9)])).toEqual(["habits:repeat:R-Kioski Kamppi"]);
    expect(ids([H.small(FRAME, 500)])).toEqual(["habits:repeat:R-Kioski Kamppi"]);
    expect(ids([H.moved(FRAME, true)])).toEqual(["habits:repeat:R-Kioski Kamppi"]);
  });

  it("makes no finding of a steady habit, with its noise and a summer away in both years", () => {
    const loud: string[] = [];
    let candidates = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const r = rng(seed);
      const rate = 6 + (seed % 15);
      // every other kiosk swings more than chance: its monthly rate is drawn from a gamma of mean 1 and CV 0,58
      const swing = () => (seed % 2 ? 1 : -(Math.log(r()) + Math.log(r()) + Math.log(r())) / 3);
      const { add, out } = F.rows(`steady${seed}`);
      let k = 0;
      for (const month of FRAME.months) {
        // three weeks away every July: visits only on the first ten days
        const days = month.endsWith("-07") ? 10 : 28;
        const n = poisson((rate * days * swing()) / 30, r);
        for (let i = 0; i < n; i++) add({ bookingDate: F.on(month, 1 + Math.floor(r() * days)), amountCents: -(420 + ((k++ * 97) % 240)), merchant: "R-Kioski Kamppi", description: "R-KIOSKI KAMPPI", mcc: "5411" });
      }
      const steady = areaInputOf(householdInput(joinHousehold([{ txs: out }])));
      // the alert names most of them, so each is a candidate the gate has to turn down
      if (habitItems(steady.ctx, { from: addDays(steady.end, -89), to: steady.end }).length) candidates += 1;
      for (const f of habits.assess(steady).findings) loud.push(`${seed}: ${f.title}`);
    }
    expect(candidates).toBeGreaterThan(50);
    expect(loud).toEqual([]);
  });

  it("needs 18 complete months", () => {
    const { checks } = run([H.hit(SHORT)], SHORT);
    expect(checks.find((c) => c.id === "habits:repeat")!.status).toBe("no_data");
  });
});

/** A Poisson draw by inversion: the count of visits in a month at `rate`. */
function poisson(rate: number, r: () => number): number {
  let k = 0;
  let p = Math.exp(-rate);
  let sum = p;
  const u = r();
  while (u > sum && k < 200) {
    k += 1;
    p *= rate / k;
    sum += p;
  }
  return k;
}

describe("Vuosimenot", () => {
  const { input, findings } = run([S.hit(FRAME)]);
  const july = byId(findings, "seasons:month:07");

  it("prices July by the extra interest after it in both years, korkea", () => {
    expect(findings.map((f) => f.id)).toEqual(["seasons:month:07"]);
    expect(july.euros).toMatchObject({ lowCents: 15000, midCents: 15000, highCents: 15000 });
    expect(july.title).toMatch(/^Heinäkuu on ollut kahtena vuonna .+ tavallista kalliimpi\. Elo–syyskuussa korkoa maksettiin keskimäärin 150 € enemmän kuin touko–kesäkuussa\.$/);
    expect(july.action).toMatch(/^Maksa heinäkuun menot ilman luottoa: varaa \d+ € kuussa\.$/);
    expect(july.claims).toEqual(["category:interest"]);
    for (const id of july.rows) expect(input.ctx.txs.find((t) => t.id === id)!.isTransfer).toBe(false);
    const shown = allFindings(buildOptimise({ ...input, areas: AREAS }));
    expect(shown.find((f) => f.id === july.id)!.certainty.level).toBe("korkea");
  });

  it("tells the same excess as the seasons insight", () => {
    const { today } = input.ctx;
    const insight = expensiveMonths({ ctx: input.ctx, end: today, gateMonthlyCents: gateMonthly(input.ctx, today) } as InsightArgs)[0]!;
    const extra = calcValue(july, /^Keskimäärin yli tavallisen/);
    expect(plain(insight.title)).toBe(`Heinäkuu ${extra} tavallista kalliimpi kahtena vuonna`);
    expect(july.title).toContain(` ${extra} tavallista kalliimpi.`);
  });

  it("makes December a deadline with no euros when it starts within 60 days", () => {
    const dec = run([{ txs: S.decembers(LONG) }], LONG).findings;
    expect(dec.map((f) => f.id)).toEqual(["seasons:month:12"]);
    const f = dec[0]!;
    expect(f.euros).toBeNull();
    expect(f.decideBy).toBe("2026-12-01");
    const extra = cents(calcValue(f, /^Keskimäärin yli tavallisen/));
    expect(f.action).toBe(`Varaa joulukuun menoihin ${Math.ceil(extra / 1200)} € kuussa.`);
    expect(f.title).toMatch(/^Joulukuu on ollut kahtena vuonna .+ tavallista kalliimpi\. Joulukuussa 2025 lisämenot olivat .+ ja vuotta aiemmin .+, kertaostot pois lukien\.$/);
    expect(f.measure.kind).toBe("none");
  });

  it("needs the same cause in both years", () => {
    expect(ids([{ txs: S.decembers(LONG, "flights") }], LONG)).toEqual([]);
    expect(calcValue(run([{ txs: S.decembers(LONG) }], LONG).findings[0]!, /^Suurin lisä/)).toBe("Vaatteet ja ostokset");
  });

  it("prices no interest the household pays every month anyway", () => {
    const { add, out } = F.rows("revolving");
    for (const month of FRAME.months) add({ bookingDate: F.on(month, 27), amountCents: -7500, merchant: "Luottokorko", description: "LUOTTOKORKO" });
    expect(ids([S.noCredit(FRAME), { txs: out }])).toEqual([]);
  });

  it("stays quiet on its near misses, and fires with both years and the credit", () => {
    for (const near of S.nearMiss(FRAME)) expect(ids([near])).toEqual([]);
    expect(ids([S.hit(FRAME)])).toEqual(["seasons:month:07"]);
  });
});

describe("random households beyond the quiet test", () => {
  // each made a false finding under the insights' own bars: a 2,5 standard error rise in eating out, or two dear
  // months a year apart driven by loan payments on random days
  const cases: [number, number, { months: number; settled?: boolean }][] = [
    [130, 1500, { months: 30 }],
    [207, 1500, { months: 30 }],
    [130, 1500, { months: 30, settled: true }],
    [84, 1500, { months: 30 }],
    [212, 1500, { months: 30 }],
    [212, 3000, { months: 30 }],
    [227, 2500, { months: 40, settled: true }],
  ];
  it.each(cases)("seed %i with %i rows stays quiet", (seed, rows, opts) => {
    const { txs, accounts, rules } = randomHistory(seed, rows, opts);
    const a = areaInputOf({ ctx: createContext(enrich(txs, accounts, rules), accounts, "2025-11-15"), balances: [] });
    expect(AREAS.flatMap((area) => area.assess(a).findings.map((f) => f.id))).toEqual([]);
  });
});
