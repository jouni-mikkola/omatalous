/**
 * Auto: what the car cost over the year, split by what it was for, and parking against the resident parking permit.
 * The summary claims no saving. Parking turns into euros only with the permit price the household typed in.
 */
import type { AnalysisTx } from "../../analysis/context.ts";
import { formatEur, formatFiDate } from "../../analysis/format.ts";
import { fold } from "../../merchant.ts";
import { monthOf } from "../../dates.ts";
import { annualise, findingId, levelWithoutOneOffs, MAX_ROWS, netCost } from "../common.ts";
import { valueOf } from "../inputs.ts";
import type { Area, AreaInput, AreaResult, AreaSummary, CalcLine, Check, FindingDraft, Weakness } from "../types.ts";

/** Parking under this much a year is not worth asking the permit price for (the brief's input gate). */
const PARKING_GATE_CENTS = 30_000;
/** The summary needs this many complete months, as a euro finding does (rule 2). */
const SUMMARY_MONTHS = 6;

const words = (list: string) => new RegExp(String.raw`(?<![A-Z0-9])(?:${list})(?![A-Z0-9])`);
const PARKING = words(String.raw`EASYPARK|PARKMAN|MOOVY|AIMO|AIMO PARK|APCOA|EUROPARK|Q-PARK|P-HUB|SCANDINAVIAN PARKING|PYSAKOINTI|PARKKI[A-Z]*`);
// the parking apps the permit comparison counts: street and zone parking, not a garage bought for one evening
const STREET_PARKING = words(String.raw`EASYPARK|PARKMAN|MOOVY|AIMO|AIMO PARK`);
const CHARGING = words(String.raw`K-LATAUS|VIRTA|PLUGIT|RECHARGE|IONITY|SUPERCHARGER|[A-Z]*LATAUS`);
const INSPECTION = words(String.raw`[A-Z-]*KATSASTUS[A-Z]*`);
const SERVICE = words(String.raw`RENGAS[A-Z]*|RENKAAT|AUTOHUOLTO|AUTOKORJAAMO|KORJAAMO|AUTOMAALAAMO|AUTOPALVELU|MEKONOMEN|EUROMASTER|VIANOR`);
const FUEL = words(String.raw`NESTE|ST1|ABC|SHELL|TEBOIL|SEO|GULF`);
const CAR_INSURANCE = words(String.raw`LIIKENNEVAKUUTUS|AUTOVAKUUTUS|AJONEUVOVAKUUTUS|KASKO[A-Z]*`);
const VEHICLE_TAX = words(String.raw`AJONEUVOVERO|TRAFICOM`);
// on a loans row: an instalment or loan that names the car ("OSAMAKSU AUTO SOPIMUS 4471"), or a car financier
const CAR_FINANCE = words(String.raw`AUTO|AUTON|AUTOLAINA|AUTORAHOITUS|AUTO-OSAMAKSU|AUTOSOPIMUS|SANTANDER|TOYOTA FINANCIAL|VOLKSWAGEN FINANCIAL`);

type Line = "fuel" | "charging" | "parking" | "service" | "inspection" | "insurance" | "tax" | "finance" | "other";

const LABELS: Readonly<Record<Line, string>> = {
  fuel: "Polttoaine",
  charging: "Sähkölataus",
  parking: "Pysäköinti",
  service: "Huolto ja renkaat",
  inspection: "Katsastus",
  insurance: "Liikenne- ja autovakuutus",
  tax: "Ajoneuvovero",
  finance: "Rahoitus",
  other: "Muut",
};

const textOf = (t: AnalysisTx) => fold(`${t.merchant} ${t.counterparty ?? ""} ${t.description ?? ""}`);
const mccOf = (t: AnalysisTx) => (t.mcc ? Number(t.mcc) : Number.NaN);

/** What a car row was for, or null for a row that is not about the car. */
function lineOf(t: AnalysisTx): Line | null {
  const text = textOf(t);
  const mcc = mccOf(t);
  if (t.category === "insurance") return CAR_INSURANCE.test(text) ? "insurance" : null;
  if (t.category === "taxes") return VEHICLE_TAX.test(text) ? "tax" : null;
  if (t.category === "loans") return CAR_FINANCE.test(text) ? "finance" : null;
  if (t.category !== "car") return null;
  if (mcc === 7523 || PARKING.test(text)) return "parking";
  if (mcc === 5552 || CHARGING.test(text)) return "charging";
  if (INSPECTION.test(text)) return "inspection";
  if ((mcc >= 7531 && mcc <= 7549) || SERVICE.test(text)) return "service";
  if (mcc === 5541 || mcc === 5542 || FUEL.test(text)) return "fuel";
  return "other";
}

/** Parking the resident permit could replace: a car row paid to a parking app or with the parking card code. */
const isStreetParking = (t: AnalysisTx) => !t.isTransfer && t.category === "car" && (mccOf(t) === 7523 || STREET_PARKING.test(textOf(t)));

const eur = (cents: number) => formatEur(cents, false);

const OUTSIDE_ZONE: Weakness = { id: "estimate", reason: "Mukana on myös pysäköinti asuinalueen ulkopuolella." };

function summaryOf(a: AreaInput): AreaSummary | null {
  if (a.months.length < SUMMARY_MONTHS) return null;
  const inWindow = new Set(a.months);
  const sums = new Map<Line, number>();
  for (const t of a.ctx.txs) {
    if (!inWindow.has(monthOf(t.bookingDate))) continue;
    const cost = netCost(t);
    const line = cost > 0 ? lineOf(t) : null;
    if (line) sums.set(line, (sums.get(line) ?? 0) + cost);
  }
  const total = [...sums.values()].reduce((s, x) => s + x, 0);
  if (!total) return null;
  const lines: CalcLine[] = (Object.keys(LABELS) as Line[]).filter((l) => sums.get(l)).map((l) => ({ label: LABELS[l], value: eur(sums.get(l)!) }));
  lines.push({ label: "Yhteensä", value: eur(total) });
  const km = valueOf(a.values, "car_km", a.today);
  if (km) {
    const yearly = Math.round((total / a.months.length) * 12);
    lines.push({ label: "Ajokilometrit vuodessa", value: `${new Intl.NumberFormat("fi-FI").format(km)}\u00a0km` }, { label: "Kilometriltä", value: formatEur(Math.round(yearly / km)) });
  }
  return { title: `Auton menot ${a.months.length} kuukaudessa`, lines };
}

function parkingOf(a: AreaInput): { finding: FindingDraft | null; check: Check | null } {
  const rows = a.ctx.txs.filter(isStreetParking);
  if (!rows.length) return { finding: null, check: null };
  const check: Check = { id: "car:parking", label: "Pysäköinti ja asukaspysäköintitunnus", status: "clear" };
  const level = levelWithoutOneOffs(rows, a.months);
  const year = annualise(level.byMonth);
  if (!year || year.yearlyCents < PARKING_GATE_CENTS) return { finding: null, check };
  const permit = valueOf(a.values, "parking_permit_price", a.today);
  if (permit === null) {
    return {
      finding: null,
      check: { ...check, status: "needs_input", input: "parking_permit_price", hint: "Lisää asukaspysäköintitunnuksen vuosihinta, niin pysäköintiä verrataan siihen." },
    };
  }
  const mid = year.yearlyCents - permit;
  if (mid <= 0) return { finding: null, check };
  const inWindow = new Set(a.months);
  const struck = new Set(level.struck);
  const inYear = rows.filter((t) => inWindow.has(monthOf(t.bookingDate)) && netCost(t) > 0);
  const counted = inYear.filter((t) => !struck.has(t.id)).length;
  const evidence = inYear.slice(-MAX_ROWS);
  const merchants = [...new Set(evidence.map((t) => t.merchant))].sort();
  const calc: CalcLine[] = [
    { label: "Kuukausia", value: String(year.months) },
    { label: "Pysäköintimaksuja", value: String(counted) },
    { label: "Pysäköinti vuodessa", value: eur(year.yearlyCents) },
    { label: "Asukaspysäköintitunnus vuodessa", value: eur(permit) },
    { label: "Erotus vuodessa", value: eur(mid) },
    ...evidence.filter((t) => struck.has(t.id)).map((t) => ({ label: `${t.merchant} ${formatFiDate(t.bookingDate)}`, value: formatEur(netCost(t)), struck: true })),
  ];
  return {
    check,
    finding: {
      id: findingId("car", "parking"),
      area: "car",
      kind: "parking",
      subject: null,
      title: `Pysäköinti ${eur(year.yearlyCents)} vuodessa, asukaspysäköintitunnus ${eur(permit)} vuodessa. Pohjana ${counted} pysäköintimaksua ${year.months} kuukaudessa.`,
      action: "Hae asukaspysäköintitunnus.",
      effort: "tunti",
      euros: { lowCents: mid, midCents: mid, highCents: mid, assumption: "Laskelma olettaa, että kaikki pysäköinti on asukaspysäköintialueella." },
      decideBy: null,
      weaknesses: year.weakness ? [OUTSIDE_ZONE, year.weakness] : [OUTSIDE_ZONE],
      shared: false,
      calc,
      rows: evidence.map((t) => t.id),
      struck: evidence.filter((t) => struck.has(t.id)).map((t) => t.id),
      claims: merchants.map((m) => `merchant:${m}`),
      measure: { kind: "merchants", keys: merchants },
      facts: [],
    },
  };
}

function assess(a: AreaInput): AreaResult {
  const summary = summaryOf(a);
  const parking = parkingOf(a);
  const checks: Check[] = [];
  if (parking.check) checks.push(parking.finding ? { ...parking.check, status: "finding" } : parking.check);
  // the summary asks for the yearly distance, so the page can offer the input
  if (summary) {
    const km = valueOf(a.values, "car_km", a.today);
    checks.push(
      km
        ? { id: "car:per_km", label: "Auton menot kilometriä kohden", status: "clear" }
        : { id: "car:per_km", label: "Auton menot kilometriä kohden", status: "needs_input", input: "car_km", hint: "Lisää vuoden ajokilometrit, niin auton menot lasketaan kilometriä kohden." },
    );
  }
  return { findings: parking.finding ? [parking.finding] : [], checks, ...(summary ? { summary } : {}) };
}

export const car: Area = { id: "car", label: "Auto", assess };
