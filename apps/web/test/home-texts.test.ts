import { describe, expect, it } from "vitest";

/** The page writes sums with a no-break space; the tests read them with a plain one. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, " ");

import { answerText, bufferBasisText, bufferText, directionText, aboutSum, euroRange, monthLine, paceHeadline, paceRangeText, questionText, type PaceData, type RunwayData } from "../src/components/home/texts.ts";

const pace = (over: Partial<PaceData> = {}): PaceData => ({ month: "2026-10", day: 25, daysInMonth: 31, spentCents: 282_462, expectedCents: 307_800, diffCents: -25_338, lowCents: 270_000, highCents: 326_000, position: "within", end: null, months: 3, ...over });
const runway = (over: Partial<RunwayData> = {}): RunwayData => ({
  verdict: "enough",
  sum: { balanceCents: 833_362, paymentsCents: 292_607, freeCents: 540_755 },
  allowancePerDayCents: 17_400,
  days: 31,
  everydayPerDayCents: 5_100,
  takenOffPerDayCents: 1_800,
  payday: { date: "2026-11-13", name: "Esimerkki Oy" },
  leftOnPayday: { known: true, months: 3, everydayCents: 0, billedCents: 0, laterCents: 0, freeCents: 540_755, leftCents: 375_000, lowCents: 360_000, highCents: 390_000, payday: { date: "2026-11-13", name: "Esimerkki Oy" } } as RunwayData["leftOnPayday"],
  ...over,
});

describe("the answer", () => {
  it("says enough, ends on the sum left after the payments and gives the range of the payday with its base", () => {
    const text = answerText(runway());
    expect(text.lead).toBe("Rahat riittävät. Laskujen jälkeen sinulle jää");
    expect(text.cents).toBe(540_755);
    expect(plain(text.detail.join(" "))).toContain("Se on 174 € päivässä, kun palkkapäivään on 31 päivää.");
    expect(plain(text.detail.join(" "))).toContain("viime kuukausien mukaan");
    expect(plain(text.detail.join(" "))).toContain("jää noin 3 800 €");
  });

  it("says short with the missing sum when the payments are more than the balance", () => {
    const text = answerText(runway({ verdict: "short", sum: { balanceCents: 10_000, paymentsCents: 30_000, freeCents: -20_000 }, allowancePerDayCents: null, days: null }));
    expect(text).toEqual({ lead: "Rahat eivät riitä. Laskujen jälkeen sinulta puuttuu", cents: 20_000, detail: [] });
  });

  it("says tight when the lower end of the range is below zero", () => {
    expect(answerText(runway({ verdict: "tight" })).lead).toContain("tiukalle");
  });

  it("does not say enough without a known payday or everyday spending: it says the payments are covered and why the payday is left out", () => {
    const text = answerText(runway({ verdict: "covered", allowancePerDayCents: null, days: null, leftOnPayday: { known: false, reason: "no-payday" } as RunwayData["leftOnPayday"] }));
    expect(text.lead).toBe("Laskuihin riittää. Laskujen jälkeen sinulle jää");
    expect(text.lead).not.toContain("Riittävät");
    expect(plain(text.detail.join(" "))).toContain("Emme tiedä palkkapäivääsi");
  });

  it("says no sum when no balance is known", () => {
    expect(answerText(runway({ verdict: "unknown", sum: null })).cents).toBeNull();
  });

  it("names the payday in the question, and asks for the next pay when none is known", () => {
    expect(questionText(runway())).toBe("Rahat palkkapäivään 13.11.");
    expect(questionText(runway({ payday: null }))).toBe("Rahat seuraavaan palkkaan");
  });

  it("says the sum left on payday as a rounded sum", () => {
    expect(plain(aboutSum(431_300, 465_500))).toBe("4 500 €");
    expect(plain(aboutSum(-30_000, -12_000))).toBe("200 €");
  });

  it("writes a range with the unit once", () => {
    expect(plain(euroRange(360_000, 390_000))).toBe("3 600–3 900 €");
  });
});

describe("the month", () => {
  it("states the difference against the expected month and names what the expected is read from", () => {
    expect(plain(paceHeadline(pace()))).toBe("Olet käyttänyt tähän päivään 253 € vähemmän kuin tavallisesti");
    expect(plain(paceHeadline(pace({ diffCents: 40_000 })))).toContain("400 € enemmän kuin tavallisesti");
    expect(plain(paceHeadline(pace({ diffCents: 40 })))).toContain("suunnilleen tavallisen verran");
  });

  it("says where the spending stands in the range of the base months", () => {
    expect(plain(paceRangeText(pace()))).toContain("Tavallisesti tähän päivään menee 2 700–3 260 €, joten menosi ovat tavallisen vaihtelun sisällä");
    expect(plain(paceRangeText(pace({ position: "above" })))).toContain("tavallista suuremmat");
  });

  it("is the line under the heading with the month, its day and the last fetch", () => {
    expect(monthLine("2026-10", pace(), "tänään 6.02")).toBe("Lokakuu 2026 · päivä 25/31 · päivitetty tänään 6.02");
    expect(monthLine("2026-10", null, null)).toBe("Lokakuu 2026");
  });
});

describe("the direction", () => {
  it("tells the buffer in months and the direction with the months it compares", () => {
    expect(bufferText(4.47)).toBe("4,5 kuukautta");
    expect(bufferText(1)).toBe("1 kuukausi");
    expect(directionText({ averageCents: 300_000, months: 12, from: "2025-11-01", recentChangeCents: 20_000, direction: "up", bufferMonths: 4, bufferNetCents: 1_200_000, bufferSpendCents: 300_000 })).toBe("Kolmen viime kuukauden menot ovat nousussa.");
    const basis = { averageCents: 324_500, months: 12, from: "2025-11-01", recentChangeCents: 0, direction: "flat" as const, bufferMonths: 3.9, bufferNetCents: 1_341_400, bufferSpendCents: 340_300 };
    expect(bufferBasisText(basis)?.replace(/\s/g, " ")).toBe("13 414 € jaettuna tavallisilla menoilla 3 403 €/kk");
    expect(bufferBasisText({ ...basis, bufferMonths: null, bufferNetCents: null, bufferSpendCents: null })).toBeNull();
    expect(directionText({ averageCents: null, months: 2, from: "2026-09-01", recentChangeCents: null, direction: null, bufferMonths: null, bufferNetCents: null, bufferSpendCents: null })).toBeNull();
  });
});
