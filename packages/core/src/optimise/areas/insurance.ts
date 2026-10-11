/**
 * Vakuutukset: a premium whose last renewal rose more than consumer prices over the same twelve months, and the next
 * renewal of such a policy while there is time to compare. The rise comes from `priceRiseItems`, the detector of the
 * overview's price insight. Left out: two policies of one type (bank text rarely names the policy, and a cottage looks
 * the same), and which insurer to choose.
 */
import { formatEur, formatFiDate } from "../../analysis/format.ts";
import { priceRiseItems } from "../../analysis/insights/prices.ts";
import { addDays, addMonthsToDate, monthOf } from "../../dates.ts";
import type { RecurringSeries } from "../../recurring.ts";
import type { IsoDate } from "../../types.ts";
import { findingId, GATE_YEARLY_CENTS, yearlyAt } from "../common.ts";
import { factOn } from "../facts/index.ts";
import { inputKey, inputStatus, valueOf } from "../inputs.ts";
import type { Area, AreaInput, CalcLine, Check, FindingDraft } from "../types.ts";

/** The area's gate: the rise 5 percentage points over CPI of the same months, in tenths. */
const GATE_TENTHS = 50;
/** A renewal this many days ahead or fewer is a deadline. */
const RENEWAL_DAYS = 60;
/** Offers are asked for this many days before the renewal. */
const LEAD_DAYS = 14;

const RISE_LABEL = "Vakuutusmaksujen nousu";
const RENEWAL_LABEL = "Vakuutusten uusiutuminen";

const pct = new Intl.NumberFormat("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pctText = (tenths: number) => `${pct.format(tenths / 10)}\u00a0%`;
const pointsText = (tenths: number) => `${pct.format(tenths / 10)} prosenttiyksikköä`;

/** "15.2." in the current year, "15.2.2027" in another. */
const shortDate = (date: IsoDate, today: IsoDate) => (date.slice(0, 4) === today.slice(0, 4) ? formatFiDate(date).replace(/\d{4}$/, "") : formatFiDate(date));

/** A policy year starts at the price change: the next one a year later, or the yearly charge's own next date. */
function renewalOf(s: RecurringSeries): { date: IsoDate; label: string } {
  if (s.cadence === "yearly" && s.nextDate) return { date: s.nextDate, label: "Uusiutuu arviolta, vuosi edellisestä maksusta" };
  return { date: addMonthsToDate(s.priceChange!.date, 12), label: "Uusiutuu arviolta, vuosi edellisestä nousupäivästä" };
}

function assess(a: AreaInput): { findings: FindingDraft[]; checks: Check[] } {
  const { ctx, today, end } = a;
  const paysInsurance = ctx.txs.some((t) => !t.isTransfer && t.category === "insurance" && t.spend > 0 && t.bookingDate > addDays(end, -365) && t.bookingDate <= end);
  if (!paysInsurance) return { findings: [], checks: [{ id: "insurance:rise", label: RISE_LABEL, status: "no_data", hint: "Vakuutusmaksuja ei löytynyt 12 kuukauden ajalta." }] };

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
    const payee: CalcLine = { label: "Maksunsaaja", value: s.merchant };
    const riseLines: CalcLine[] = [
      { label: "Maksu ennen", value: formatEur(fromCents) },
      { label: `Maksu ${formatFiDate(date)} alkaen`, value: formatEur(toCents) },
      { label: "Nousu", value: pctText(riseT) },
      { label: cpi.label, value: pctText(cpiT) },
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
      title: `${s.merchant}: ${formatEur(fromCents)} → ${formatEur(toCents)} ${formatFiDate(date)} alkaen, nousua ${pctText(riseT)}. Kuluttajahintojen muutos samana aikana oli ${pctText(cpiT)}.`,
      action: "Kilpailuta vakuutus ennen seuraavaa uusiutumista.",
      effort: "tunti",
      euros: { lowCents: mid, midCents: mid, highCents: mid, assumption: "Jos maksu olisi noussut kuluttajahintojen verran." },
      decideBy: null,
      weaknesses: [{ id: "estimate", reason: "Vakuutusturvan muutos näkyy samanlaisena nousuna." }],
      calc: [payee, ...riseLines, { label: "Maksut ennen nousua vuodessa", value: formatEur(oldYearly, false) }, { label: `Nousu yli inflaation ${pointsText(excess)} × ${formatEur(oldYearly, false)}`, value: formatEur(mid, false) }],
      facts: [cpi.id],
    });

    const renewal = renewalOf(s);
    if (renewal.date < today || renewal.date > addDays(today, RENEWAL_DAYS)) continue;
    const lead = addDays(renewal.date, -LEAD_DAYS);
    const decideBy = lead >= today ? lead : renewal.date;
    const quoteKey = inputKey("insurance_quote", s.id);
    const quote = valueOf(a.values, "insurance_quote", today, s.id);
    const quoteStatus = inputStatus(a.values, quoteKey, today);
    const difference = quote === null ? 0 : newYearly - quote;
    // a typed offer gives the exact difference; under the gate the renewal stays a plain deadline
    const exact = quote !== null && difference >= GATE_YEARLY_CENTS;
    const renewalLines: CalcLine[] = [payee, { label: renewal.label, value: formatFiDate(renewal.date) }, { label: "Kilpailuta viimeistään", value: formatFiDate(decideBy) }];
    findings.push({
      ...base,
      id: findingId("insurance", "renewal", s.id),
      kind: "renewal",
      title: exact
        ? `${s.merchant}: uusiutuu arviolta ${formatFiDate(renewal.date)}, hinta ${formatEur(newYearly, false)} vuodessa ja tarjous ${formatEur(quote!, false)} vuodessa.`
        : `${s.merchant}: uusiutuu arviolta ${formatFiDate(renewal.date)}. Edellinen uusiutuminen nosti maksua ${pctText(riseT)}, kuluttajahintojen muutos oli ${pctText(cpiT)}.`,
      action: `Kilpailuta vakuutus ennen ${shortDate(decideBy, today)}`,
      effort: "tunti",
      euros: exact ? { lowCents: difference, midCents: difference, highCents: difference, assumption: "Jos vaihdat tarjouksen hintaan." } : null,
      decideBy,
      weaknesses: exact ? [] : [{ id: "estimate", reason: "Vakuutusturvan muutos näkyy samanlaisena nousuna." }],
      calc: exact
        ? [
            ...renewalLines,
            { label: "Hinta nyt vuodessa", value: formatEur(newYearly, false) },
            { label: `Tarjous, syötetty ${formatFiDate(quoteStatus.state === "ok" ? quoteStatus.stored.asOf : today)}`, value: formatEur(quote!, false) },
            { label: "Ero vuodessa", value: formatEur(difference, false) },
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
        ? { id: "insurance:rise", label: RISE_LABEL, status: "finding" }
        : noCpi
          ? { id: "insurance:rise", label: RISE_LABEL, status: "no_data", hint: "Kuluttajahintojen muutosta ei ole vielä julkaistu nousukuukaudelta." }
          : { id: "insurance:rise", label: RISE_LABEL, status: "clear" },
      { id: "insurance:renewal", label: RENEWAL_LABEL, status: kinds.has("renewal") ? "finding" : "clear" },
    ],
  };
}

export const insurance: Area = { id: "insurance", label: "Vakuutukset", assess };
