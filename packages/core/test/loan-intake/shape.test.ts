import { describe, expect, it } from "vitest";
import { type LoanDraft, type LoanDraftField, type LoanDraftKey, parseLoanText } from "../../src/index.ts";
import { rng } from "../gen.ts";

const LABELS = ["Myönnetty määrä", "Luoton saldo", "Kokonaiskorko", "Viitekorko", "Marginaali", "Lyhennystapa", "Lyhennysväli", "Viimeinen eräpäivä", "Luottoraja", "Kuukausierä", "Lyhennys", "Luotonantaja", "Luoton tyyppi", "Korko", "Lainan määrä"];
const VALUES = ["150 000,00 €", "12 345,67", "l2 OOO €", "3,39 %", "065 %", "45 %", "12 kk Euribor 2,74 %", "Kiinteä", "Annuiteetti", "Tasalyhennys", "1 kk", "31.10.2046", "1.2.20", "Esimerkkipankki Oyj", "-", "", "FI00 1234 5600 0007 85", "5 vuotta"];
const BETWEEN = [": ", " ", "\t", "\n", "\n\n", "  "];
const NOISE = ["Esimerkkipankki Oyj", "Mallirahoitus Bank AB", "Luottotietoni", "Tämä on selitysteksti ilman yhtään numeroa tässä.", "9 726,00 €", "Sivu 1/2"];

/** A text put together at random from labels, values, lender lines and noise: most of it no real page. */
function randomText(seed: number): string {
  const next = rng(seed);
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const parts: string[] = [];
  for (let i = 0; i < 4 + Math.floor(next() * 20); i++) {
    const roll = next();
    if (roll < 0.15) parts.push(pick(NOISE), "\n");
    else if (roll < 0.25) parts.push(pick(VALUES), "\n");
    else parts.push(pick(LABELS), pick(BETWEEN), pick(VALUES), pick(["\n", "\n", " ", "\t"]));
  }
  return parts.join("");
}

const MONEY: LoanDraftKey[] = ["grantedCents", "balanceCents", "paymentCents", "limitCents"];
const RATES: LoanDraftKey[] = ["rateBp", "marginBp"];
const DATES: LoanDraftKey[] = ["balanceDate", "endDate"];

/** The fields of a draft, without its warnings and the kind of its payment. */
const fieldsOf = (draft: LoanDraft) => Object.values(draft).filter((f) => typeof f === "object" && !Array.isArray(f)) as LoanDraftField<unknown>[];

function expectWellFormed(draft: LoanDraft, text: string): void {
  const keys = (Object.keys(draft) as (LoanDraftKey | "warnings" | "paymentKind")[]).filter((k): k is LoanDraftKey => k !== "warnings" && k !== "paymentKind");
  // the kind of the payment comes with the payment and with nothing else
  expect(draft.paymentKind === undefined, text).toBe(draft.paymentCents === undefined);
  expect(keys.some((k) => k !== "lender"), text).toBe(true);
  for (const key of keys) {
    const field = draft[key]!;
    expect(["sure", "check"], text).toContain(field.confidence);
    expect(field.line.length, text).toBeGreaterThan(0);
    if (MONEY.includes(key)) expect(Number.isInteger(field.value) && (field.value as number) >= 0, `${key} in ${text}`).toBe(true);
    if (RATES.includes(key)) expect(Number.isInteger(field.value) && (field.value as number) >= 0 && (field.value as number) < 10_000, `${key} in ${text}`).toBe(true);
    if (DATES.includes(key)) expect(field.value, text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
  for (const warning of draft.warnings) {
    expect(warning.text.length, text).toBeGreaterThan(0);
    // a warning names only fields the draft has, and every one of them is to check
    for (const key of warning.fields) expect(draft[key]?.confidence, `${warning.id} ${key} in ${text}`).toBe("check");
  }
}

describe("loan intake: any text", () => {
  it("random texts never throw, give well-formed drafts, and give the same drafts twice", () => {
    let drafts = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const text = randomText(seed);
      const found = parseLoanText(text, { asOf: "2026-10-12" });
      for (const draft of found) expectWellFormed(draft, text);
      expect(parseLoanText(text, { asOf: "2026-10-12" }), text).toEqual(found);
      // read from a picture, the same values and nothing sure
      const ocr = parseLoanText(text, { asOf: "2026-10-12", source: "ocr" });
      expect(ocr.map((d) => fieldsOf(d).map((f) => f.value)), text).toEqual(found.map((d) => fieldsOf(d).map((f) => f.value)));
      expect(ocr.every((d) => fieldsOf(d).every((f) => f.confidence === "check")), text).toBe(true);
      drafts += found.length;
    }
    expect(drafts).toBeGreaterThan(150);
  });

  it("the input is not changed by its line ends or by the spaces a page puts inside numbers", () => {
    const lines = ["Myönnetty määrä: 150 000,00 €", "Luoton saldo: 120 000,00 €", "Kokonaiskorko: 3,39 %"];
    const plain = parseLoanText(lines.join("\n"));
    expect(plain).toHaveLength(1);
    const strip = (drafts: LoanDraft[]) => drafts.map((d) => fieldsOf(d).map((f) => `${f.value} ${f.confidence}`));
    for (const variant of [lines.join("\r\n"), lines.join("\r"), lines.join("\n\n\n"), `﻿${lines.join("\n")}\n`, lines.join("\n").replace(/ /g, " "), lines.map((l) => `   ${l}  `).join("\n")]) {
      expect(strip(parseLoanText(variant)), JSON.stringify(variant)).toEqual(strip(plain));
    }
  });
});
