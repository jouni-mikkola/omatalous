/**
 * What the households of other banks share: 14 months of rows on `BANK_TODAY` (twelve complete ones to judge), made-up
 * names only, and the way they become a `Household` for `pnpm findings`, the golden files and the quiet test.
 */
import { addDays } from "../../../src/dates.ts";
import { type Account, type BalanceInput, NO_INPUTS, type Transaction } from "../../../src/types.ts";
import { byDateAndId, type Household } from "../../../../../tools/findings/households.ts";
import { banking, frameOf, type Frame } from "../frame.ts";
import { noise, type Noise } from "../noise.ts";

/** A Thursday in the middle of a month, after the 9th, so a statement paid on the 9th is behind us. */
export const BANK_TODAY = "2026-10-15";
export const BANK_HISTORY = 14;
export const BANK_SEED = 17;

export { banking };

export interface Setup {
  f: Frame;
  n: Noise;
}

export function setupOf(seed = BANK_SEED): Setup {
  return { f: frameOf(BANK_TODAY, BANK_HISTORY), n: noise(seed, "poisson") };
}

/** The pay day: the banking day on or before `day`. */
export const payDay = (f: Frame, month: string, day: number) => banking(f.on(month, day), addDays);

export function bankHousehold(name: string, accounts: readonly Account[], balances: readonly BalanceInput[], txs: Transaction[]): Household {
  return { name, today: BANK_TODAY, txs: byDateAndId(txs), accounts, balances, rules: [], inputs: NO_INPUTS, values: {}, industry: new Map() };
}

export const balanceOf = (a: Account, balanceCents: number | null, extra: Partial<BalanceInput> = {}): BalanceInput => ({
  id: a.id,
  name: a.name,
  type: a.type,
  balanceCents,
  ownerName: null,
  balanceAt: BANK_TODAY,
  ...extra,
});

/** What a bank sends beside the text, set on the rows whose description matches (the kit's `rows()` sets neither). */
export interface BankFields {
  match: RegExp;
  code?: string;
  reference?: string;
}

/** The rows with `bankTxnCode` and `reference` as Enable Banking returns them; a row no field matches is left alone. */
export function withBankFields(txs: Transaction[], fields: readonly BankFields[]): Transaction[] {
  return txs.map((t) => {
    const hit = fields.find((x) => x.match.test(t.description ?? ""));
    return hit ? { ...t, bankTxnCode: hit.code ?? null, reference: hit.reference ?? null } : t;
  });
}
