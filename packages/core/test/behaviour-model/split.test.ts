import { describe, expect, it } from "vitest";
import { addDays } from "../../src/dates.ts";
import { splitCandidates } from "../../src/behaviour/split.ts";
import type { RowSpec } from "../kit/frame.ts";
import { frame, withRows } from "./household.ts";

const day = frame.on(frame.ago(1), 6);
const court = (cents = 2_200): RowSpec => ({ date: day, cents: -cents, description: "SULKAPALLOHALLI ESIMERKKI HELSINKI", mcc: "7997", account: "card" });
const from = (who: string, cents: number, after: number): RowSpec => ({ date: addDays(day, after), cents, counterparty: who, description: "MOBILEPAY" });

describe("D3 split bills, asked", () => {
  it("asks about a 22 € court and two friends' 6 €, and what the court then cost", () => {
    const { ctx, ids } = withRows([court(), from("LIISA VIRTANEN", 600, 1), from("PEKKA KORHONEN", 600, 2)]);
    const [q, ...rest] = splitCandidates(ctx).questions;
    expect(rest).toEqual([]);
    expect(q).toMatchObject({ purchaseId: ids[0], purchaseCents: 2_200, leftCents: 1_000 });
    expect(q!.shares).toEqual({ value: [600, 600], confidence: "guess", evidence: ids });
  });

  it("does not ask when the shares come four days later", () => {
    const { ctx } = withRows([court(), from("LIISA VIRTANEN", 600, 4), from("PEKKA KORHONEN", 600, 4)]);
    expect(splitCandidates(ctx).questions).toEqual([]);
  });

  it("does not ask when the two shares leave the organiser nothing", () => {
    const { ctx } = withRows([court(), from("LIISA VIRTANEN", 1_150, 1), from("PEKKA KORHONEN", 1_150, 1)]);
    expect(splitCandidates(ctx).questions).toEqual([]);
  });

  it("does not ask about two payments far apart in size", () => {
    const { ctx } = withRows([court(3_000), from("LIISA VIRTANEN", 600, 1), from("PEKKA KORHONEN", 1_200, 1)]);
    expect(splitCandidates(ctx).questions).toEqual([]);
  });

  it("does not ask about one friend paying 70 %", () => {
    const { ctx } = withRows([court(4_000), from("LIISA VIRTANEN", 2_800, 1)]);
    expect(splitCandidates(ctx).questions).toEqual([]);
  });

  it("asks about half of a basket of groceries to the cent, not about a rounded half", () => {
    const basket: RowSpec = { date: day, cents: -6_438, description: "K-SUPERMARKET NUUKSIO ESPOO", mcc: "5411", account: "card" };
    expect(splitCandidates(withRows([basket, from("SARI LAINE", 3_219, 2)]).ctx).questions).toHaveLength(1);
    expect(splitCandidates(withRows([basket, from("SARI LAINE", 3_200, 2)]).ctx).questions).toEqual([]);
  });

  const stake = (cents: number): RowSpec => ({ date: day, cents: -cents, description: "VEIKKAUS OY HELSINKI", mcc: "7995", account: "card" });

  it("asks about a stake put in together: 100 € and three friends' 25 €", () => {
    const { ctx, ids } = withRows([stake(10_000), from("LIISA VIRTANEN", 2_500, 0), from("PEKKA KORHONEN", 2_500, 0), from("ANNA NIEMINEN", 2_500, 1)]);
    const [q] = splitCandidates(ctx).questions;
    expect(q).toMatchObject({ purchaseId: ids[0], leftCents: 2_500 });
  });

  it("reads no payment through Trustly as a stake: a shop's gift and a broker's deposit shared by friends", () => {
    const { ctx } = withRows([
      { date: day, cents: -9_000, counterparty: "TRUSTLY GROUP AB", description: "VERKKOKAUPPA ESIMERKKI LAHJA" },
      from("LIISA VIRTANEN", 2_200, 1),
      from("PEKKA KORHONEN", 2_200, 1),
      { date: addDays(day, 5), cents: -20_000, counterparty: "TRUSTLY GROUP AB", description: "NORDNET BANK AB TALLETUS" },
      from("ANNA NIEMINEN", 5_000, 6),
      from("SARI LAINE", 5_000, 6),
    ]);
    const byId = new Map(ctx.txs.map((t) => [t.id, t]));
    expect(ctx.txs.filter((t) => t.counterparty === "TRUSTLY GROUP AB").map((t) => t.category)).not.toContain("gambling");
    expect(splitCandidates(ctx).questions.filter((q) => byId.get(q.purchaseId)!.category === "gambling")).toEqual([]);
  });

  it("does not ask about one round payment after a stake", () => {
    expect(splitCandidates(withRows([stake(3_000), from("SARI LAINE", 1_500, 1)]).ctx).questions).toEqual([]);
  });

  it("does not ask when a friend's monthly payment follows a stake", () => {
    const monthlyShare: RowSpec[] = Array.from({ length: 6 }, (_, k) => ({ date: frame.on(frame.ago(6 - k), 7), cents: 2_500, counterparty: "LIISA VIRTANEN", description: "MOBILEPAY" }));
    const { ctx } = withRows([stake(10_000), ...monthlyShare, from("PEKKA KORHONEN", 2_500, 1)]);
    expect(splitCandidates(ctx).questions).toEqual([]);
  });

  it("leaves out a steady payer", () => {
    const weekly: RowSpec[] = Array.from({ length: 12 }, (_, k) => ({ date: addDays(day, k * 7 - 49), cents: 1_100, counterparty: "MAIJA MEIKALAINEN", description: "MOBILEPAY" }));
    const { ctx } = withRows([court(), ...weekly, from("PEKKA KORHONEN", 600, 1)]);
    expect(splitCandidates(ctx).questions).toEqual([]);
  });

  it("names a payer who sends many a day and asks no split of its rows", () => {
    const pot: RowSpec[] = Array.from({ length: 24 }, (_, k) => ({ date: addDays(day, Math.floor(k / 6) * 9 - 20), cents: 600, description: "VIPPS MOBILEPAY" }));
    const { ctx } = withRows([court(), ...pot]);
    const s = splitCandidates(ctx);
    expect(s.busyPayers).toHaveLength(1);
    expect(s.questions).toEqual([]);
  });

  it("asks at most three a week, the largest first", () => {
    // halves that fit no other meal as a half or a third
    const meals: RowSpec[] = [2_238, 3_846, 5_022, 6_654].flatMap((cents, k) => [
      { date: day, cents: -cents, description: `RAVINTOLA ESIMERKKI ${k}`, mcc: "5812", account: "card" },
      from(`ANNA NIEMINEN${"I".repeat(k)}`, cents / 2, 1),
    ]);
    const asked = splitCandidates(withRows(meals).ctx).questions.map((q) => q.purchaseCents);
    expect(asked.sort((a, b) => b - a)).toEqual([6_654, 5_022, 3_846]);
  });
});
