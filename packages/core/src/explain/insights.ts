/**
 * The sentences of the insights, and the only place that makes them. An insight (`analysis/insights`) is data: a fact,
 * what it is set against, what to do next and what it is worth over a year. This file turns each part into one
 * sentence in the member's language from the vocabulary below, so a word is changed here and nowhere else. The title is the fact with its
 * number, the detail is the comparison and the action, the effect is the calc line of the year.
 */
import { CARD_COST_MONTHS } from "../analysis/credit.ts";
import { finnishList, formatEur, formatFiDate, monthInessive, monthNameIn } from "../analysis/format.ts";
import { capitalise, countWord, monthSpan } from "../analysis/insights/shared.ts";
import type { Action, Comparison, Insight, InsightFact, Quantity } from "../analysis/insights/types.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { type MessageCode, type MessageParams, messageIn } from "../messages.ts";

type InsightTone = "good" | "warning" | "info";

interface InsightText {
  /** The fact, with its number: at most eight words where the sentence allows. */
  title: string;
  /** The comparison and the action, two sentences. */
  detail: string;
  /** The comparison sentence alone. */
  comparison: string;
  /** The action sentence alone: the link text of its target. */
  action: string;
  /** What the insight is worth over a year, "−360 € vuodessa"; null when it has no yearly figure. */
  effect: string | null;
  tone: InsightTone;
}

const ESSIVE = ["", "yhtenä", "kahtena", "kolmena", "neljänä", "viitenä", "kuutena", "seitsemänä", "kahdeksana", "yhdeksänä", "kymmenenä"];
const INESSIVE = ["", "yhdessä", "kahdessa", "kolmessa", "neljässä", "viidessä", "kuudessa", "seitsemässä", "kahdeksassa", "yhdeksässä"];

/** The signed percentage as the text writes it: "+5 %", "−3 %", "±0 %". */
const signedPct = (p: number) => (p === 0 ? "±0 %" : `${p > 0 ? "+" : "−"}${Math.abs(p)} %`);
const WEEKDAY_CODES = ["ins.wd_0", "ins.wd_1", "ins.wd_2", "ins.wd_3", "ins.wd_4", "ins.wd_5", "ins.wd_6"] as const;

/** "maaliskuussa" for "2026-03", in English "March". */
const monthInessiveIn = (month: string, lang: Language): string => (lang === "en" ? monthNameIn(month, lang) : monthInessive(month));

const timesText = (ratio: number, lang: Language) => ratio.toFixed(1).replace(".", lang === "en" ? "." : ",");

/** The writers of one language: sums, dates and the sentences of the catalogue, so a fact reads as one call. */
function writer(lang: Language) {
  const eur = (cents: number) => formatEur(cents, false, lang);
  const eurExact = (cents: number) => formatEur(cents, cents % 100 !== 0, lang);
  const date = (iso: string) => formatFiDate(iso, lang);
  const list = (items: readonly string[]) => finnishList(items, lang);
  const text = <C extends MessageCode>(code: C, ...params: MessageParams<C>) => messageIn(lang, code, ...params);
  // a number as the language words it where it is a count of years or months: Finnish takes a case, English the plain word
  const essive = (n: number) => (lang === "en" ? countWord(n, lang) : (ESSIVE[n] ?? String(n)));
  const inessive = (n: number) => (lang === "en" ? String(n) : (INESSIVE[n] ?? String(n)));
  /** A quantity as the page writes it. */
  const quantity = (v: Quantity): string => {
    switch (v.unit) {
      case "cents":
        return eur(v.value);
      case "percent":
        return `${v.value} %`;
      case "count":
        return String(v.value);
      case "times":
        return timesText(v.value, lang);
      case "date":
        return date(v.value);
    }
  };
  return { eur, eurExact, date, list, text, essive, inessive, quantity };
}

function factText(f: InsightFact, lang: Language): string {
  const { eur, eurExact, date, text, essive, inessive } = writer(lang);
  const pct = (p: number) => `${p} %`;
  switch (f.type) {
    case "price-rise":
      return text(f.debt ? "ins.price_rise_debt" : "ins.price_rise", { merchant: f.merchant, price: eurExact(f.toCents) });
    case "price-rises":
      return text("ins.price_rises", { count: capitalise(countWord(f.merchants.length, lang)) });
    case "stopped":
      return f.freed ? text("ins.stopped_freed", { merchant: f.merchant, amount: eur(f.monthlyCents) }) : text("ins.stopped", { merchant: f.merchant, date: date(f.lastDate) });
    case "new-subscription":
      return text("ins.new_subscription", { merchant: f.merchant, price: eurExact(f.monthlyCents) });
    case "subscriptions-added":
      return text("ins.subscriptions_added", { now: f.now, added: f.merchants.length });
    case "renewal":
      return text("ins.renewal", { merchant: f.merchant, date: date(f.date), price: eurExact(f.cents) });
    case "renewals":
      return text(f.yearly ? "ins.renewals_yearly" : "ins.renewals", { count: capitalise(countWord(f.items.length, lang)), days: f.days, amount: eur(f.cents) });
    case "instalments":
      return f.services.length === 1
        ? text("ins.instalments_one", { service: f.services[0]!, amount: eur(f.monthlyCents) })
        : text("ins.instalments_many", { services: inessive(f.services.length), amount: eur(f.monthlyCents) });
    case "season":
      return text("ins.season", { month: capitalise(monthInessiveIn(f.month, lang)), amount: eur(f.extraCents), years: essive(f.years) });
    case "spending-growth":
      return text("ins.spending_growth", { change: signedPct(f.purchasesPercent) });
    case "commitments-share":
      return text("ins.commitments_share", { share: pct(f.percent) });
    case "debt-share":
      return text("ins.debt_share", { share: pct(f.percent) });
    case "credit-drawn":
      return text("ins.credit_drawn", { amount: eur(f.cents) });
    case "card-interest":
      return text("ins.card_interest", {
        cards: text(f.cards.length === 1 ? "ins.card_one" : "ins.card_many"),
        amount: eur(f.cents),
        period: f.months === CARD_COST_MONTHS ? text("ins.period_year") : text("ins.period_months", { n: f.months }),
      });
    case "groceries": {
      const percent = Math.abs(f.percent);
      return text(`ins.groceries_${f.byPrice ? "ticket" : "visits"}_${f.percent > 0 ? "up" : "down"}`, { percent });
    }
    case "payday":
      return text("ins.payday", { times: timesText(f.ratio, lang) });
    case "small-purchases":
      return text("ins.small_purchases", { limit: eur(f.limitCents), amount: eur(f.monthlyCents) });
    case "weekday":
      return text("ins.weekday", { weekday: text(WEEKDAY_CODES[f.weekday]!), amount: eur(f.cents) });
    case "income":
      return f.title;
  }
}

function comparisonText(c: Comparison, f: InsightFact, lang: Language): string {
  const { eur, eurExact, date, list, text, essive, quantity } = writer(lang);
  const value = quantity(c.value);
  const cents = c.value.unit === "cents" ? c.value.value : 0;
  switch (c.label) {
    case "before":
      if (f.type === "price-rise") return text("ins.cmp_before_rise", { price: eurExact(f.fromCents), date: date(f.since) });
      if (f.type === "new-subscription") {
        if (f.trial) return text("ins.cmp_before_trial", { date: date(f.trial.date), price: eurExact(f.trial.cents), first: date(f.firstDate) });
        return f.charges === 1 ? text("ins.cmp_first_charge_one", { date: date(f.firstDate) }) : text("ins.cmp_first_charge", { date: date(f.firstDate), charges: f.charges });
      }
      return text("ins.cmp_before", { value });
    case "yearAgo":
      if (f.type === "small-purchases") return text("ins.cmp_ya_small", { value, perMonth: f.perMonth, top: list(f.top) });
      if (f.type === "commitments-share") return text("ins.cmp_ya_share", { value });
      return cents === 0 && c.value.unit === "cents" ? text("ins.cmp_ya_none") : text("ins.cmp_ya", { value });
    case "yearAgoCost":
      return text("ins.cmp_ya_cost", { value, list: f.type === "price-rises" ? list(f.merchants) : "" });
    case "yearAgoSubscriptions": {
      const base = text("ins.cmp_ya_subs", { value });
      return f.type === "subscriptions-added" ? `${base} ${text("ins.cmp_ya_subs_new", { list: list(f.merchants), amount: eur(f.monthlyCents) })}` : base;
    }
    case "yearAgoTicket":
      return text("ins.cmp_ya_ticket", { value });
    case "yearAgoVisits":
      return f.type === "groceries" ? text("ins.cmp_ya_visits_now", { value, now: f.visitsPerMonth }) : text("ins.cmp_ya_visits", { value });
    case "expectedMonth": {
      const base = text("ins.cmp_expected_month", { value });
      return f.type === "season" && f.months.length > 1 ? `${base} ${text("ins.cmp_expected_repeat", { list: list(f.months.filter((m) => m !== f.month).map((m) => monthNameIn(m, lang))) })}` : base;
    }
    case "shareOfExpectedSpending": {
      const base = text("ins.cmp_share_spending", { value });
      return f.type === "instalments" && f.interestMonthlyCents > 0 ? `${base} ${text("ins.cmp_share_interest", { amount: eur(f.interestMonthlyCents) })}` : base;
    }
    case "shareOfExpectedIncome":
      return text("ins.cmp_share_income", { value });
    case "expectedIncome":
      return text("ins.cmp_expected_income", { value });
    case "limit":
      return text("ins.cmp_limit", { value });
    case "incomeChange": {
      const shown = f.type === "spending-growth" ? signedPct(c.value.unit === "percent" ? c.value.value : 0) : value;
      return f.type === "spending-growth" ? text("ins.cmp_income_change_span", { value: shown, span: monthSpan(f.first, f.last, lang) }) : text("ins.cmp_income_change", { value: shown });
    }
    case "incomeBefore":
      return cents === 0 && c.value.unit === "cents" ? text("ins.cmp_income_before_none") : text("ins.cmp_income_before", { value });
    case "paidInFull":
      return f.type === "card-interest" ? text("ins.cmp_paid_card", { months: essive(f.carried), cards: list(f.cards) }) : text("ins.cmp_paid", { value });
    case "weekBeforePay":
      return f.type === "payday" ? text("ins.cmp_week_before_cycles", { value, cycles: f.cycles, extra: eur(f.extraCents) }) : text("ins.cmp_week_before", { value });
    case "otherDays":
      return f.type === "weekday" ? text("ins.cmp_other_days_weeks", { value, weeks: f.weeks }) : text("ins.cmp_other_days", { value });
    case "lastCharge":
      if (f.type === "renewal") return text("ins.cmp_last_charge_dated", { amount: eurExact(cents), date: date(f.lastDate) });
      return f.type === "renewals" ? text("ins.cmp_last_charges", { value, list: list(f.items.map((i) => `${i.merchant} ${date(i.date)}`)) }) : text("ins.cmp_last_charge", { value });
    case "lastInstalment":
      return text("ins.cmp_last_instalment", { value });
    case "usualMonthly":
      if (f.type !== "stopped") return text("ins.cmp_usual", { value });
      return f.freed
        ? text("ins.cmp_usual_stopped_freed", { monthly: eur(f.monthlyCents), payments: f.payments, date: date(f.firstDate), paid: eurExact(f.paidCents) })
        : text("ins.cmp_usual_stopped", { monthly: eur(f.monthlyCents), payments: f.payments, date: date(f.firstDate), paid: eurExact(f.paidCents), last: eurExact(f.lastCents) });
  }
}

/** The sentence of an action; the target is data and the page opens it. */
const actionText = (a: Action, lang: Language): string => messageIn(lang, `ins.act_${a.label}`);

/** The tone each fact has: a cost or a debt warns, a pattern to look at informs, money freed or income gained is good. */
const WARNING: ReadonlySet<InsightFact["type"]> = new Set(["price-rise", "price-rises", "instalments", "debt-share", "credit-drawn", "card-interest", "commitments-share", "spending-growth"]);
const GOOD_INCOME: ReadonlySet<string> = new Set(["raise", "benefit_started", "new_source"]);

function toneOf(i: Insight): InsightTone {
  const f = i.fact;
  if (f.type === "stopped") return f.freed ? "good" : "info";
  if (f.type === "income") return f.monthlyCents < 0 ? "warning" : GOOD_INCOME.has(f.change) ? "good" : "info";
  return WARNING.has(f.type) ? "warning" : "info";
}

/** The three sentences and the effect of an insight, in a language (Finnish unless asked). */
export function insightText(i: Insight, lang: Language = DEFAULT_LANGUAGE): InsightText {
  const effect = i.effectPerYear ? messageIn(lang, "ins.effect", { value: i.effectPerYear.value }) : null;
  const comparison = comparisonText(i.comparison, i.fact, lang);
  const action = actionText(i.action, lang);
  return { title: factText(i.fact, lang), detail: `${comparison} ${action}`, comparison, action, effect, tone: toneOf(i) };
}

/** The facts whose figure is a change of spending and so shows its sign: more spending is "+", though it is a negative effect. */
const SPENDING_CHANGE: ReadonlySet<InsightFact["type"]> = new Set(["spending-growth", "groceries", "small-purchases", "season", "payday", "weekday"]);

/** What the figure of each fact is, lower case, by the euros it carries: "maksaa 276 € vuodessa". */
const READING: Record<InsightFact["type"], "ins.read_rise" | "ins.read_stopped" | "ins.read_costs" | "ins.read_added" | "ins.read_season" | "ins.read_growth_gap" | "ins.read_commitments" | "ins.read_debt" | "ins.read_drawn" | "ins.read_interest" | "ins.read_change" | "ins.read_payday" | "ins.read_plain"> = {
  "price-rise": "ins.read_rise",
  "price-rises": "ins.read_rise",
  stopped: "ins.read_stopped",
  "new-subscription": "ins.read_costs",
  "subscriptions-added": "ins.read_added",
  renewal: "ins.read_costs",
  renewals: "ins.read_costs",
  instalments: "ins.read_costs",
  season: "ins.read_season",
  "spending-growth": "ins.read_growth_gap",
  "commitments-share": "ins.read_commitments",
  "debt-share": "ins.read_debt",
  "credit-drawn": "ins.read_drawn",
  "card-interest": "ins.read_interest",
  groceries: "ins.read_change",
  payday: "ins.read_payday",
  "small-purchases": "ins.read_change",
  weekday: "ins.read_plain",
  income: "ins.read_plain",
};

/** The euros of an insight as its card writes them: the year's effect, signed for a change, and the sum drawn for credit. */
export function insightEuros(i: Insight, lang: Language = DEFAULT_LANGUAGE): string {
  const eur = (cents: number) => formatEur(cents, false, lang);
  const cents = i.fact.type === "credit-drawn" ? i.fact.cents : (i.effectPerYear?.cents ?? 0);
  const signed = SPENDING_CHANGE.has(i.fact.type) || i.fact.type === "income";
  if (!signed) return eur(Math.abs(cents));
  if (Math.abs(cents) < 100) return `±${eur(0)}`;
  const up = SPENDING_CHANGE.has(i.fact.type) ? cents < 0 : cents > 0;
  return `${up ? "+" : "−"}${eur(Math.abs(cents))}`;
}

/** The figure in words: "maksaa 276 € vuodessa". A stop that freed money reads "vapautui 276 € vuodessa". */
function insightReading(i: Insight, lang: Language = DEFAULT_LANGUAGE): string {
  const euros = insightEuros(i, lang);
  if (i.fact.type === "stopped" && i.fact.freed) return messageIn(lang, "ins.read_freed", { euros });
  return messageIn(lang, READING[i.fact.type], { euros });
}

/** The words under the figure: the reading without its euros ("maksaa vuodessa"). */
export function insightUnit(i: Insight, lang: Language = DEFAULT_LANGUAGE): string {
  return insightReading(i, lang).replace(insightEuros(i, lang), "").replace(/\s+/g, " ").trim();
}
