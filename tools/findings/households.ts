/**
 * The households `pnpm findings`, the golden files and the life-event kit judge: the demo history as the server loads
 * it (POST /api/demo) and the seeded histories of the property tests (`randomHistory`, plain and settled). Core only:
 * no database and no server, so a run over the demo and five seeds takes well under a second.
 */
import { generateDemoData } from "../../apps/server/src/demo-data.ts";
import { stableId } from "../../apps/server/src/platform/ids.ts";
import { type AnalysisContext, createContext } from "../../packages/core/src/analysis/context.ts";
import { fold, normalizeMerchant } from "../../packages/core/src/merchant.ts";
import type { InputValues } from "../../packages/core/src/optimise/types.ts";
import { enrichTransactions } from "../../packages/core/src/pipeline.ts";
import { type Account, type BalanceInput, type CategoryRule, type IsoDate, NO_INPUTS, type Transaction, type UserInputs } from "../../packages/core/src/types.ts";
import { randomHistory } from "../../packages/core/test/gen.ts";

/** Everything a statement source reads: what the server holds for one user on one day. */
export interface Household {
  /** "demo", "plain:3", "settled:3", "kit:base", "kit:move-new-landlord". */
  name: string;
  today: IsoDate;
  /** As stored before enrichment: `contextOf` enriches them like `reprocess`. */
  txs: readonly Transaction[];
  accounts: readonly Account[];
  balances: readonly BalanceInput[];
  rules: readonly CategoryRule[];
  inputs: UserInputs;
  values: InputValues;
  /** Merchant name to TOL code from the register lookups. */
  industry: ReadonlyMap<string, string>;
}

/** The day the demo is judged on: the server tests' clock (`NOW` in apps/server/test/helpers.ts). */
export const DEMO_TODAY = "2026-10-09";
/** The day the seeded histories are judged on, as in their quiet tests. */
export const SEED_TODAY = "2025-11-15";

/** The demo history the way `loadDemoData` stores it: ids and merchants from `ingestTransactions`, every row new. */
export function demoHousehold(today: IsoDate = DEMO_TODAY): Household {
  const txs: Transaction[] = [];
  const accounts: Account[] = [];
  const balances: BalanceInput[] = [];
  for (const a of generateDemoData(today)) {
    accounts.push({ id: a.id, name: a.name, iban: a.iban, currency: "EUR", type: a.type });
    balances.push({ id: a.id, name: a.name, type: a.type, balanceCents: a.balanceCents, ownerName: null, balanceAt: today });
    const seen = new Map<string, number>();
    // booked rows first, as ingest numbers them
    for (const r of [...a.transactions.filter((t) => t.status === "booked"), ...a.transactions.filter((t) => t.status !== "booked")]) {
      const base = `c|${r.bookingDate}|${r.amountCents}|${fold(r.counterparty ?? "")}|${fold(r.description ?? "")}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      txs.push({
        id: stableId(`${a.id}|${r.status}|${base}|${n}`),
        accountId: a.id,
        bookingDate: r.bookingDate,
        amountCents: r.amountCents,
        currency: r.currency,
        status: r.status,
        counterparty: r.counterparty,
        counterpartyIban: r.counterpartyIban,
        description: r.description,
        mcc: r.mcc,
        merchant: normalizeMerchant(r.counterparty, r.description),
        category: r.amountCents >= 0 ? "income" : "other",
        categorySource: "default",
        isTransfer: false,
        source: "demo",
      });
    }
  }
  return { name: "demo", today, txs: byDateAndId(txs), accounts, balances, rules: [], inputs: NO_INPUTS, values: {}, industry: new Map() };
}

/** A seeded history of the property tests: `randomHistory(seed, 600)`, or settled with 30 months as in the quiet tests. */
export function seededHousehold(seed: number, settled: boolean): Household {
  const { txs, accounts, rules } = settled ? randomHistory(seed, 1500, { months: 30, settled: true }) : randomHistory(seed, 600);
  const balances = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balanceCents: a.type === "loan" ? null : 150000, ownerName: null, balanceAt: SEED_TODAY }));
  return { name: `${settled ? "settled" : "plain"}:${seed}`, today: SEED_TODAY, txs, accounts, balances, rules, inputs: NO_INPUTS, values: {}, industry: new Map() };
}

/** The order the server reads rows in: date, then id. */
export function byDateAndId<T extends Pick<Transaction, "bookingDate" | "id">>(txs: T[]): T[] {
  return txs.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The cached context the server builds after `reprocess`: every row enriched (`enrichTransactions` returns the changed
 * ones). No household here has a register lookup, so enrichment gets no industry categories.
 */
export function contextOf(h: Household): AnalysisContext {
  const changed = new Map(enrichTransactions(h.txs, h.accounts, h.rules, new Map()).map((t) => [t.id, t]));
  return createContext(
    h.txs.map((t) => changed.get(t.id) ?? t),
    h.accounts,
    h.today,
  );
}
