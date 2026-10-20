/**
 * One household of 24 complete months that every area's `hit` joins: a plain base (pay, groceries, a phone bill,
 * a monthly move to savings) and each part's rows on top. The invariants run over it here, O10's household test
 * checks that every area hits on it and that each near miss stays quiet.
 */
import { createContext } from "../../src/analysis/context.ts";
import { addDays, addMonths, daysInMonth, monthRange } from "../../src/dates.ts";
import type { AreaId, InputValues } from "../../src/optimise/types.ts";
import type { OptimiseInput } from "../../src/optimise/index.ts";
import { enrichTransactions } from "../../src/pipeline.ts";
import type { Account, BalanceInput, CategoryRule, Transaction, UserInputs } from "../../src/types.ts";
import { rng } from "../gen.ts";
import * as bank from "./parts/bank.ts";
import * as car from "./parts/car.ts";
import * as electricity from "./parts/electricity.ts";
import * as food from "./parts/food.ts";
import * as habits from "./parts/habits.ts";
import * as housing from "./parts/housing.ts";
import * as insurance from "./parts/insurance.ts";
import * as kids from "./parts/kids.ts";
import * as loans from "./parts/loans.ts";
import * as savings from "./parts/savings.ts";
import * as seasons from "./parts/seasons.ts";
import * as subscriptions from "./parts/subscriptions.ts";
import * as tax from "./parts/tax.ts";

/** Where a part puts its rows: the judging day, the first day of the history and the base accounts. */
export interface Frame {
  today: string;
  /** The first day of the history. */
  start: string;
  /** The last day of the last complete month (`optimiseEnd(today)`). */
  end: string;
  /** The 24 complete months, oldest first. */
  months: readonly string[];
  accounts: readonly Account[];
}

/** What a part adds to the household. */
export interface PartHousehold {
  txs: Transaction[];
  accounts?: Account[];
  balances?: BalanceInput[];
  values?: InputValues;
  inputs?: UserInputs;
  /** Merchant name to TOL code. */
  industry?: Record<string, string>;
}

export interface Part {
  /** Rows that make each finding of the area. */
  hit: (frame: Frame) => PartHousehold;
  /** Households that almost make a finding, one per near miss: every area stays quiet on each. */
  nearMiss: (frame: Frame) => PartHousehold[];
  /** Inputs a household without the area's patterns may have; they must not make a finding. */
  neutralValues: InputValues;
}

export const PARTS: Readonly<Record<AreaId, Part>> = { loans, savings, subscriptions, bank, electricity, housing, insurance, food, habits, seasons, tax, kids, car };

export const ACCOUNTS: readonly Account[] = [
  { id: "h-chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" },
  { id: "h-sav", name: "Säästötili", iban: "FI1410093000123458", currency: "EUR", type: "savings" },
];

const TODAY = "2026-10-15";
const START = "2024-10-01";

export const FRAME: Frame = {
  today: TODAY,
  start: START,
  end: "2026-09-30",
  months: monthRange("2024-10", "2026-09"),
  accounts: ACCOUNTS,
};

/** The plain base: nothing in it is worth a decision. */
export function baseRows(frame: Frame = FRAME): Transaction[] {
  const r = rng(2024);
  const out: Transaction[] = [];
  const add = (p: Partial<Transaction> & Pick<Transaction, "bookingDate" | "amountCents" | "merchant">) =>
    out.push({
      id: `h-${String(out.length).padStart(5, "0")}`,
      accountId: "h-chk",
      currency: "EUR",
      status: "booked",
      counterparty: null,
      counterpartyIban: null,
      description: null,
      mcc: null,
      category: "other",
      categorySource: "default",
      isTransfer: false,
      ...p,
    });
  for (const month of [...frame.months, addMonths(frame.months[frame.months.length - 1]!, 1)]) {
    const on = (d: number) => `${month}-${String(Math.min(d, daysInMonth(month))).padStart(2, "0")}`;
    if (on(1) > frame.today) break;
    add({ bookingDate: on(1), amountCents: -2490, merchant: "Telia", counterparty: "TELIA FINLAND OYJ", description: "TELIA LASKU" });
    if (on(15) <= frame.today) {
      add({ bookingDate: on(15), amountCents: 320000, merchant: "Työnantaja Oy", counterparty: "TYÖNANTAJA OY", description: "PALKKA" });
      add({ bookingDate: on(16), amountCents: -30000, merchant: "Siirto", description: "OMA SIIRTO", counterpartyIban: "FI1410093000123458" });
      add({ bookingDate: on(16), amountCents: 30000, merchant: "Siirto", description: "OMA SIIRTO", accountId: "h-sav", counterpartyIban: "FI2112345600000785" });
    }
    for (let week = 0; week < 4; week++) {
      const day = addDays(on(3), week * 7);
      if (day > frame.today) break;
      add({ bookingDate: day, amountCents: -Math.round(7000 + r() * 4000), merchant: "K-Market Kamppi", description: "K-MARKET KAMPPI", mcc: "5411" });
    }
  }
  return out;
}

export interface Household {
  today: string;
  txs: Transaction[];
  accounts: Account[];
  balances: BalanceInput[];
  values: InputValues;
  inputs: UserInputs;
  industry: Map<string, string>;
}

const BASE_BALANCES: BalanceInput[] = [
  { id: "h-chk", name: "Käyttötili", type: "checking", balanceCents: 250000, ownerName: null, balanceAt: "2026-10-14" },
  { id: "h-sav", name: "Säästötili", type: "savings", balanceCents: 900000, ownerName: null, balanceAt: "2026-10-14" },
];

/** The base and the given parts' rows as one household; a later part's account, balance or input wins. */
export function joinHousehold(parts: readonly PartHousehold[], frame: Frame = FRAME): Household {
  const accounts = new Map(frame.accounts.map((a) => [a.id, a]));
  const balances = new Map(BASE_BALANCES.map((b) => [b.id, b]));
  const txs = baseRows(frame);
  let values: InputValues = {};
  const inputs: { marks: UserInputs["marks"][number][]; expectedBills: UserInputs["expectedBills"][number][] } = { marks: [], expectedBills: [] };
  const industry = new Map<string, string>();
  for (const p of parts) {
    txs.push(...p.txs);
    for (const a of p.accounts ?? []) accounts.set(a.id, a);
    for (const b of p.balances ?? []) balances.set(b.id, b);
    values = { ...values, ...p.values };
    inputs.marks.push(...(p.inputs?.marks ?? []));
    inputs.expectedBills.push(...(p.inputs?.expectedBills ?? []));
    for (const [m, code] of Object.entries(p.industry ?? {})) industry.set(m, code);
  }
  txs.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || (a.id < b.id ? -1 : 1));
  return { today: frame.today, txs, accounts: [...accounts.values()], balances: [...balances.values()], values, inputs, industry };
}

/** Every part's hit on the base. */
export function household(frame: Frame = FRAME): Household {
  return joinHousehold(Object.values(PARTS).map((p) => p.hit(frame)), frame);
}

/** Every part's neutral inputs together. */
export function neutralValues(): InputValues {
  return Object.values(PARTS).reduce<InputValues>((all, p) => ({ ...all, ...p.neutralValues }), {});
}

/** Every row after enrichment, as the server stores them: `enrichTransactions` returns only the rows it changed. */
export function enrich(txs: readonly Transaction[], accounts: readonly Account[], rules: readonly CategoryRule[] = [], industry: ReadonlyMap<string, string> = new Map()): Transaction[] {
  const changed = new Map(enrichTransactions(txs, accounts, rules, industry).map((t) => [t.id, t]));
  return txs.map((t) => changed.get(t.id) ?? t);
}

/** The household as `buildOptimise` gets it from the server. */
export function householdInput(h: Household): OptimiseInput {
  const ctx = createContext(enrich(h.txs, h.accounts), h.accounts, h.today);
  return { ctx, balances: h.balances, inputs: h.inputs, values: h.values, industry: h.industry };
}
