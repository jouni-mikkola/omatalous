/**
 * Verot, Lapset and Auto: the household deduction, the day-care fee against the statutory rise and parking against
 * the resident permit, each with its hit in exact euros and its near misses. Quiet on random households is in
 * quiet.test.ts with these parts' neutral inputs.
 */
import { describe, expect, it } from "vitest";
import { addMonths, monthOf, monthRange } from "../../src/dates.ts";
import { car } from "../../src/optimise/areas/car.ts";
import { kids } from "../../src/optimise/areas/kids.ts";
import { tax } from "../../src/optimise/areas/tax.ts";
import { type Area, areaInputOf, buildOptimise, optimiseEnd } from "../../src/optimise/index.ts";
import { ACCOUNTS, FRAME, type Frame, householdInput, joinHousehold, type PartHousehold } from "./household.ts";
import * as carPart from "./parts/car.ts";
import * as kidsPart from "./parts/kids.ts";
import * as taxPart from "./parts/tax.ts";
import { cleaning, rowsOf } from "./parts/tax.ts";

/** 24 complete months before `today`, as FRAME has before 15.10.2026. */
function frameAt(today: string): Frame {
  const months = monthRange(addMonths(monthOf(today), -24), addMonths(monthOf(today), -1));
  return { today, start: `${months[0]}-01`, end: optimiseEnd(today), months, accounts: ACCOUNTS };
}

const inputOf = (parts: PartHousehold[], frame: Frame = FRAME) => householdInput(joinHousehold(parts, frame));
const run = (area: Area, parts: PartHousehold[], frame: Frame = FRAME) => area.assess(areaInputOf(inputOf(parts, frame)));
const shown = (area: Area, parts: PartHousehold[], frame: Frame = FRAME) => buildOptimise({ ...inputOf(parts, frame), areas: [area] });
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const linesOf = (lines: readonly { label: string; value: string }[]) => Object.fromEntries(lines.map((c) => [plain(c.label), plain(c.value)]));
const calcOf = (f: { calc: readonly { label: string; value: string }[] }) => linesOf(f.calc);

describe("tax: household deduction", () => {
  it("is 35 % of the labour share less 150 €, with the proposal as a calc line only", () => {
    const [f, ...rest] = run(tax, [taxPart.hit(FRAME)]).findings;
    expect(rest).toEqual([]);
    expect(f!.id).toBe("tax:household_deduction:2026");
    // 1 720 € of cleaning and yard work in full, 2 000 € of renovation at 50, 75 and 100 %
    expect(f!.euros).toMatchObject({ lowCents: 80_200, midCents: 97_700, highCents: 115_200 });
    expect(plain(f!.title)).toBe("Kotitalousvähennys 977 € vuodelta 2026. Yrityksille maksettu 3 720 € töistä, jotka voivat oikeuttaa vähennykseen.");
    expect(calcOf(f!)).toMatchObject({
      "Siivous ja pihatyöt, työn osuus 100 %": "1 720 €",
      "Muut työt, työn osuus 50–100 %": "2 000 €",
      "Vähennys, vaihteluväli": "802–1 152 €",
      // 40 % of 3 220 € less 150 €; never in the euros
      "Jos esitys hyväksytään (40 %, enintään 2 100 €)": "1 138 €",
    });
    expect(f!.rows).toHaveLength(12);
    expect(f!.facts).not.toContain("household_deduction_proposed");
    const data = shown(tax, [taxPart.hit(FRAME)]);
    expect(data.areas[0]!.findings.map((x) => x.certainty)).toEqual([{ level: "keskitaso", reason: "Laskujen työn osuutta ei tiedetä." }]);
  });

  it("counts cleaning in full: 35 % of 1 080 € less 150 €", () => {
    const [f] = run(tax, [{ txs: rowsOf("c", cleaning(FRAME)) }]).findings;
    expect(f!.euros).toMatchObject({ lowCents: 22_800, midCents: 22_800, highCents: 22_800 });
  });

  it("stays quiet on a person paid for cleaning and on 280 € paid", () => {
    for (const near of taxPart.nearMiss(FRAME)) {
      const result = run(tax, [near]);
      expect(result.findings).toEqual([]);
      expect(result.checks).toEqual([{ id: "tax:household_deduction", label: "Kotitalousvähennys", status: "clear" }]);
    }
  });

  it("never treats a person as a business, even one the register lookup names; a company found by its industry counts", () => {
    const y = FRAME.end.slice(0, 4);
    const person = { merchant: "Matti Virtanen", counterparty: "MATTI VIRTANEN", counterpartyIban: "FI2112345600000786", description: "TYÖT" };
    const company = { merchant: "Kotipalvelu Nieminen Oy", counterparty: "KOTIPALVELU NIEMINEN OY", counterpartyIban: "FI7944052020036082", description: "LASKU 55" };
    const txs = rowsOf("ind", [
      { ...person, bookingDate: `${y}-03-10`, amountCents: -150_000 },
      { ...company, bookingDate: `${y}-04-10`, amountCents: -90_000 },
    ]);
    const [f, ...rest] = run(tax, [{ txs, industry: { "Matti Virtanen": "43220", "Kotipalvelu Nieminen Oy": "81210" } }]).findings;
    expect(rest).toEqual([]);
    // 35 % of 900 € less 150 €: the person's 1 500 € is not in it
    expect(f!.euros!.midCents).toBe(16_500);
    expect(f!.rows).toEqual(["ind-0001"]);
  });

  it("leaves out a materials shop named for renovation, by its card code or its industry", () => {
    const y = FRAME.end.slice(0, 4);
    const shop = { merchant: "Rautia Remonttipalvelu", description: "RAUTIA REMONTTIPALVELU" };
    const card = rowsOf("shop", [3, 5, 7].map((m) => ({ ...shop, mcc: "5211", bookingDate: `${y}-0${m}-15`, amountCents: -60_000 })));
    expect(run(tax, [{ txs: card }]).findings).toEqual([]);
    const invoice = rowsOf("inv", [3, 5, 7].map((m) => ({ ...shop, counterparty: "RAUTIA REMONTTIPALVELU OY", counterpartyIban: "FI5810171000000122", bookingDate: `${y}-0${m}-15`, amountCents: -60_000 })));
    expect(run(tax, [{ txs: invoice }]).findings).toHaveLength(1);
    expect(run(tax, [{ txs: invoice, industry: { "Rautia Remonttipalvelu": "47521" } }]).findings).toEqual([]);
  });

  it("counts a card purchase with the cleaning code", () => {
    const y = FRAME.end.slice(0, 4);
    const txs = rowsOf("mcc", [3, 6, 9].map((m) => ({ merchant: "Ikkunapojat", description: "IKKUNAPOJAT", mcc: "7349", bookingDate: `${y}-0${m}-15`, amountCents: -30_000 })));
    expect(run(tax, [{ txs }]).findings[0]!.euros!.midCents).toBe(16_500);
  });

  it("counts a payment in the year it was paid only, and shows last year until the end of May", () => {
    const frame = frameAt("2026-03-15");
    const cleaner = { merchant: "Puhdas Koti Oy", counterparty: "PUHDAS KOTI OY", counterpartyIban: "FI4950009420028730", description: "LASKU KOTISIIVOUS" };
    const txs = rowsOf("years", [
      ...monthRange("2025-01", "2025-11").map((m) => ({ ...cleaner, bookingDate: `${m}-10`, amountCents: -12_000 })),
      { ...cleaner, bookingDate: "2025-12-31", amountCents: -12_000 },
      { ...cleaner, bookingDate: "2026-01-05", amountCents: -80_000, description: "IKKUNANPESU" },
      { ...cleaner, bookingDate: "2026-02-10", amountCents: -12_000 },
    ]);
    const findings = run(tax, [{ txs }], frame).findings;
    expect(findings.map((f) => f.id)).toEqual(["tax:household_deduction:2025", "tax:household_deduction:2026"]);
    const [last, now] = findings;
    // 35 % of 1 440 € and of 920 €, less 150 € each
    expect([last!.euros!.midCents, now!.euros!.midCents]).toEqual([35_400, 17_200]);
    expect(last!.rows).toContain("years-0011");
    expect(now!.rows).not.toContain("years-0011");
    expect(last!.rows.filter((id) => now!.rows.includes(id))).toEqual([]);
    expect(run(tax, [{ txs }], frameAt("2026-06-15")).findings.map((f) => f.id)).toEqual(["tax:household_deduction:2026"]);
  });

  it("never counts a MobilePay payment to a person, also when it was booked as a card purchase", () => {
    const y = FRAME.end.slice(0, 4);
    const txs = rowsOf("mp", [3, 5, 7].map((m) => ({ merchant: "Maija Virtanen", description: "MOBILEPAY *MAIJA VIRTANEN SIIVOUS", mcc: "7349", bookingDate: `${y}-0${m}-15`, amountCents: -40_000 })));
    expect(run(tax, [{ txs }]).findings).toEqual([]);
    const korttiosto = rowsOf("ko", [3, 5, 7].map((m) => ({ merchant: "Maija Virtanen", description: "KORTTIOSTO MOBILEPAY MAIJA VIRTANEN SIIVOUS", bookingDate: `${y}-0${m}-15`, amountCents: -40_000 })));
    expect(run(tax, [{ txs: korttiosto }]).findings).toEqual([]);
  });

  it("sends the running year to next spring's pre-filled return and last year to the return now, both in the headline", () => {
    const frame = frameAt("2026-03-15");
    const cleaner = { merchant: "Puhdas Koti Oy", counterparty: "PUHDAS KOTI OY", counterpartyIban: "FI4950009420028730", description: "LASKU KOTISIIVOUS" };
    const txs = rowsOf("both", [
      ...monthRange("2025-01", "2025-12").map((m) => ({ ...cleaner, bookingDate: `${m}-10`, amountCents: -12_000 })),
      ...["2026-01", "2026-02"].map((m) => ({ ...cleaner, bookingDate: `${m}-10`, amountCents: -60_000 })),
    ]);
    const [last, now] = run(tax, [{ txs }], frame).findings;
    expect(last!.action).toBe("Tarkista, että vähennys on esitäytetyssä veroilmoituksessa, ja lisää se OmaVerossa, jos ei ole.");
    expect(now!.action).toBe("Tarkista keväällä 2027 esitäytetystä veroilmoituksesta, että vähennys on mukana, ja lisää se OmaVerossa, jos ei ole.");
    expect(last!.claims).toEqual(["merchant:Puhdas Koti Oy:2025"]);
    const data = shown(tax, [{ txs }], frame);
    // 35 % of 1 440 € and of 1 200 €, less 150 € each
    expect(data.headline).toMatchObject({ count: 2, midCents: 35_400 + 27_000 });
  });

  it("hides the comparison when the deduction rows have expired", () => {
    const frame = frameAt("2027-10-15");
    expect(run(tax, [{ txs: rowsOf("late", cleaning(frame)) }], frame).findings).toEqual([]);
  });
});

describe("kids: day-care fee", () => {
  const checkOf = (parts: PartHousehold[], frame: Frame = FRAME) => {
    const result = run(kids, parts, frame);
    expect(result.findings).toEqual([]);
    return result.checks;
  };

  it("states the August change and the maximum's in the check, with no finding and no euros", () => {
    expect(checkOf([kidsPart.hit(FRAME)])).toEqual([
      {
        id: "kids:daycare",
        label: "Päivähoitomaksun nousu",
        status: "clear",
        hint: "Maksu nousi elokuussa 280,00\u00a0€ → 322,00\u00a0€ (15,0\u00a0%). Enimmäismaksu nousi 7,7\u00a0%. Jos tulot tai hoitoaika eivät muuttuneet, tarkista maksupäätös.",
      },
    ]);
    const data = shown(kids, [kidsPart.hit(FRAME)]);
    expect(data.areas[0]!.findings).toEqual([]);
    expect(data.headline.count).toBe(0);
  });

  it("makes no finding for more care hours or a fee at the maximum", () => {
    // the reviewer's cases: 279,90 → 335 € (12 points over the maximum's rise) and the 80 → 90 % hour band
    for (const [old, fresh] of [
      [27_990, 33_500],
      [24_880, 30_150],
    ] as const) {
      const [check] = checkOf([{ txs: rowsOf(`hours-${old}`, kidsPart.daycare(FRAME, old, fresh)) }]);
      expect(check!.status).toBe("clear");
    }
    expect(plain(checkOf([{ txs: rowsOf("max", kidsPart.daycare(FRAME, 27_990, 33_500)) }])[0]!.hint!)).toBe(
      "Maksu nousi elokuussa 279,90 € → 335,00 € (19,7 %). Enimmäismaksu nousi 7,7 %. Jos tulot tai hoitoaika eivät muuttuneet, tarkista maksupäätös.",
    );
  });

  it("stays quiet on the near misses; a private provider has no check", () => {
    for (const near of kidsPart.nearMiss(FRAME)) expect(run(kids, [near]).findings).toEqual([]);
    expect(checkOf([kidsPart.nearMiss(FRAME).at(-1)!])).toEqual([]);
  });

  it("gives no hint before the September charge is in a complete month or when the fee did not change", () => {
    const frame = frameAt("2026-09-20");
    expect(checkOf([kidsPart.hit(frame)], frame)).toEqual([{ id: "kids:daycare", label: "Päivähoitomaksun nousu", status: "clear" }]);
    expect(checkOf([{ txs: rowsOf("flat", kidsPart.daycare(FRAME, 28_000, 28_000)) }])[0]!.hint).toBeUndefined();
  });
});

describe("car: parking and costs", () => {
  it("compares a year of parking with the permit, the airport parking struck", () => {
    const result = run(car, [carPart.hit(FRAME)]);
    const [f, ...rest] = result.findings;
    expect(rest).toEqual([]);
    expect(f!.euros).toMatchObject({ lowCents: 25_200, midCents: 25_200, highCents: 25_200 });
    expect(plain(f!.title)).toBe("Pysäköinti 432 € vuodessa, asukaspysäköintitunnus 180 € vuodessa. Pohjana 48 pysäköintimaksua 12 kuukaudessa.");
    expect(f!.struck).toHaveLength(1);
    expect(f!.calc.find((c) => c.struck)).toMatchObject({ label: "EasyPark 3.7.2026" });
    expect(result.summary!.title).toBe("Auton menot 12 kuukaudessa");
    expect(linesOf(result.summary!.lines)).toEqual({
      Polttoaine: "960 €",
      Pysäköinti: "552 €",
      "Huolto ja renkaat": "450 €",
      Katsastus: "69 €",
      "Liikenne- ja autovakuutus": "420 €",
      Ajoneuvovero: "230 €",
      Yhteensä: "2 681 €",
      "Ajokilometrit vuodessa": "12 000 km",
      Kilometriltä: "0,22 €",
    });
    expect(shown(car, [carPart.hit(FRAME)]).areas[0]!.findings.map((x) => x.certainty.level)).toEqual(["keskitaso"]);
  });

  it("asks for the permit price from 300 € of parking and stays quiet below it or when the permit costs more", () => {
    const [noPrice, small, dear] = carPart.nearMiss(FRAME);
    const result = run(car, [noPrice!]);
    expect(result.findings).toEqual([]);
    expect(result.checks.find((c) => c.id === "car:parking")).toMatchObject({ status: "needs_input", input: "parking_permit_price" });
    expect(shown(car, [noPrice!]).needed.map((n) => n.key).sort()).toEqual(["car_km", "parking_permit_price"]);
    for (const near of [small!, dear!]) expect(run(car, [near]).findings).toEqual([]);
    expect(run(car, [small!]).checks.find((c) => c.id === "car:parking")!.status).toBe("clear");
  });

  it("counts a car instalment under financing, so the cost per kilometre includes it", () => {
    const hit = carPart.hit(FRAME);
    const instalments = rowsOf(
      "fin",
      FRAME.months.slice(-12).map((m) => ({ merchant: "Nordea Rahoitus", counterparty: "NORDEA RAHOITUS SUOMI OY", counterpartyIban: "FI1212345600000123", description: "OSAMAKSU AUTO SOPIMUS 4471", bookingDate: `${m}-05`, amountCents: -28_900 })),
    );
    const lines = linesOf(run(car, [{ ...hit, txs: [...hit.txs, ...instalments] }]).summary!.lines);
    // 12 × 289 €; the total 2 681 € + 3 468 € over 12 000 km
    expect(lines).toMatchObject({ Rahoitus: "3 468 €", Yhteensä: "6 149 €", Kilometriltä: "0,51 €" });
  });

  it("treats a permit price older than a year as missing and shows the old value", () => {
    const stale = { ...carPart.hit(FRAME), values: { parking_permit_price: { value: 18_000, asOf: "2025-09-01" } } };
    expect(run(car, [stale]).findings).toEqual([]);
    const needed = shown(car, [stale]).needed.find((n) => n.key === "parking_permit_price");
    expect(needed!.old).toEqual({ value: 18_000, asOf: "2025-09-01" });
  });
});
