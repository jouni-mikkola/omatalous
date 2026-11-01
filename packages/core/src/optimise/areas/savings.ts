/**
 * Säästöt: money that has stayed on the checking accounts beyond a month of spending, priced at the household's own
 * savings yield. The yield and the account helpers are shared with the loans area.
 */
import { formatFiDate, formatFiRange } from "../../analysis/format.ts";
import { messageIn } from "../../messages.ts";
import { dayNumber, fromDayNumber } from "../../dates.ts";
import { lowestDayBalance } from "../../reports/balances.ts";
import { accountsBefore, eur, findingId, ownAccounts, pct, savingsYield, expectedSpend, walksOf, whyHistory } from "../common.ts";
import type { Area, AreaInput, Check, FindingDraft, NoDataWhy } from "../types.ts";

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
const why = (a: AreaInput, code: "opt.sav_stale" | "opt.sav_holes" | "opt.sav_no_yield"): NoDataWhy => ({ cause: "other", text: messageIn(a.lang, code) });

function idleCash(a: AreaInput): { check: Check; draft?: FindingDraft } {
  const IDLE_LABEL = messageIn(a.lang, "opt.sav_idle");
  const STALE_BALANCE = why(a, "opt.sav_stale");
  const HOLES = why(a, "opt.sav_holes");
  const noData = (w: NoDataWhy) => ({ check: { id: IDLE_ID, label: IDLE_LABEL, status: "no_data" as const, why: w } });
  const checking = ownAccounts(a, "checking");
  if (!checking.length) return { check: { id: IDLE_ID, label: IDLE_LABEL, status: "no_subject" as const } };
  if (checking.some((b) => b.balanceCents === null)) return noData(STALE_BALANCE);
  const todayDay = dayNumber(a.today);
  if (checking.some((b) => !b.balanceAt || todayDay - dayNumber(b.balanceAt.slice(0, 10)) > FRESH_BALANCE_DAYS)) return noData(STALE_BALANCE);
  if (a.quality.signals.some((s) => HOUSEHOLD_SIGNALS.has(s.id))) return noData(HOLES);
  if (checking.some((b) => (["gap", "stale"] as const).some((k) => a.quality.byAccount[b.id]?.includes(k)))) return noData(HOLES);
  const yieldOf = savingsYield(a);
  if (!yieldOf) return noData(why(a, "opt.sav_no_yield"));
  const usual = expectedSpend(a);
  const from = `${a.months[0]}-01`;
  const before = accountsBefore(a.ctx, from);
  const walks = walksOf(a, checking);
  // the lowest runs to today, so money spent since the window ended is not counted as idle
  const lowest = usual !== null && walks && checking.every((b) => before.has(b.id)) ? lowestDayBalance(walks, dayNumber(from), todayDay) : null;
  // the usual spending (`expectedSpend`) needs three complete months
  if (usual === null || !lowest) return noData(whyHistory(a, 3));
  const idle = lowest.cents - usual;
  const clear = { check: { id: IDLE_ID, label: IDLE_LABEL, status: "clear" as const } };
  if (idle < IDLE_MIN_CENTS || yieldOf.rate < MIN_YIELD) return clear;
  const yearly = Math.round((idle * yieldOf.rate) / 100) * 100;
  const lang = a.lang;
  const span = formatFiRange(from, a.today, lang);
  const draft: FindingDraft = {
    id: findingId("savings", "idle_cash"),
    area: "savings",
    kind: "idle_cash",
    subject: null,
    title: messageIn(lang, `opt.sav_title_${checking.length === 1 ? (yieldOf.accounts.length === 1 ? "one" : "one_many") : yieldOf.accounts.length === 1 ? "many_one" : "many"}`, { from: formatFiDate(from, lang), low: eur(lowest.cents, lang), usual: eur(usual, lang), rate: pct(yieldOf.rate, lang) }),
    action: messageIn(lang, "opt.sav_action"),
    euros: { lowCents: yearly, midCents: yearly, highCents: yearly },
    decideBy: null,
    weaknesses: [],
    shared: false,
    calc: [
      { label: messageIn(lang, "opt.sav_period"), value: span },
      { label: messageIn(lang, "opt.sav_lowest", { date: formatFiDate(fromDayNumber(lowest.day), lang) }), value: eur(lowest.cents, lang) },
      { label: messageIn(lang, "opt.sav_expected"), value: eur(usual, lang) },
      { label: messageIn(lang, "opt.sav_extra"), value: eur(idle, lang) },
      { label: messageIn(lang, "opt.sav_interest"), value: eur(yieldOf.interestCents, lang) },
      { label: messageIn(lang, "opt.sav_mean"), value: eur(yieldOf.meanBalanceCents, lang) },
      { label: messageIn(lang, "opt.sav_yield"), value: pct(yieldOf.rate, lang) },
      { label: messageIn(lang, "opt.sav_yearly"), value: eur(yearly, lang) },
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
