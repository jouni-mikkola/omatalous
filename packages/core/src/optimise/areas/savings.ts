/**
 * Säästöt: money that has stayed on the checking accounts beyond a month of spending, priced at the household's own
 * savings yield. The yield and the account helpers are shared with the loans area.
 */
import { formatFiDate } from "../../analysis/format.ts";
import { dayNumber, fromDayNumber } from "../../dates.ts";
import { lowestDayBalance } from "../../reports/balances.ts";
import { accountsBefore, eur, findingId, ownAccounts, pct, savingsYield, usualSpend, walksOf } from "../common.ts";
import type { Area, AreaInput, Check, FindingDraft } from "../types.ts";

/** Idle money under this is not worth a move (the plan's gate). */
export const IDLE_MIN_CENTS = 200_000;
/** A yield under this makes the move worth too little to tell. */
const MIN_YIELD = 0.005;
/** The walk starts from the bank's balance: an older one leaves the last days a guess. */
const FRESH_BALANCE_DAYS = 7;
/**
 * Household signals that make the idle sum unreliable: money gone to an unconnected account, an account without a
 * balance. A gap or missing rows count only on the checking accounts the walk adds up: a card unused for two weeks
 * says nothing about them.
 */
const HOUSEHOLD_SIGNALS = new Set(["own_unconnected", "no_balance"]);

const IDLE_ID = "savings:idle_cash";
const IDLE_LABEL = "Käyttötilin ylimääräinen saldo";

function idleCash(a: AreaInput): { check: Check; draft?: FindingDraft } {
  const noData = () => ({ check: { id: IDLE_ID, label: IDLE_LABEL, status: "no_data" as const } });
  const checking = ownAccounts(a, "checking");
  if (!checking.length) return { check: { id: IDLE_ID, label: IDLE_LABEL, status: "no_subject" as const } };
  if (checking.some((b) => b.balanceCents === null)) return noData();
  const todayDay = dayNumber(a.today);
  if (checking.some((b) => !b.balanceAt || todayDay - dayNumber(b.balanceAt.slice(0, 10)) > FRESH_BALANCE_DAYS)) return noData();
  if (a.quality.signals.some((s) => HOUSEHOLD_SIGNALS.has(s.id))) return noData();
  if (checking.some((b) => (["gap", "stale"] as const).some((k) => a.quality.byAccount[b.id]?.includes(k)))) return noData();
  const yieldOf = savingsYield(a);
  if (!yieldOf) return noData();
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
    euros: { lowCents: yearly, midCents: yearly, highCents: yearly },
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
