/** Moves between own accounts, cash, tax refunds and a few merchants: one scenario for each rule of APP-26. */
import { describe, expect, it } from "vitest";
import { getCategory } from "../src/categories.ts";
import type { Account } from "../src/types.ts";
import { row, run } from "./flow-helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };

describe("moves between own accounts, cash, tax refunds and a few merchants (APP-26)", () => {
  it("'Siirto tililtä' with no account to pair is a transfer: not income", () => {
    const { final, totals } = run([row("chk", "2026-09-10", 300, "SIIRTO TILILTÄ 1234")], [checking]);
    expect(final[0]).toMatchObject({ category: "transfer" });
    expect(totals).toMatchObject({ incomeCents: 0, savedCents: 0, consumptionCents: 0 });
  });

  it("'Siirto omalle tilille' is a transfer: not saving, whichever way the money goes", () => {
    const { final, totals } = run(
      [row("chk", "2026-09-10", -500, "SIIRTO OMALLE TILILLE"), row("chk", "2026-09-11", 200, "SIIRTO OMALLE TILILLE")],
      [checking],
    );
    expect(final.map((t) => t.category)).toEqual(["transfer", "transfer"]);
    expect(totals).toMatchObject({ incomeCents: 0, savedCents: 0 });
  });

  it("a savings account named in the text still makes the move saving", () => {
    const { final } = run([row("chk", "2026-09-10", -500, "SIIRTO SÄÄSTÖTILILLE")], [checking]);
    expect(final[0]!.category).not.toBe("transfer");
  });

  it("a card's 'luoton siirto omalle tilille' stays a credit drawn", () => {
    const { final } = run([row("chk", "2026-09-05", 1000, "LUOTON SIIRTO OMALLE TILILLE", "NORDEA RAHOITUS SUOMI OY")], [checking]);
    expect(final[0]!.category).toBe("credit_draw");
  });

  it("'Korttimaksu/Nosto' is cash, not a fee", () => {
    const { final, totals } = run([row("chk", "2026-09-10", -20, "KORTTIMAKSU/NOSTO")], [checking]);
    expect(final[0]!.category).toBe("cash");
    expect(totals).toMatchObject({ consumptionCents: 2000 });
  });

  it("a refund from the tax office is tax_refund income, and benefits keep their own category", () => {
    const { final, totals } = run(
      [row("chk", "2026-09-10", 640, "VEROJEN PALAUTUS", "VEROHALLINTO"), row("chk", "2026-09-11", 180, "LAPSILISA", "KELA")],
      [checking],
    );
    expect(final.map((t) => t.category)).toEqual(["tax_refund", "benefits"]);
    expect(getCategory("tax_refund").kind).toBe("income");
    expect(totals).toMatchObject({ incomeCents: 82000 });
  });

  it("tax paid to the tax office is still a tax, not a refund", () => {
    const { final } = run([row("chk", "2026-09-10", -190, "JAANNOSVERO", "VEROHALLINTO")], [checking]);
    expect(final[0]!.category).toBe("taxes");
  });

  it.each([
    ["GOOGLE *GSUITE", "subscriptions"],
    ["AVANZA BANK", "investments"],
    ["POSTI OY", "shopping"],
  ])("%s is %s", (text, category) => {
    const { final } = run([row("chk", "2026-09-10", -12, `KORTTIOSTO 4921XXXXXXXX5530 ${text}`)], [checking]);
    expect(final[0]!.category).toBe(category);
  });

  it("a row the user categorised keeps its category and source under the new rules", () => {
    const mine = [
      row("chk", "2026-09-10", 300, "SIIRTO TILILTÄ 1234", null, { category: "sales", categorySource: "user" }),
      row("chk", "2026-09-11", -20, "KORTTIMAKSU/NOSTO", null, { category: "gifts_donations", categorySource: "user" }),
      row("chk", "2026-09-12", 640, "VEROJEN PALAUTUS", "VEROHALLINTO", { category: "salary", categorySource: "user" }),
      row("chk", "2026-09-13", -6, "KORTTIOSTO GOOGLE *GSUITE", null, { category: "home", categorySource: "user" }),
    ];
    const { final } = run(mine, [checking]);
    expect(final.map((t) => [t.category, t.categorySource])).toEqual([["sales", "user"], ["gifts_donations", "user"], ["salary", "user"], ["home", "user"]]);
  });
});
