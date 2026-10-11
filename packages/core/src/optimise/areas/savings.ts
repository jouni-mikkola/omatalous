/**
 * Säästöt: money that has stayed on the checking accounts beyond a month of spending, priced at the household's own
 * savings yield. The yield and the account helpers are shared with the loans area.
 */
import type { AnalysisTx } from "../../analysis/context.ts";
import { formatEur, formatFiDate } from "../../analysis/format.ts";
import { dayNumber, daysInMonth, fromDayNumber } from "../../dates.ts";
import { balanceWalk, type BalanceWalk, lowestDayBalance } from "../../reports/balances.ts";
import { bufferReport } from "../../reports/buffer.ts";
import type { BalanceInput } from "../../types.ts";
import { accountsBefore, findingId } from "../common.ts";
import type { Area, AreaInput, Check, FindingDraft } from "../types.ts";

/** Idle money under this is not worth a move (the plan's gate). */
export const IDLE_MIN_CENTS = 200_000;
/** A yield under this makes the move worth too little to tell. */
const MIN_YIELD = 0.005;
/** Over this the "interest" cannot be a deposit rate. */
const MAX_YIELD = 0.05;
/** A savings row this many days from the same sum leaving another own account is the other leg of a move. */
const MIRROR_DAYS = 3;
/** The walk starts from the bank's balance: an older one leaves the last days a guess. */
const FRESH_BALANCE_DAYS = 7;
/**
 * Household signals that make the idle sum unreliable: money gone to an unconnected account, an account without a
 * balance. A gap or missing rows count only on the checking accounts the walk adds up: a card unused for two weeks
 * says nothing about them.
 */
const HOUSEHOLD_SIGNALS = new Set(["own_unconnected", "no_balance"]);
const WALK_SIGNALS = { gap: (name: string) => `Tilin ${name} tiedoissa on tauko.`, stale: (name: string) => `Tilin ${name} uusimpia tapahtumia ei ole haettu.` } as const;
/** A withholding tax the bank books as its own row beside the interest. */
const WITHHOLDING = /L[AÄ]HDEVERO/i;

const pctFormat = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 2 });
/** 0.0153 → "1,53 %". */
export const pct = (fraction: number) => `${pctFormat.format(fraction * 100)}\u00a0%`;
export const eur = (cents: number) => formatEur(cents, false);

/** The viewer's own accounts of a type: the money the viewer can move. */
export function ownAccounts(a: AreaInput, type: BalanceInput["type"]): BalanceInput[] {
  return a.balances.filter((b) => b.type === type && b.ownerName === null);
}

/** The last day of each window month as a day number. */
export function monthEndDays(months: readonly string[]): number[] {
  return months.map((m) => dayNumber(`${m}-${String(daysInMonth(m)).padStart(2, "0")}`));
}

/** The walks of accounts that all have a balance; null when one has none. */
export function walksOf(a: AreaInput, accounts: readonly BalanceInput[]): BalanceWalk[] | null {
  const walks = accounts.map((b) => balanceWalk(a.ctx, b));
  return walks.every((w): w is BalanceWalk => w !== null) ? walks : null;
}

export interface SavingsYield {
  /** Interest paid on the savings accounts in the window, less a withholding tax booked as its own row. */
  interestCents: number;
  /** Mean month-end balance of the savings accounts over the window. */
  meanBalanceCents: number;
  /** interest / mean balance: 0.015 is 1,5 %. */
  rate: number;
  /** The interest rows. */
  rows: string[];
  accounts: BalanceInput[];
  walks: BalanceWalk[];
}

/**
 * The household's own savings yield over 12 complete months: interest paid on its savings accounts divided by their
 * mean month-end balance. Finnish banks pay deposit interest after the withholding tax, so this is already the yield
 * after tax. A move between own accounts is never interest. Null without 12 complete months (a yearly interest
 * payment could fall outside a shorter window), without an own savings account, when one has no balance or when one
 * started inside the window.
 */
export function savingsYield(a: AreaInput): SavingsYield | null {
  if (a.months.length < 12) return null;
  const accounts = ownAccounts(a, "savings");
  const from = `${a.months[0]}-01`;
  const before = accountsBefore(a.ctx, from);
  if (!accounts.length || accounts.some((b) => !before.has(b.id))) return null;
  const walks = walksOf(a, accounts);
  if (!walks) return null;
  const ends = monthEndDays(a.months);
  const meanBalanceCents = Math.round(ends.reduce((s, day) => s + walks.reduce((t, w) => t + w.at(day)!, 0), 0) / ends.length);
  if (meanBalanceCents <= 0) return null;
  const ids = new Set(accounts.map((b) => b.id));
  const inWindow = (t: AnalysisTx) => ids.has(t.accountId) && !t.isTransfer && t.bookingDate >= from && t.bookingDate <= a.end;
  // the savings leg of a move from an own account can keep a text such as KORKO when only the other leg names the
  // account: the same sum leaving another own account within a few days makes it a move, never interest
  const own = new Set(a.ctx.accounts.map((acc) => acc.id));
  const mirrored = (t: AnalysisTx) =>
    a.ctx.txs.some((o) => o.accountId !== t.accountId && own.has(o.accountId) && o.amountCents === -t.amountCents && Math.abs(o.day - t.day) <= MIRROR_DAYS);
  const interest = a.ctx.txs.filter((t) => inWindow(t) && t.category === "investment_income" && t.amountCents > 0 && !mirrored(t));
  const tax = a.ctx.txs.filter((t) => inWindow(t) && t.amountCents < 0 && WITHHOLDING.test(`${t.description ?? ""} ${t.merchant} ${t.counterparty ?? ""}`));
  const interestCents = interest.reduce((s, t) => s + t.flows.income, 0) + tax.reduce((s, t) => s + t.amountCents, 0);
  const rate = Math.max(0, interestCents) / meanBalanceCents;
  // no deposit account pays this much: the rows are something else (a sale, a refund), so there is no yield to use
  if (rate > MAX_YIELD) return null;
  return { interestCents, meanBalanceCents, rate, rows: interest.map((t) => t.id), accounts, walks };
}

/** Spending in a usual month, the buffer's yardstick (median of complete months); null under three. */
export function usualSpend(a: AreaInput): number | null {
  const usual = bufferReport(a.ctx, a.balances, a.inputs).usualSpendCents;
  return usual !== null && usual > 0 ? usual : null;
}

const IDLE_ID = "savings:idle_cash";
const IDLE_LABEL = "Käyttötilin ylimääräinen saldo";
const ADD_CHECKING = "Lisää käyttötilin saldo kohdassa Asetukset > Tilit.";

function idleCash(a: AreaInput): { check: Check; draft?: FindingDraft } {
  const noData = (hint?: string) => ({ check: { id: IDLE_ID, label: IDLE_LABEL, status: "no_data" as const, ...(hint ? { hint } : {}) } });
  const checking = ownAccounts(a, "checking");
  if (!checking.length || checking.some((b) => b.balanceCents === null)) return noData(ADD_CHECKING);
  const todayDay = dayNumber(a.today);
  if (checking.some((b) => !b.balanceAt || todayDay - dayNumber(b.balanceAt.slice(0, 10)) > FRESH_BALANCE_DAYS)) return noData("Käyttötilin saldo on yli 7 päivää vanha.");
  const signal = a.quality.signals.find((s) => HOUSEHOLD_SIGNALS.has(s.id));
  if (signal) return noData(`${signal.title}.`);
  for (const b of checking) {
    const kind = (["gap", "stale"] as const).find((k) => a.quality.byAccount[b.id]?.includes(k));
    if (kind) return noData(WALK_SIGNALS[kind](b.name));
  }
  const yieldOf = savingsYield(a);
  if (!yieldOf) return noData("Säästötilin tuotto lasketaan säästötilin saldosta ja 12 kuukauden koroista.");
  const usual = usualSpend(a);
  const from = `${a.months[0]}-01`;
  const before = accountsBefore(a.ctx, from);
  const walks = walksOf(a, checking);
  // the lowest runs to today, so money spent since the window ended is not counted as idle
  const lowest = usual !== null && walks && checking.every((b) => before.has(b.id)) ? lowestDayBalance(walks, dayNumber(from), todayDay) : null;
  if (usual === null || !lowest) return noData();
  const idle = lowest.cents - usual;
  const clear = { check: { id: IDLE_ID, label: IDLE_LABEL, status: "clear" as const } };
  if (idle < IDLE_MIN_CENTS || yieldOf.rate < MIN_YIELD) return clear;
  const yearly = Math.round((idle * yieldOf.rate) / 100) * 100;
  const span = `${formatFiDate(from)}–${formatFiDate(a.today)}`;
  const draft: FindingDraft = {
    id: findingId("savings", "idle_cash"),
    area: "savings",
    kind: "idle_cash",
    subject: null,
    title:
      `${checking.length === 1 ? "Käyttötilillä" : "Käyttötileillä"} on ollut ${formatFiDate(from)} alkaen vähintään ${eur(lowest.cents)}, ja menot ovat tavallisesti ${eur(usual)} kuussa. ` +
      `${yieldOf.accounts.length === 1 ? "Säästötilin" : "Säästötilien"} tuotto oli ${pct(yieldOf.rate)}.`,
    action: "Siirrä ylimääräinen saldo säästötilille.",
    effort: "minuutteja",
    euros: { lowCents: yearly, midCents: yearly, highCents: yearly, assumption: "Summa siirretään omalle säästötilille samalla korolla." },
    decideBy: null,
    weaknesses: [],
    shared: false,
    calc: [
      { label: "Jakso", value: span },
      { label: `Käyttötilien pienin saldo (${formatFiDate(fromDayNumber(lowest.day))})`, value: eur(lowest.cents) },
      { label: "Menot tavallisesti kuussa", value: eur(usual) },
      { label: "Ylimääräinen saldo", value: eur(idle) },
      { label: "Säästötileille maksettu korko 12 kuukaudessa", value: eur(yieldOf.interestCents) },
      { label: "Säästötilien keskisaldo kuun lopussa", value: eur(yieldOf.meanBalanceCents) },
      { label: "Säästötilien tuotto", value: pct(yieldOf.rate) },
      { label: "Tuotto vuodessa", value: eur(yearly) },
    ],
    rows: yieldOf.rows,
    struck: [],
    claims: checking.map((b) => `account:${b.id}`),
    measure: { kind: "none", keys: [] },
    facts: [],
  };
  return { check: { id: IDLE_ID, label: IDLE_LABEL, status: "finding" }, draft };
}

export const savings: Area = {
  id: "savings",
  label: "Säästöt",
  assess: (a) => {
    const idle = idleCash(a);
    return { findings: idle.draft ? [idle.draft] : [], checks: [idle.check] };
  },
};
