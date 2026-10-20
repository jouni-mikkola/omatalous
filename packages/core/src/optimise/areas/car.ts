/**
 * Auto: what the car cost over the year, split by what it was for, and parking against the resident parking permit.
 * The summary claims no saving. Parking turns into euros only with the permit price the household typed in. A lease is
 * a running cost whatever its category; a row of the category Auton osto is a car bought once, shown apart and left out of the
 * running cost and of the yearly figure per kilometre. A household with no car row at all has a check that says so.
 */
import type { AnalysisTx } from "../../analysis/context.ts";
import { formatEur, formatFiDate } from "../../analysis/format.ts";
import { fold } from "../../merchant.ts";
import { monthOf } from "../../dates.ts";
import { annualise, findingId, levelWithoutOneOffs, MAX_ROWS, netCost } from "../common.ts";
import { valueOf } from "../inputs.ts";
import type { Area, AreaInput, AreaResult, AreaSummary, CalcLine, Check, FindingDraft, Weakness } from "../types.ts";
import { mccKind } from "../../industry.ts";
import { type CarLine as Line, carLineOf as lineOf } from "../../themes.ts";
import { isStreetParkingText } from "../../wording.ts";

/** Parking under this much a year is not worth asking the permit price for (the brief's input gate). */
const PARKING_GATE_CENTS = 30_000;
/** The summary needs this many complete months, as a euro finding does (rule 2). */
const SUMMARY_MONTHS = 6;

/** In the order the summary prints them. `purchase` is no running cost: it comes after the total. */
const LABELS: Readonly<Record<Line, string>> = {
  fuel: "Polttoaine",
  charging: "Sähkölataus",
  parking: "Pysäköinti",
  service: "Huolto ja renkaat",
  inspection: "Katsastus",
  insurance: "Liikenne- ja autovakuutus",
  tax: "Ajoneuvovero",
  finance: "Rahoitus",
  lease: "Leasing",
  other: "Muut",
  purchase: "Auton osto, ei mukana summassa",
};

const textOf = (t: AnalysisTx) => fold(`${t.merchant} ${t.counterparty ?? ""} ${t.description ?? ""}`);

/** Parking the resident permit could replace: a car row paid to a parking app or with the parking card code. */
const isStreetParking = (t: AnalysisTx) => !t.isTransfer && t.category === "car" && (mccKind(t.mcc) === "parking" || isStreetParkingText(textOf(t)));

const eur = (cents: number) => formatEur(cents, false);

const OUTSIDE_ZONE: Weakness = { id: "estimate", reason: "Mukana on myös pysäköinti asuinalueen ulkopuolella." };

/** What the car cost in the window, by line. Every row is on one line, so the lines add up to the rows. */
function costsOf(a: AreaInput): Map<Line, number> {
  const inWindow = new Set(a.months);
  const sums = new Map<Line, number>();
  for (const t of a.ctx.txs) {
    if (!inWindow.has(monthOf(t.bookingDate))) continue;
    const cost = netCost(t);
    const line = cost > 0 ? lineOf(t) : null;
    if (line) sums.set(line, (sums.get(line) ?? 0) + cost);
  }
  return sums;
}

function summaryOf(a: AreaInput, sums: ReadonlyMap<Line, number>): AreaSummary | null {
  const purchase = sums.get("purchase") ?? 0;
  const total = [...sums].reduce((s, [line, x]) => (line === "purchase" ? s : s + x), 0);
  if (!total && !purchase) return null;
  const lines: CalcLine[] = (Object.keys(LABELS) as Line[]).filter((l) => l !== "purchase" && sums.get(l)).map((l) => ({ label: LABELS[l], value: eur(sums.get(l)!) }));
  if (total) lines.push({ label: "Yhteensä", value: eur(total) });
  const km = total ? valueOf(a.values, "car_km", a.today) : null;
  if (km) {
    const yearly = Math.round((total / a.months.length) * 12);
    lines.push({ label: "Ajokilometrit vuodessa", value: `${new Intl.NumberFormat("fi-FI").format(km)}\u00a0km` }, { label: "Kilometriä kohden", value: formatEur(Math.round(yearly / km)) });
  }
  if (purchase) lines.push({ label: LABELS.purchase, value: eur(purchase) });
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
      check: { ...check, status: "needs_input", input: "parking_permit_price" },
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
    { label: "Ero vuodessa", value: eur(mid) },
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
      euros: { lowCents: mid, midCents: mid, highCents: mid },
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
  const sums = a.months.length >= SUMMARY_MONTHS ? costsOf(a) : null;
  const summary = sums && summaryOf(a, sums);
  const parking = parkingOf(a);
  const checks: Check[] = [];
  if (parking.check) checks.push(parking.finding ? { ...parking.check, status: "finding" } : parking.check);
  // a household with no car row has nothing to add up: the area says so and is not counted as looked at
  if (sums && !summary) checks.push({ id: "car:cost", label: "Auton menot", status: "no_rows" });
  // the summary asks for the yearly distance, so the page can offer the input
  if (summary) {
    const km = valueOf(a.values, "car_km", a.today);
    checks.push(
      km
        ? { id: "car:per_km", label: "Auton menot kilometriä kohden", status: "clear" }
        : { id: "car:per_km", label: "Auton menot kilometriä kohden", status: "needs_input", input: "car_km" },
    );
  }
  return { findings: parking.finding ? [parking.finding] : [], checks, ...(summary ? { summary } : {}) };
}

export const car: Area = { id: "car", label: "Auto", assess };
