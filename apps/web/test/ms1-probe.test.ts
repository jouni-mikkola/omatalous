/**
 * The lines of Tietojen laatu for the share filed without asking, made from rows: no decimals, alle 1 %, never 100 %
 * unless all is filed. (Probe cases of the brief.)
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../../../packages/core/src/analysis/context.ts";
import { type FiledWithoutAsking, filedWithoutAsking } from "../../../packages/core/src/analysis/filed.ts";
import type { Account, Transaction } from "../../../packages/core/src/types.ts";
import { tx } from "../../../packages/core/test/helpers.ts";
import { filedLines as linesOf, percentText } from "../src/components/questions.ts";

const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const today = "2026-10-16";
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const pctText = percentText;
const filedLines = (r: FiledWithoutAsking | null): string[] => linesOf(r);
const run = (rows: Transaction[]) => filedWithoutAsking(createContext(rows, [checking], today))!;
const buy = (cents: number, source: Transaction["categorySource"], partial: Partial<Transaction> = {}) =>
  tx({ bookingDate: "2026-06-10", amountCents: -cents, category: source === "default" ? "other" : "groceries", categorySource: source, merchant: "Kauppa Testi Oy", ...partial });

describe("percent text: no decimals, alle 1 %, never 100 % unless all filed", () => {
  it.each([
    [1, "100 %"],
    [0.996, "99 %"],
    [0.9999, "99 %"],
    [0.994, "99 %"],
    [0.5, "50 %"],
    [0.01, "1 %"],
    [0.0099, "alle 1 %"],
    [0.004, "alle 1 %"],
    [0.0001, "alle 1 %"],
  ])("%s -> %s", (v, text) => {
    expect(sp(pctText(v))).toBe(text);
  });

  it("99.6 % filed prints 99 %, not 100 %", () => {
    const r = run([buy(99_600, "mcc"), buy(400, "default")]);
    expect(r.share).toBeCloseTo(0.996, 10);
    const first = sp(filedLines(r)[0]!);
    expect(first).toBe("Viimeisen 12 kuukauden menoista 99 % on luokiteltu ilman kysymistä.");
  });

  it("the guess and user lines come only when above zero, alle 1 % for a sliver", () => {
    const none = filedLines(run([buy(10_000, "mcc")])).map(sp);
    expect(none).toEqual(["Viimeisen 12 kuukauden menoista 100 % on luokiteltu ilman kysymistä."]);
    const r = run([buy(99_700, "mcc"), buy(200, "industry"), buy(100, "user")]);
    const lines = filedLines(r).map(sp);
    expect(lines[0]).toBe("Viimeisen 12 kuukauden menoista 99 % on luokiteltu ilman kysymistä.");
    expect(lines).toContain("Näistä arvioita alle 1 %.");
    expect(lines).toContain("Itse luokittelit alle 1 %.");
  });

  it("nothing filed prints 0 %, and a user-only household has no guess line", () => {
    const lines = filedLines(run([buy(10_000, "user")])).map(sp);
    expect(lines[0]).toBe("Viimeisen 12 kuukauden menoista 0 % on luokiteltu ilman kysymistä.");
    expect(lines.some((l) => l.startsWith("Näistä arvioita"))).toBe(false);
    expect(lines).toContain("Itse luokittelit 100 %.");
  });
});
