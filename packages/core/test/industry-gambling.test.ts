/**
 * No name of gambling goes to the trade register: an operator, a word of gambling or a payment service that carries
 * gambling money would tell an outsider that someone in the household gambles (industry.ts). "Pelikasino" and
 * "Onnenpyörä" are made up; every entry of wording-gambling.ts is read from the file.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { industryCandidates, isLookupName } from "../src/industry.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";

const SOURCE = readFileSync(new URL("../src/wording-gambling.ts", import.meta.url), "utf8");
/** Each list entry as a name a row could carry: the regex syntax of the few patterns taken out. */
const ENTRIES = [...SOURCE.matchAll(/^\s+(?:"([^"]+)"|String\.raw`([^`]+)`), \/\//gm)].map((m) =>
  (m[1] ?? m[2]!).replace(/\[A-Z\]\*/g, "").replace(/ \?/g, " "),
);
const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };

describe("isLookupName refuses gambling", () => {
  it("reads every list", () => {
    expect(ENTRIES).toContain("VEIKKAUS");
    expect(ENTRIES).toContain("PROZONE");
    expect(ENTRIES).toContain("TRUSTLY");
    expect(ENTRIES).toContain("RAHAPELI");
  });

  it("refuses every entry, alone and in a company's name", () => {
    const passed = ENTRIES.flatMap((e) => [e, `${e} Limited`].filter((name) => isLookupName(name)));
    expect(passed).toEqual([]);
  });

  it("refuses a made-up operator by its word, and keeps an ordinary shop", () => {
    expect(isLookupName("Pelikasino Holdings Ltd")).toBe(false);
    expect(isLookupName("Kukkakauppa Ilo")).toBe(true);
  });
});

describe("industryCandidates skips gambling", () => {
  const row = (merchant: string, mcc: string | null, description: string | null = null) =>
    tx({ accountId: "card", bookingDate: "2026-09-01", amountCents: -4000, merchant, counterparty: merchant.toUpperCase(), description, mcc, categorySource: "default" });

  it("leaves out an operator with a gambling code and without one", () => {
    const txs = [row("Onnenpyörä Ltd", "7995"), row("Prozone Limited", null), row("Pelikasino Holdings Ltd", null), row("Kukkakauppa Ilo", "5992")];
    expect(industryCandidates(txs, [checking, card])).toEqual(["Kukkakauppa Ilo"]);
  });

  it("leaves out a merchant once one of its rows names gambling", () => {
    const txs = [row("Onnenpyörä Ltd", null), row("Onnenpyörä Ltd", null, "KASINOTALLETUS"), row("Kukkakauppa Ilo", "5992")];
    expect(industryCandidates(txs, [checking, card])).toEqual(["Kukkakauppa Ilo"]);
  });

  it("leaves out every listed name, also with a digit after it, from card rows with no code", () => {
    const txs = [...ENTRIES.flatMap((e) => [row(e, null), row(`${e}24`, null)]), row("Kukkakauppa Ilo", null)];
    expect(industryCandidates(txs, [checking, card])).toEqual(["Kukkakauppa Ilo"]);
  });

  it("leaves out the operators the rows name in their own forms", () => {
    const txs = ["Bet365", "NetBet", "Pokeri Online Ltd", "Kolikkopeli Ltd"].map((m) => row(m, null));
    expect(industryCandidates(txs, [checking, card])).toEqual([]);
    expect(isLookupName("BET365")).toBe(false);
  });

  it("leaves out a merchant whose row has a payment service as its payee", () => {
    const viaTrustly = tx({ accountId: "chk", bookingDate: "2026-09-02", amountCents: -4000, merchant: "Verkkokauppa Ilo Oy", counterparty: "TRUSTLY", description: "VERKKOKAUPPA ILO OY VERKKOMAKSU", categorySource: "default" });
    const viaZimpler = tx({ accountId: "chk", bookingDate: "2026-09-03", amountCents: -2000, merchant: "Onnenpyörä Ltd", counterparty: "ZIMPLER AB", description: "ONNENPYORA LTD", categorySource: "default" });
    expect(industryCandidates([viaTrustly, viaZimpler, row("Kukkakauppa Ilo", "5992")], [checking, card])).toEqual(["Kukkakauppa Ilo"]);
  });

  it("keeps a shop that is the payee itself, a payment service named only in its message", () => {
    expect(industryCandidates([row("Verkkokauppa Ilo Oy", null, "TRUSTLY")], [checking, card])).toEqual(["Verkkokauppa Ilo Oy"]);
  });

  it("names no payment service", () => {
    const txs = ["Zimpler", "Trustly", "Brite", "Paysafecard", "Skrill", "Neteller", "Sofort"].map((m) => row(m, null));
    expect(industryCandidates(txs, [checking, card])).toEqual([]);
  });
});
