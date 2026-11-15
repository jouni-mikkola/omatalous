/**
 * The households `pnpm findings`, the golden files and the life-event kit judge: the demo history as the server loads
 * it (POST /api/demo) and the seeded histories of the property tests (`randomHistory`, plain and settled). Core only:
 * no database and no server, so a run over the demo and five seeds takes well under a second.
 */
import { generateDemoData } from "../../apps/server/src/demo-data.ts";
import { stableId } from "../../apps/server/src/platform/ids.ts";
import { applyUse, deriveUse, partCents, partOf, saidUse, type UseMember, WHOLE } from "../../packages/core/src/account-use.ts";
import { type AnalysisContext, createContext } from "../../packages/core/src/analysis/context.ts";
import { normalizeIban } from "../../packages/core/src/iban.ts";
import { fold, normalizeMerchant } from "../../packages/core/src/merchant.ts";
import { userNameOf } from "../../packages/core/src/person-names.ts";
import { enrichTransactions } from "../../packages/core/src/pipeline.ts";
import { detectTransfers } from "../../packages/core/src/transfers.ts";
import { type Account, type AccountUse, type BalanceInput, type CategoryRule, type IsoDate, NO_INPUTS, type Part, type Transaction, type UserInputs } from "../../packages/core/src/types.ts";
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
  /** Merchant name to TOL code from the register lookups. */
  industry: ReadonlyMap<string, string>;
  /** The users of the instance and the accounts each linked. Left out: one user who holds everything (`viewsOf` then gives the one view). */
  members?: readonly HouseholdMember[];
  /** The accounts more than one member uses. */
  shared?: readonly SharedAccount[];
}

export interface HouseholdMember {
  id: string;
  /** What the member is shown as. */
  label: string;
  /** The member's name as the bank writes a holder ("SURNAME FIRST"). */
  holder: string;
  /** The accounts only this member linked. */
  accountIds: readonly string[];
}

export interface SharedAccount {
  accountId: string;
  /** The members who linked it; the first one's copy is the one the household keeps. */
  linkedBy: readonly string[];
  /** The weights the household said, by member id. Left out: nobody said the split, so each member counts the account whole (ADR 0017). */
  said?: Readonly<Record<string, number>>;
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
  return { name: "demo", today, txs: byDateAndId(txs), accounts, balances, rules: [], inputs: NO_INPUTS, industry: new Map() };
}

/** The plain seed whose bank says pay only in its own transaction code (`HistoryOptions.coded`), so the golden files cover the codes. */
const CODED_SEED = 4;

/** A seeded history of the property tests: `randomHistory(seed, 600)`, or settled with 30 months as in the quiet tests. */
export function seededHousehold(seed: number, settled: boolean): Household {
  const { txs, accounts, rules } = settled ? randomHistory(seed, 1500, { months: 30, settled: true }) : randomHistory(seed, 600, { coded: seed === CODED_SEED });
  const balances = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balanceCents: a.type === "loan" ? null : 150000, ownerName: null, balanceAt: SEED_TODAY }));
  return { name: `${settled ? "settled" : "plain"}:${seed}`, today: SEED_TODAY, txs, accounts, balances, rules, inputs: NO_INPUTS, industry: new Map() };
}

/** One way of reading a household: the household as a whole, or one member's own view of it (what `loadScope` builds). */
export interface HouseholdView {
  view: "household" | "own";
  /** The viewer's member id; null for the household view. */
  member: string | null;
  accounts: readonly Account[];
  balances: readonly BalanceInput[];
  /** The viewer's part of every account in the view; the household view counts each whole. */
  parts: ReadonlyMap<string, Part>;
  /** The rows the view counts, enriched and cut by the parts. */
  txs: readonly Transaction[];
  ctx: AnalysisContext;
}

/** The rows after enrichment: `enrichTransactions` returns only the rows it changed. */
function enriched(h: Household, txs: readonly Transaction[], accounts: readonly Account[], household?: ReadonlySet<string>): Transaction[] {
  const changed = new Map(enrichTransactions(txs, accounts, h.rules, h.industry, undefined, undefined, undefined, household).map((t) => [t.id, t]));
  return txs.map((t) => changed.get(t.id) ?? t);
}

/**
 * The views of a household as the server builds them. Each member's rows are enriched on their own with their own
 * accounts, as the server does for each user; the household view then marks the legs between members as transfers, and
 * a member's own view reads the accounts the member linked or shares, cut by the member's part (`applyUse`). A
 * household with no members is one view, the household.
 */
export function viewsOf(h: Household): HouseholdView[] {
  const { members = [], shared = [] } = h;
  const balanceOf = (id: string, extra: Partial<BalanceInput> = {}) => ({ ...h.balances.find((b) => b.id === id)!, ...(shared.some((s) => s.accountId === id) ? { joint: true } : {}), ...extra });
  // The own view counts a balance and a limit at the viewer's part, once, as `requestInputs` does (apps/server/src/services/analysis.ts):
  // a consumer of the balance never weights it again.
  const countedAt = (id: string, part: Part, extra: Partial<BalanceInput>): BalanceInput => {
    const b = balanceOf(id, { part, ...extra });
    const counted = (cents: number | null | undefined) => (cents === null || cents === undefined ? cents : partCents(cents, part));
    return { ...b, balanceCents: counted(b.balanceCents) as number | null, ...(b.creditLimitCents !== undefined ? { creditLimitCents: counted(b.creditLimitCents) } : {}) };
  };
  if (!members.length) {
    const ctx = contextOf(h);
    return [{ view: "household", member: null, accounts: h.accounts, balances: h.balances, parts: new Map(), txs: ctx.txs, ctx }];
  }
  const owners = new Map<string, string>();
  for (const m of members) for (const id of m.accountIds) owners.set(id, m.id);
  for (const s of shared) owners.set(s.accountId, s.linkedBy[0]!);
  const rows = members.flatMap((m) =>
    enriched(
      h,
      h.txs.filter((t) => owners.get(t.accountId) === m.id),
      h.accounts.filter((a) => owners.get(a.id) === m.id),
      // the IBANs of the other members' accounts, as the server reads them for each user (`ibansOutside`)
      new Set(h.accounts.filter((a) => owners.has(a.id) && owners.get(a.id) !== m.id && a.type !== "loan").flatMap((a) => normalizeIban(a.iban) ?? [])),
    ),
  );
  const all = byDateAndId([...rows]);
  const paired = detectTransfers(all, h.accounts, { issuerFallback: false });
  const household = all.map((t): Transaction => (paired.has(t.id) && !t.isTransfer && t.categorySource !== "user" ? { ...t, isTransfer: true, category: "transfer" } : t));
  const useMembers: UseMember[] = members.map((m) => ({ id: m.id, label: m.label, name: userNameOf(h.accounts.filter((a) => m.accountIds.includes(a.id))) }));
  const useOf = (s: SharedAccount): AccountUse => {
    const account = h.accounts.find((a) => a.id === s.accountId)!;
    const said = s.said ? saidUse(Object.entries(s.said).map(([userId, weight]) => ({ userId, weight })), account, s.linkedBy, useMembers) : null;
    return said ?? deriveUse(account, s.linkedBy, useMembers);
  };
  const uses = new Map(shared.map((s) => [s.accountId, useOf(s)]));
  const views: HouseholdView[] = [
    { view: "household", member: null, accounts: h.accounts, balances: h.balances.map((b) => balanceOf(b.id)), parts: new Map(h.accounts.map((a) => [a.id, WHOLE])), txs: household, ctx: createContext(household, h.accounts, h.today) },
  ];
  for (const m of members) {
    const parts = new Map<string, Part>();
    for (const a of h.accounts) {
      const part = uses.has(a.id) ? partOf(uses.get(a.id)!, m.id) : owners.get(a.id) === m.id ? WHOLE : undefined;
      if (part && part.to > part.from) parts.set(a.id, part);
    }
    const seen = h.accounts.filter((a) => parts.has(a.id));
    const txs = applyUse(
      all.filter((t) => parts.has(t.accountId)),
      seen,
      parts,
      owners,
    );
    views.push({ view: "own", member: m.id, accounts: seen, balances: seen.map((a) => countedAt(a.id, parts.get(a.id)!, uses.has(a.id) ? { use: uses.get(a.id)! } : {})), parts, txs, ctx: createContext(txs, seen, h.today) });
  }
  return views;
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
