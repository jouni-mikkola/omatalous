/**
 * Vakuutukset: a premium whose last renewal rose more than consumer prices over the same twelve months, and the next
 * renewal of such a policy while there is time to compare. The rise comes from `priceRiseItems`, the detector of the
 * overview's price insight. Left out: two policies of one type (bank text rarely names the policy, and a cottage looks
 * the same), and which insurer to choose.
 */
import { localeOf, type Language } from "../../locale.ts";
import { messageIn } from "../../messages.ts";
import { formatEur, formatFiDate, formatFiDateIn } from "../../analysis/format.ts";
import { priceRiseItems } from "../../analysis/insights/prices.ts";
import { addDays, addMonthsToDate, monthOf } from "../../dates.ts";
import type { RecurringSeries } from "../../recurring.ts";
import type { IsoDate } from "../../types.ts";
import { findingId, GATE_YEARLY_CENTS, whyFacts, yearlyAt } from "../common.ts";
import { factLabel, factOn } from "../facts/index.ts";
import { inputKey, inputStatus, valueOf } from "../inputs.ts";
import type { Area, AreaInput, CalcLine, Check, FindingDraft } from "../types.ts";

/** The area's gate: the rise 5 percentage points over CPI of the same months, in tenths. */
const GATE_TENTHS = 50;
/** A renewal this many days ahead or fewer is a deadline. */
const RENEWAL_DAYS = 60;
/** Offers are asked for this many days before the renewal. */
const LEAD_DAYS = 14;

const pct = (tenths: number, lang: Language) => new Intl.NumberFormat(localeOf(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(tenths / 10);
const pctText = (tenths: number, lang: Language) => `${pct(tenths, lang)}\u00a0%`;
const pointsText = (tenths: number, lang: Language) => messageIn(lang, "opt.c_points", { n: pct(tenths, lang) });

/** "15.2." in the current year, "15.2.2027" in another. */

/** A policy year starts at the price change: the next one a year later, or the yearly charge's own next date. */
function renewalOf(s: RecurringSeries, lang: Language): { date: IsoDate; label: string } {
  if (s.cadence === "yearly" && s.nextDate) return { date: s.nextDate, label: messageIn(lang, "opt.ins_renews_paid") };
  return { date: addMonthsToDate(s.priceChange!.date, 12), label: messageIn(lang, "opt.ins_renews_rise") };
}

function assess(a: AreaInput): { findings: FindingDraft[]; checks: Check[] } {
  const { ctx, today, end, lang } = a;
  const paysInsurance = ctx.txs.some((t) => !t.isTransfer && t.category === "insurance" && t.spend > 0 && t.bookingDate > addDays(end, -365) && t.bookingDate <= end);
  if (!paysInsurance) return { findings: [], checks: [{ id: "insurance:rise", label: messageIn(lang, "opt.ins_rise_chk"), status: "no_subject" }] };

  const findings: FindingDraft[] = [];
  let noCpi = false;
  for (const { series: s } of priceRiseItems(ctx, end).filter((r) => r.series.category === "insurance")) {
    const { fromCents, toCents, date } = s.priceChange!;
    const cpi = factOn(`cpi_yoy:${monthOf(date)}`, today);
    if (!cpi) {
      noCpi = true;
      continue;
    }
    const riseT = Math.round(((toCents - fromCents) / fromCents) * 1000);
    const cpiT = Math.round(cpi.value * 10);
    const excess = riseT - cpiT;
    const newYearly = yearlyAt(s, toCents);
    // a policy under the item gate a year is not worth an evening of offers
    if (excess < GATE_TENTHS || newYearly < GATE_YEARLY_CENTS) continue;
    const oldYearly = yearlyAt(s, fromCents);
    const mid = Math.round((oldYearly * excess) / 1000);
    const perYear = Math.max(1, Math.round(oldYearly / fromCents));
    const payee: CalcLine = { label: messageIn(lang, "opt.ins_payee"), value: s.merchant };
    const riseLines: CalcLine[] = [
      { label: messageIn(lang, "opt.ins_before"), value: formatEur(fromCents, true, lang) },
      { label: messageIn(lang, "opt.ins_from", { date: formatFiDate(date, lang) }), value: formatEur(toCents, true, lang) },
      { label: messageIn(lang, "opt.ins_rise"), value: pctText(riseT, lang) },
      { label: factLabel(cpi, lang), value: pctText(cpiT, lang) },
    ];
    const base = {
      area: "insurance" as const,
      subject: s.id,
      shared: false,
      rows: s.transactionIds.slice(-60),
      struck: [],
      claims: [`series:${s.id}`],
      measure: { kind: "series" as const, keys: [s.id], perYear },
    };
    findings.push({
      ...base,
      id: findingId("insurance", "rise", s.id),
      kind: "rise",
      title: messageIn(lang, "opt.ins_title", { merchant: s.merchant, from: formatEur(fromCents, true, lang), to: formatEur(toCents, true, lang), date: formatFiDate(date, lang), rise: pctText(riseT, lang), cpi: pctText(cpiT, lang) }),
      action: messageIn(lang, "opt.ins_action"),
      euros: { lowCents: mid, midCents: mid, highCents: mid },
      decideBy: null,
      weaknesses: [{ id: "estimate", reason: messageIn(lang, "opt.ins_weak") }],
      calc: [payee, ...riseLines, { label: messageIn(lang, "opt.ins_yearly_before"), value: formatEur(oldYearly, false, lang) }, { label: messageIn(lang, "opt.ins_over", { points: pointsText(excess, lang), yearly: formatEur(oldYearly, false, lang) }), value: formatEur(mid, false, lang) }],
      facts: [cpi.id],
    });

    const renewal = renewalOf(s, lang);
    if (renewal.date < today || renewal.date > addDays(today, RENEWAL_DAYS)) continue;
    const lead = addDays(renewal.date, -LEAD_DAYS);
    const decideBy = lead >= today ? lead : renewal.date;
    const quoteKey = inputKey("insurance_quote", s.id);
    const quote = valueOf(a.values, "insurance_quote", today, s.id);
    const quoteStatus = inputStatus(a.values, quoteKey, today);
    const difference = quote === null ? 0 : newYearly - quote;
    // a typed offer gives the exact difference; under the gate the renewal stays a plain deadline
    const exact = quote !== null && difference >= GATE_YEARLY_CENTS;
    const renewalLines: CalcLine[] = [payee, { label: renewal.label, value: formatFiDate(renewal.date, lang) }, { label: messageIn(lang, "opt.ins_by"), value: formatFiDate(decideBy, lang) }];
    findings.push({
      ...base,
      id: findingId("insurance", "renewal", s.id),
      kind: "renewal",
      title: exact
        ? messageIn(lang, "opt.ins_renew_exact", { merchant: s.merchant, date: formatFiDate(renewal.date, lang), price: formatEur(newYearly, false, lang), quote: formatEur(quote!, false, lang) })
        : messageIn(lang, "opt.ins_renew_title", { merchant: s.merchant, date: formatFiDate(renewal.date, lang), rise: pctText(riseT, lang), cpi: pctText(cpiT, lang) }),
      action: messageIn(lang, "opt.ins_renew_action", { date: formatFiDateIn(decideBy, today, lang) }),
      euros: exact ? { lowCents: difference, midCents: difference, highCents: difference } : null,
      decideBy,
      weaknesses: exact ? [] : [{ id: "estimate", reason: messageIn(lang, "opt.ins_weak") }],
      calc: exact
        ? [
            ...renewalLines,
            { label: messageIn(lang, "opt.ins_now_year"), value: formatEur(newYearly, false, lang) },
            { label: messageIn(lang, "opt.ins_offer", { date: formatFiDate(quoteStatus.state === "ok" ? quoteStatus.stored.asOf : today, lang) }), value: formatEur(quote!, false, lang) },
            { label: messageIn(lang, "opt.ins_diff"), value: formatEur(difference, false, lang) },
          ]
        : [...renewalLines, ...riseLines.slice(2)],
      ...(quote === null ? { needs: [quoteKey] } : {}),
      facts: exact ? [] : [cpi.id],
    });
  }

  const kinds = new Set(findings.map((f) => f.kind));
  return {
    findings,
    checks: [
      kinds.has("rise")
        ? { id: "insurance:rise", label: messageIn(lang, "opt.ins_rise_chk"), status: "finding" }
        : noCpi
          ? { id: "insurance:rise", label: messageIn(lang, "opt.ins_rise_chk"), status: "no_data", why: whyFacts(lang) }
          : { id: "insurance:rise", label: messageIn(lang, "opt.ins_rise_chk"), status: "clear" },
      { id: "insurance:renewal", label: messageIn(lang, "opt.ins_renewal_chk"), status: kinds.has("renewal") ? "finding" : "clear" },
    ],
  };
}

export const insurance: Area = { id: "insurance", label: "Vakuutukset", assess };
