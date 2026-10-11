/**
 * Puhelin ja tilaukset: price rises, overlapping services and renewals. Each reads the detector the overview uses
 * (`priceRiseItems`, `overlapGroups`, `renewalItems`), so both pages name the same series. Left out: forgotten
 * subscriptions (the overview's question and Toistuvat own them), usage and line counts (not in the data) and
 * operators' prices (no fact).
 */
import { overlapGroups } from "../../analysis/alerts.ts";
import type { AnalysisTx } from "../../analysis/context.ts";
import { finnishList, formatEur, formatFiDate } from "../../analysis/format.ts";
import { notAPrice, PLAN_CATEGORIES, priceRiseItems } from "../../analysis/insights/prices.ts";
import { renewalItems } from "../../analysis/insights/renewals.ts";
import { cancelledMerchants } from "../../commitments.ts";
import { addDays } from "../../dates.ts";
import type { RecurringSeries } from "../../recurring.ts";
import { findingId, GATE_YEARLY_CENTS, rowsById } from "../common.ts";
import type { Area, AreaInput, CalcLine, Check, FindingDraft } from "../types.ts";

/** Fewer charges than this at the old price leave the old price less certain: one step. */
const FEW_BEFORE = 6;
/** The renewal deadline lands in Seuraavat 60 päivää. */
const RENEW_DAYS = 60;

const COUNT_WORD = ["", "Yksi", "Kaksi", "Kolme", "Neljä", "Viisi", "Kuusi", "Seitsemän", "Kahdeksan", "Yhdeksän"];
const RENEWAL_NOUN: Readonly<Record<string, string>> = { yearly: "vuositilaus", semiannual: "puolivuotistilaus" };

/** A price as a single charge shows it: whole euros stay whole, 10,99 keeps its cents. */
const price = (cents: number) => formatEur(cents, cents % 100 !== 0);
const decimal = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
const payee = (merchant: string): CalcLine => ({ label: "Maksunsaaja", value: merchant });

/**
 * Whether anything but the default put the series in its category. A default "other" series is a payment nobody
 * recognised (one leg of a transfer, a payment to a person), so no finding calls it a subscription or a price.
 */
const recognised = (s: RecurringSeries, byId: ReadonlyMap<string, AnalysisTx>) => byId.get(s.transactionIds[s.transactionIds.length - 1] ?? "")?.categorySource !== "default";

function rises(a: AreaInput, cancelled: ReadonlySet<string>): FindingDraft[] {
  const byId = rowsById(a.ctx);
  return priceRiseItems(a.ctx, a.end)
    // phone and broadband beside the subscription set: contracts whose price the household can negotiate
    .filter(({ series: s, yearlyCents }) => PLAN_CATEGORIES.has(s.category) && yearlyCents >= GATE_YEARLY_CENTS && !cancelled.has(s.merchant) && recognised(s, byId))
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
        title: `${s.merchant}: hinta nousi ${formatEur(fromCents)} → ${formatEur(toCents)} ${formatFiDate(date)}. Nousu on ${formatEur(yearlyCents, false)} vuodessa.`,
        action: telecom ? "Neuvottele hinnasta tai kilpailuta liittymä." : "Neuvottele hinnasta tai irtisano tilaus.",
        effort: "minuutteja",
        euros: { lowCents: yearlyCents, midCents: yearlyCents, highCents: yearlyCents, assumption: "Jos hinta palaa entiselleen." },
        decideBy: null,
        weaknesses: before < FEW_BEFORE ? [{ id: "estimate", reason: `Vanhaa hintaa on veloitettu vain ${before} kertaa.` }] : [],
        shared: false,
        calc: [
          payee(s.merchant),
          { label: "Hinta ennen", value: formatEur(fromCents) },
          { label: "Hinta nyt", value: formatEur(toCents) },
          { label: "Uusi hinta alkaen", value: formatFiDate(date) },
          { label: "Veloituksia ennen nousua", value: String(before) },
          { label: "Veloituksia vuodessa", value: decimal(perYear) },
          { label: "Nousu vuodessa", value: formatEur(yearlyCents, false) },
        ],
        rows: dated.filter((t) => t.bookingDate >= addDays(date, -365)).map((t) => t.id),
        struck: [],
        claims: [`series:${s.id}`],
        measure: { kind: "series", keys: [s.id], perYear: Math.max(1, Math.round(perYear)) },
        facts: [],
      } satisfies FindingDraft;
    });
}

function overlaps(a: AreaInput, cancelled: ReadonlySet<string>): FindingDraft[] {
  return overlapGroups(a.ctx.recurring).flatMap((g): FindingDraft[] => {
    // a service the user marked cancelled is already being dropped
    const matched = g.matched.filter((m) => !cancelled.has(m.s.merchant));
    const brands = new Map<string, RecurringSeries[]>();
    for (const m of matched) brands.set(m.brand, [...(brands.get(m.brand) ?? []), m.s]);
    if (brands.size < 2) return [];
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
        title: `${COUNT_WORD[brands.size] ?? brands.size} ${g.noun} yhteensä ${formatEur(total)} kuussa: ${finnishList(names)}.`,
        action: "Irtisano yksi palveluista tai pidä palvelut voimassa vuorotellen.",
        effort: "minuutteja",
        euros: { lowCents: low, midCents: mid, highCents: high, assumption: "Yksi palvelu lopetetaan tai palvelut ovat voimassa vuorotellen." },
        decideBy: null,
        weaknesses: [{ id: "estimate", reason: "Tiedoista ei näy, kuka käyttää mitäkin palvelua." }],
        shared: false,
        calc: [
          ...series.map((s) => ({ label: s.merchant, value: `${price(s.monthlyCents)}/kk` })),
          { label: "Yhteensä kuussa", value: formatEur(total) },
          { label: "Halvin palvelu vuodessa", value: formatEur(low, false) },
          { label: "Muut kuin kallein vuodessa", value: formatEur(high, false) },
          { label: "Arvio vuodessa, vaihteluvälin keskikohta", value: formatEur(mid, false) },
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
  const byId = rowsById(a.ctx);
  return renewalItems(a.ctx, a.inputs, RENEW_DAYS)
    .filter((s) => s.yearlyCents >= GATE_YEARLY_CENTS && addDays(s.nextDate!, -1) >= a.today && recognised(s, byId))
    .map((s) => {
      const decideBy = addDays(s.nextDate!, -1);
      const noun = RENEWAL_NOUN[s.cadence ?? ""] ?? "tilaus";
      return {
        id: findingId("subscriptions", "renewal", s.id),
        area: "subscriptions",
        kind: "renewal",
        subject: s.id,
        title: `${s.merchant}: ${noun} uusiutuu ${formatFiDate(s.nextDate!)}, ${price(s.typicalAmountCents)}. Edellinen veloitus ${formatFiDate(s.lastDate)}.`,
        action: `Irtisano tilaus viimeistään ${formatFiDate(decideBy)}, jos et halua sen jatkuvan.`,
        effort: "minuutteja",
        euros: null,
        decideBy,
        weaknesses: [],
        shared: false,
        calc: [
          payee(s.merchant),
          { label: "Hinta", value: price(s.typicalAmountCents) },
          { label: "Edellinen veloitus", value: formatFiDate(s.lastDate) },
          { label: "Seuraava veloitus", value: formatFiDate(s.nextDate!) },
        ],
        rows: s.transactionIds.slice(-2),
        struck: [],
        claims: [`series:${s.id}`],
        measure: { kind: "series", keys: [s.id], perYear: s.cadence === "semiannual" ? 2 : 1 },
        facts: [],
      } satisfies FindingDraft;
    });
}

const CHECKS: readonly Check[] = [
  { id: "subscriptions:rise", label: "Sopimusten ja tilausten hinnat", status: "clear" },
  { id: "subscriptions:overlap", label: "Päällekkäiset palvelut", status: "clear" },
  { id: "subscriptions:renewal", label: "Uusiutuvat tilaukset", status: "clear" },
];

export const subscriptions: Area = {
  id: "subscriptions",
  label: "Puhelin ja tilaukset",
  assess: (a) => {
    const cancelled = cancelledMerchants(a.inputs);
    return { findings: [...rises(a, cancelled), ...overlaps(a, cancelled), ...renewals(a)], checks: CHECKS };
  },
};
