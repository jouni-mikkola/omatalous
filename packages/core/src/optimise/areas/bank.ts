/**
 * Pankkikulut: the card tier against Nordea's price list and late fees, with 12 months of bank fees by price list line
 * as the summary. The rows are the ones the overview's alerts read (`isBankFee`, `isLateFee`). Left out: FX fees (no
 * original-currency field) and other banks' price lists.
 */
import { isBankFee, isLateFee, isLateFeeAlone } from "../../analysis/fees.ts";
import { type AnalysisTx, netPurchase } from "../../analysis/context.ts";
import { formatEur, formatFiDate, formatFiRange } from "../../analysis/format.ts";
import type { Language } from "../../locale.ts";
import { messageIn } from "../../messages.ts";
import { monthOf } from "../../dates.ts";
import { fold } from "../../merchant.ts";
import type { RecurringSeries } from "../../recurring.ts";
import type { Account } from "../../types.ts";
import { annualise, findingId, whyFacts, GATE_YEARLY_CENTS, netCost, rowsById } from "../common.ts";
import { type Fact, factLabel, factOn } from "../facts/index.ts";
import type { Area, AreaInput, AreaSummary, CalcLine, Check, FindingDraft } from "../types.ts";
import { isCardText, isNordeaAccount } from "../../wording.ts";

/** The price list lines in the page's order (`facts/bank.ts`). */
const PRICE_LINES = ["account", "banking_ids", "debit", "credit", "gold", "platinum"] as const;
/** The cards a cheaper Credit card can replace. Gold to Credit is 36 € a year and stays under the gate. */
const TIERS = ["gold", "platinum"] as const;
/** A card price charged this many times in a row is the card's fee, not a coincidence. */
const MIN_CHARGES = 6;
/** Debit and Credit cost the same, so a 2,99 fee off the card's own account is either. */
const debitOrCredit = (lang: Language) => messageIn(lang, "opt.bank_debit_or_credit");
/** A fee at one amount on one account in this many months is a monthly price, not a one-off. */
const MIN_LINE_MONTHS = 2;
/** A reminder fee or collection cost is tens of euros; a larger row pays something else too. */
const MAX_LATE_FEE_CENTS = 10000;
const CARD_LINES: ReadonlySet<string> = new Set(["debit", "credit", "gold", "platinum"]);

const priceFact = (line: string, today: string) => factOn(`nordea_price:${line}`, today);

/** Nordea's price list applies: by the IBAN, and for a card, which has none, by the bank of its connection. */
const isNordea = (a: Account | undefined) => !!a && isNordeaAccount(a);

const listDate = (f: Fact, lang: Language) => formatFiDate(f.validFrom, lang);

/** A fixed monthly bank fee series: the shape a card or account price takes. */
const isMonthlyFee = (s: RecurringSeries) => s.active && s.kind === "subscription" && s.cadence === "monthly" && s.category === "fees";

interface Window {
  months: ReadonlySet<string>;
  from: string;
  to: string;
}

function windowOf(a: AreaInput): Window | null {
  return a.months.length ? { months: new Set(a.months), from: `${a.months[0]}-01`, to: a.end } : null;
}

/** The series' rows oldest first, and the latest run of charges at exactly `cents`. */
function latestRun(s: RecurringSeries, byId: ReadonlyMap<string, AnalysisTx>, cents: number): AnalysisTx[] {
  const rows = s.transactionIds
    .map((id) => byId.get(id))
    .filter((t): t is AnalysisTx => !!t)
    .sort((x, y) => x.bookingDate.localeCompare(y.bookingDate));
  const run: AnalysisTx[] = [];
  for (let i = rows.length - 1; i >= 0 && -rows[i]!.amountCents === cents; i--) run.unshift(rows[i]!);
  return run;
}

function cardTiers(a: AreaInput, w: Window | null): FindingDraft[] {
  const lang = a.lang;
  const credit = priceFact("credit", a.today);
  if (!w || !credit) return [];
  const byId = rowsById(a.ctx);
  const accounts = new Map(a.ctx.accounts.map((acc) => [acc.id, acc]));
  const out: FindingDraft[] = [];
  for (const s of a.ctx.recurring.filter(isMonthlyFee)) {
    for (const tier of TIERS) {
      const fact = priceFact(tier, a.today);
      if (!fact || s.lastAmountCents !== fact.value || s.lastDate < fact.validFrom) continue;
      const run = latestRun(s, byId, fact.value);
      const account = accounts.get(run[0]?.accountId ?? "");
      if (run.length < MIN_CHARGES || account?.type !== "credit_card" || !isNordea(account)) continue;
      // the card is in use: purchases on its own account in the window
      const purchases = a.ctx.txs.filter((t) => t.accountId === account.id && w.months.has(monthOf(t.bookingDate)) && !t.isTransfer && netPurchase(t) > 0 && !isBankFee(t));
      if (!purchases.length) continue;
      // one card fee on the account: a second fee charged beside it (a 2,99 card and a 16,99 extra) is not a tier
      const since = run[0]!.bookingDate;
      const others = new Map<number, Set<string>>();
      for (const t of a.ctx.txs) {
        if (t.accountId !== account.id || t.bookingDate < since || t.category !== "fees" || !isBankFee(t) || -t.amountCents === fact.value) continue;
        others.set(t.amountCents, (others.get(t.amountCents) ?? new Set()).add(monthOf(t.bookingDate)));
      }
      if ([...others.values()].some((months) => months.size >= MIN_LINE_MONTHS)) continue;
      const yearly = (fact.value - credit.value) * 12;
      if (yearly < GATE_YEARLY_CENTS) continue;
      const bought = purchases.reduce((sum, t) => sum + netPurchase(t), 0);
      out.push({
        id: findingId("bank", "card_tier", s.id),
        area: "bank",
        kind: "card_tier",
        subject: s.id,
        title: messageIn(lang, "opt.bank_tier_title", { card: factLabel(fact, lang), fee: formatEur(fact.value, true, lang), credit: factLabel(credit, lang), creditFee: formatEur(credit.value, true, lang), yearly: formatEur(yearly, false, lang) }),
        action: messageIn(lang, "opt.bank_tier_action", { card: lang === "en" ? factLabel(credit, lang) : credit.label.replace(/ -kortti$/, " -korttiin") }),
        euros: { lowCents: yearly, midCents: yearly, highCents: yearly },
        decideBy: null,
        weaknesses: [{ id: "estimate", reason: messageIn(lang, "opt.bank_tier_weak") }],
        shared: false,
        calc: [
          { label: messageIn(lang, "opt.bank_card_fee", { account: account.name }), value: formatEur(fact.value, true, lang) },
          { label: messageIn(lang, "opt.bank_charges_price"), value: String(run.length) },
          { label: messageIn(lang, "opt.bank_list_line", { card: factLabel(fact, lang), date: listDate(fact, lang) }), value: `${formatEur(fact.value, true, lang)}${lang === "en" ? "/mo" : "/kk"}` },
          { label: messageIn(lang, "opt.bank_list_line", { card: factLabel(credit, lang), date: listDate(credit, lang) }), value: `${formatEur(credit.value, true, lang)}${lang === "en" ? "/mo" : "/kk"}` },
          { label: messageIn(lang, "opt.bank_bought", { span: formatFiRange(w.from, w.to, lang) }), value: formatEur(bought, false, lang) },
          { label: messageIn(lang, "opt.bank_diff"), value: formatEur(yearly, false, lang) },
        ],
        rows: run.map((t) => t.id),
        struck: [],
        claims: [`series:${s.id}`],
        measure: { kind: "series", keys: [s.id], perYear: 12 },
        facts: [fact.id, credit.id],
      });
    }
  }
  return out;
}

function lateFees(a: AreaInput, w: Window | null): FindingDraft[] {
  const lang = a.lang;
  if (!w) return [];
  const all = a.ctx.txs.filter((t) => w.months.has(monthOf(t.bookingDate)) && isLateFee(t) && netCost(t) > 0);
  // only a fee alone counts: a row that also pays the bill or the debt, or is over 100 €, is listed struck
  const rows = all.filter((t) => isLateFeeAlone(t) && netCost(t) <= MAX_LATE_FEE_CENTS);
  const left = all.filter((t) => !rows.includes(t));
  if (!rows.length) return [];
  const year = annualise(a.months.map((m) => rows.reduce((sum, t) => sum + (monthOf(t.bookingDate) === m ? netCost(t) : 0), 0)));
  if (!year || year.yearlyCents < GATE_YEARLY_CENTS) return [];
  const total = rows.reduce((sum, t) => sum + netCost(t), 0);
  const byMerchant = new Map<string, number>();
  for (const t of rows) byMerchant.set(t.merchant, (byMerchant.get(t.merchant) ?? 0) + netCost(t));
  const merchants = [...byMerchant].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const last = rows.reduce((d, t) => (t.bookingDate > d ? t.bookingDate : d), "");
  const count = rows.length === 1 ? messageIn(lang, "opt.bank_count_one") : messageIn(lang, "opt.bank_count_many", { n: rows.length });
  const calc: CalcLine[] = [
    ...merchants.slice(0, 5).map(([m, cents]) => ({ label: m, value: formatEur(cents, true, lang) })),
    ...(merchants.length > 5 ? [{ label: messageIn(lang, "opt.bank_others"), value: formatEur(merchants.slice(5).reduce((sum, [, c]) => sum + c, 0), true, lang) }] : []),
    { label: messageIn(lang, "opt.bank_total_span", { span: formatFiRange(w.from, w.to, lang) }), value: formatEur(total, false, lang) },
    ...(year.months < 12 ? [{ label: messageIn(lang, "opt.bank_yearly_from", { n: year.months }), value: formatEur(year.yearlyCents, false, lang) }] : []),
    { label: messageIn(lang, "opt.bank_charges"), value: String(rows.length) },
    { label: messageIn(lang, "opt.bank_last"), value: formatFiDate(last, lang) },
    ...(left.length ? [{ label: messageIn(lang, "opt.bank_left_out"), value: formatEur(left.reduce((sum, t) => sum + netCost(t), 0), true, lang), struck: true }] : []),
  ];
  return [
    {
      id: findingId("bank", "late_fees"),
      area: "bank",
      kind: "late_fees",
      subject: null,
      title: messageIn(lang, "opt.bank_late_title", { yearly: formatEur(year.yearlyCents, false, lang), count, date: formatFiDate(last, lang) }),
      action: messageIn(lang, "opt.bank_late_action"),
      euros: { lowCents: year.yearlyCents, midCents: year.yearlyCents, highCents: year.yearlyCents },
      decideBy: null,
      weaknesses: year.weakness ? [year.weakness] : [],
      shared: false,
      calc,
      rows: all.map((t) => t.id),
      struck: left.map((t) => t.id),
      // the rows counted, so a rise of the same merchant's bill never overlaps them in the headline
      claims: rows.map((t) => `row:${t.id}`),
      // a reminder fee comes on the same merchant's bills, so no measure separates it from them
      measure: { kind: "none", keys: [] },
      facts: [],
    },
  ];
}

/**
 * The price list line of fees at `cents` on `account`, or null. The account and the price must agree: the account and
 * banking id fees on the checking account, a card price on the card's own account or with card text in the message.
 */
function priceLineOf(cents: number, account: Account | undefined, cardText: boolean, today: string, lang: Language): string | null {
  if (!account || !isNordea(account)) return null;
  const matches = PRICE_LINES.filter((line) => {
    const f = priceFact(line, today);
    if (!f || f.value !== cents) return false;
    return CARD_LINES.has(line) ? account.type === "credit_card" || cardText : account.type === "checking";
  });
  if (matches.length <= 1) return matches[0] ? factLabel(priceFact(matches[0], today)!, lang) : null;
  // Debit and Credit share a price: on the card's own account it is the Credit card
  return account.type === "credit_card" ? factLabel(priceFact("credit", today)!, lang) : debitOrCredit(lang);
}

/** Bank fees of the window by price list line; no saving claimed. Absent without a fee in the window. */
function feeSummary(a: AreaInput, w: Window | null): AreaSummary | undefined {
  if (!w) return undefined;
  const lang = a.lang;
  const rows = a.ctx.txs.filter((t) => w.months.has(monthOf(t.bookingDate)) && isBankFee(t));
  if (!rows.length) return undefined;
  const accounts = new Map(a.ctx.accounts.map((acc) => [acc.id, acc]));
  // fees of one account at one amount, read row by row: one merchant's account, id and card fees make no single series
  const groups = new Map<string, AnalysisTx[]>();
  for (const t of rows) {
    if (t.category !== "fees") continue;
    const key = `${t.accountId}\u0000${-t.amountCents}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const labelOf = new Map<string, string>();
  for (const group of groups.values()) {
    if (new Set(group.map((t) => monthOf(t.bookingDate))).size < MIN_LINE_MONTHS) continue;
    const cardText = group.some((t) => isCardText(fold(t.description ?? "")));
    const label = priceLineOf(-group[0]!.amountCents, accounts.get(group[0]!.accountId), cardText, a.today, lang);
    if (label) for (const t of group) labelOf.set(t.id, label);
  }
  const sums = new Map<string, number>();
  for (const t of rows) {
    const label = t.category === "interest" ? messageIn(lang, "opt.bank_interest") : (labelOf.get(t.id) ?? messageIn(lang, "opt.bank_other_fees"));
    sums.set(label, (sums.get(label) ?? 0) + t.spend);
  }
  const order = [...PRICE_LINES.map((line) => { const f = priceFact(line, a.today); return f ? factLabel(f, lang) : ""; }), debitOrCredit(lang), messageIn(lang, "opt.bank_other_fees"), messageIn(lang, "opt.bank_interest")];
  const lines = [...sums].sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0])).map(([label, cents]) => ({ label, value: formatEur(cents, false, lang) }));
  const total = rows.reduce((sum, t) => sum + t.spend, 0);
  return { title: messageIn(lang, "opt.bank_sum_title", { span: formatFiRange(w.from, w.to, lang) }), lines: [...lines, { label: messageIn(lang, "opt.bank_total"), value: formatEur(total, false, lang) }] };
}

export const bank: Area = {
  id: "bank",
  label: "Pankkikulut",
  assess: (a) => {
    const w = windowOf(a);
    const list = TIERS.every((tier) => priceFact(tier, a.today)) && priceFact("credit", a.today);
    const hasFee = a.ctx.recurring.some(isMonthlyFee);
    const hasLate = !!w && a.ctx.txs.some((t) => w.months.has(monthOf(t.bookingDate)) && isLateFee(t) && netCost(t) > 0);
    const checks: Check[] = [
      { id: "bank:card_tier", label: messageIn(a.lang, "opt.bank_chk_tier"), status: !list ? "no_data" : hasFee ? "clear" : "no_subject", ...(!list ? { why: whyFacts(a.lang) } : {}) },
      { id: "bank:late_fees", label: messageIn(a.lang, "opt.bank_chk_late"), status: hasLate ? "clear" : "no_subject" },
    ];
    const summary = feeSummary(a, w);
    return { findings: [...cardTiers(a, w), ...lateFees(a, w)], checks, ...(summary ? { summary } : {}) };
  },
};
