/**
 * Puhelin ja tilaukset: price rises, overlapping services and renewals. Each reads the detector the overview uses
 * (`priceRiseItems`, `overlapGroups`, `renewalItems`), so both pages name the same series. Left out: forgotten
 * subscriptions (the overview's question and Toistuvat own them), usage and line counts (not in the data) and
 * operators' prices (no fact). A subscription the household answered on Laskut or in an alert (Lopetettu, or Käytössä
 * within a year, `answeredSubscriptions`) has no finding: a rise counts as answered only by a Käytössä given after it.
 */
import { overlapGroups, overlapNoun } from "../../analysis/alerts.ts";
import type { AnalysisTx } from "../../analysis/context.ts";
import { finnishList, formatEur, formatFiDate } from "../../analysis/format.ts";
import { messageIn } from "../../messages.ts";
import type { Language } from "../../locale.ts";
import { notAPrice, PLAN_CATEGORIES, priceRiseItems } from "../../analysis/insights/prices.ts";
import { renewalItems } from "../../analysis/insights/renewals.ts";
import { answeredSubscriptions, answerOf, capitalise, countWord, type SubscriptionAnswer, settledBy } from "../../analysis/insights/shared.ts";
import { addDays } from "../../dates.ts";
import type { RecurringSeries } from "../../recurring.ts";
import { findingId, GATE_YEARLY_CENTS, rowsById } from "../common.ts";
import type { Area, AreaInput, CalcLine, Check, FindingDraft } from "../types.ts";

/** Fewer charges than this at the old price leave the old price less certain: one step. */
const FEW_BEFORE = 6;
/** The renewal deadline lands in Seuraavat 60 päivää. */
const RENEW_DAYS = 60;

const RENEWAL_NOUN = { yearly: "opt.sub_yearly", semiannual: "opt.sub_semiannual" } as const;

/** A price as a single charge shows it: whole euros stay whole, 10,99 keeps its cents. */
const price = (cents: number, lang: Language) => formatEur(cents, cents % 100 !== 0, lang);
const payee = (merchant: string, lang: Language): CalcLine => ({ label: messageIn(lang, "opt.sub_payee"), value: merchant });

/**
 * Whether anything but the default put the series in its category. A default "other" series is a payment nobody
 * recognised (one leg of a transfer, a payment to a person), so no finding calls it a subscription or a price.
 */
const recognised = (s: RecurringSeries, byId: ReadonlyMap<string, AnalysisTx>) => byId.get(s.transactionIds[s.transactionIds.length - 1] ?? "")?.categorySource !== "default";

type Answers = ReadonlyMap<string, SubscriptionAnswer>;

function rises(a: AreaInput, answered: Answers): FindingDraft[] {
  const lang = a.lang;
  const byId = rowsById(a.ctx);
  return priceRiseItems(a.ctx, a.end)
    // phone and broadband beside the subscription set: contracts whose price the household can negotiate
    .filter(({ series: s, yearlyCents }) => PLAN_CATEGORIES.has(s.category) && yearlyCents >= GATE_YEARLY_CENTS && !settledBy(answerOf(answered, s), s.priceChange!.date) && recognised(s, byId))
    .filter(({ series: s }) => !notAPrice(a.ctx, s))
    .map(({ series: s, yearlyCents }) => {
      const { fromCents, toCents, date } = s.priceChange!;
      const dated = s.transactionIds.map((id) => byId.get(id)).filter((t): t is AnalysisTx => !!t);
      const before = dated.filter((t) => t.bookingDate < date).length;
      const perYear = yearlyCents / (toCents - fromCents);
      const telecom = s.category === "telecom";
      return {
        id: findingId("subscriptions", "rise", s.id),
        area: "subscriptions",
        kind: "rise",
        subject: s.id,
        title: messageIn(lang, "opt.sub_rise_title", { merchant: s.merchant, date: formatFiDate(date, lang) }),
        action: messageIn(lang, telecom ? "opt.sub_rise_action_telecom" : "opt.sub_rise_action"),
        euros: { lowCents: yearlyCents, midCents: yearlyCents, highCents: yearlyCents },
        decideBy: null,
        weaknesses: before < FEW_BEFORE ? [{ id: "estimate", reason: before === 1 ? messageIn(lang, "opt.sub_old_once") : messageIn(lang, "opt.sub_old_times", { n: before }) }] : [],
        shared: false,
        calc: [
          payee(s.merchant, lang),
          { label: messageIn(lang, "opt.sub_new_from"), value: formatFiDate(date, lang) },
          { label: messageIn(lang, "opt.sub_rise_year"), value: formatEur(yearlyCents, false, lang) },
        ],
        rows: dated.filter((t) => t.bookingDate >= addDays(date, -365)).map((t) => t.id),
        struck: [],
        claims: [`series:${s.id}`],
        measure: { kind: "series", keys: [s.id], perYear: Math.max(1, Math.round(perYear)) },
        facts: [],
        change: { date, label: messageIn(lang, "opt.sub_new_price") },
      } satisfies FindingDraft;
    });
}

function overlaps(a: AreaInput, answered: Answers): FindingDraft[] {
  const lang = a.lang;
  return overlapGroups(a.ctx.recurring).flatMap((g): FindingDraft[] => {
    // a service the user marked cancelled is already being dropped
    const matched = g.matched.filter((m) => answerOf(answered, m.s)?.mark !== "cancelled");
    const brands = new Map<string, RecurringSeries[]>();
    for (const m of matched) brands.set(m.brand, [...(brands.get(m.brand) ?? []), m.s]);
    if (brands.size < 2) return [];
    // every service left marked in use: the household keeps them all, which answers the choice
    if (matched.every((m) => settledBy(answerOf(answered, m.s)))) return [];
    const monthly = [...brands.values()].map((list) => list.reduce((sum, s) => sum + s.monthlyCents, 0)).sort((x, y) => x - y);
    const total = monthly.reduce((sum, x) => sum + x, 0);
    // dropping the cheapest saves the least; keeping only the dearest is the most a rotation saves for sure
    const low = monthly[0]! * 12;
    const high = (total - monthly[monthly.length - 1]!) * 12;
    const mid = Math.round((low + high) / 2);
    if (mid < GATE_YEARLY_CENTS) return [];
    const series = matched.map((m) => m.s);
    const names = [...new Set(series.map((s) => s.merchant))];
    const since = addDays(a.end, -365);
    const byId = rowsById(a.ctx);
    return [
      {
        id: findingId("subscriptions", "overlap", g.type),
        area: "subscriptions",
        kind: "overlap",
        subject: g.type,
        title: messageIn(lang, "opt.sub_overlap_title", { count: capitalise(countWord(brands.size, lang)), noun: overlapNoun(g.type, lang), total: formatEur(total, true, lang), names: finnishList(names, lang) }),
        action: messageIn(lang, "opt.sub_overlap_action"),
        euros: { lowCents: low, midCents: mid, highCents: high },
        decideBy: null,
        weaknesses: [{ id: "estimate", reason: messageIn(lang, "opt.sub_overlap_weak") }],
        shared: false,
        calc: [
          ...series.map((s) => ({ label: s.merchant, value: `${price(s.monthlyCents, lang)}${lang === "en" ? "/mo" : "/kk"}` })),
          { label: messageIn(lang, "opt.sub_total_month"), value: formatEur(total, true, lang) },
          { label: messageIn(lang, "opt.sub_cheapest"), value: formatEur(low, false, lang) },
          { label: messageIn(lang, "opt.sub_not_dearest"), value: formatEur(high, false, lang) },
          { label: messageIn(lang, "opt.sub_estimate"), value: formatEur(mid, false, lang) },
        ],
        rows: series.flatMap((s) => s.transactionIds.filter((id) => (byId.get(id)?.bookingDate ?? "") > since)),
        struck: [],
        claims: series.map((s) => `series:${s.id}`),
        measure: { kind: "series", keys: series.map((s) => s.id), perYear: 12 },
        facts: [],
      },
    ];
  });
}

function renewals(a: AreaInput): FindingDraft[] {
  const lang = a.lang;
  const byId = rowsById(a.ctx);
  return renewalItems(a.ctx, a.inputs, RENEW_DAYS)
    .filter((s) => s.yearlyCents >= GATE_YEARLY_CENTS && addDays(s.nextDate!, -1) >= a.today && recognised(s, byId))
    .map((s) => {
      const decideBy = addDays(s.nextDate!, -1);
      const noun = messageIn(lang, s.cadence === "yearly" || s.cadence === "semiannual" ? RENEWAL_NOUN[s.cadence] : "opt.sub_plain");
      return {
        id: findingId("subscriptions", "renewal", s.id),
        area: "subscriptions",
        kind: "renewal",
        subject: s.id,
        title: messageIn(lang, "opt.sub_renew_title", { merchant: s.merchant, noun, next: formatFiDate(s.nextDate!, lang), price: price(s.typicalAmountCents, lang), last: formatFiDate(s.lastDate, lang) }),
        action: messageIn(lang, "opt.sub_renew_action", { date: formatFiDate(decideBy, lang) }),
        euros: null,
        decideBy,
        weaknesses: [],
        shared: false,
        calc: [
          payee(s.merchant, lang),
          { label: messageIn(lang, "opt.sub_price"), value: price(s.typicalAmountCents, lang) },
          { label: messageIn(lang, "opt.sub_last_charge"), value: formatFiDate(s.lastDate, lang) },
          { label: messageIn(lang, "opt.sub_next_charge"), value: formatFiDate(s.nextDate!, lang) },
        ],
        rows: s.transactionIds.slice(-2),
        struck: [],
        claims: [`series:${s.id}`],
        measure: { kind: "series", keys: [s.id], perYear: s.cadence === "semiannual" ? 2 : 1 },
        facts: [],
      } satisfies FindingDraft;
    });
}

const checks = (lang: Language): readonly Check[] => [
  { id: "subscriptions:rise", label: messageIn(lang, "opt.sub_chk_rise"), status: "clear" },
  { id: "subscriptions:overlap", label: messageIn(lang, "opt.sub_chk_overlap"), status: "clear" },
  { id: "subscriptions:renewal", label: messageIn(lang, "opt.sub_chk_renewal"), status: "clear" },
];

export const subscriptions: Area = {
  id: "subscriptions",
  label: "Puhelin ja tilaukset",
  assess: (a) => {
    const answered = answeredSubscriptions(a.inputs, a.today);
    // no contract or subscription series at all: the three checks have no subject
    const any = a.ctx.recurring.some((s) => s.kind === "subscription" || PLAN_CATEGORIES.has(s.category));
    const findings = [...rises(a, answered), ...overlaps(a, answered), ...renewals(a)];
    return { findings, checks: any ? checks(a.lang) : checks(a.lang).map((c) => ({ ...c, status: "no_subject" as const })) };
  },
};
