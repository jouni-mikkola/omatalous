/**
 * Sähkö: the household's price per kWh over 12 complete months against Statistics Finland's mean for its consumption
 * band, and the end of a fixed-term contract. Both the seller's and the network company's bills must be there: one of
 * them alone gives a price too low to compare. The yearly kWh is one typed number (`electricity_kwh`), never Datahub.
 * Left out: spot against fixed (no verdict), hourly use, district heat, water and waste.
 */
import type { AnalysisContext, AnalysisTx } from "../../analysis/context.ts";
import { formatEur, formatFiDate } from "../../analysis/format.ts";
import { addDays, dayNumber, monthOf } from "../../dates.ts";
import { fold } from "../../merchant.ts";
import { median } from "../../stats.ts";
import type { IsoDate } from "../../types.ts";
import { accountsBefore, findingId, levelWithoutOneOffs, MAX_ROWS } from "../common.ts";
import { type Fact, factOn } from "../facts/index.ts";
import { inputStatus, valueOf } from "../inputs.ts";
import type { Area, AreaInput, CalcLine, Check, FindingDraft } from "../types.ts";

/** The table's household bands by yearly kWh, dearest per kWh first; the fact id is `electricity_price:<id>`. */
const BANDS: readonly { id: string; max: number }[] = [
  { id: "A", max: 999 },
  { id: "B", max: 2_499 },
  { id: "C", max: 4_999 },
  { id: "D", max: 15_000 },
  { id: "E", max: Infinity },
];

/** The area's gate: 2 c/kWh over the band, in tenths of a cent. */
const GATE_TENTHS = 20;
/** Over twice the band's price the bills hold something else (heat, a wrong kWh): no comparison. */
const MAX_FACTOR = 2;
/** The contract is put out to tender this many days before it ends. */
const CONTRACT_LEAD_DAYS = 14;

export type BillKind = "seller" | "network" | "both";

// heat, water and waste come from the same companies and are no electricity
const NOT_ELECTRICITY = /LAMPO|VESI|JATE/;
// network companies (DSOs) bill the network only; checked before the sellers, so "Helen Sähköverkko" is a network
const NETWORK = /SAHKOVERKKO|VERKKO|VERKOT|SIIRTO|CARUNA|ELENIA|JARVI-SUOMEN ENERGIA|ROVAKAIRA/;
const SELLER = /FORTUM|VATTENFALL|OOMI|\bVARE\b|HELEN|LUMME|NORDIC GREEN|SAHKO/;
// a cooperative distributes and sells to its members on one bill
const BOTH = /SAHKOOSUUSKUNTA/;

/**
 * What an electricity bill pays for: TOL 35.14 (trade) or 35.13 (distribution) from the user's register lookups,
 * else the payee list. Another industry code says the company bills something else. Null for no electricity bill.
 */
export function billKind(t: Pick<AnalysisTx, "merchant" | "counterparty" | "description" | "category">, industry: ReadonlyMap<string, string>): BillKind | null {
  if (t.category !== "utilities") return null;
  const name = fold(t.merchant);
  if (NOT_ELECTRICITY.test(fold(`${name} ${t.counterparty ?? ""} ${t.description ?? ""}`))) return null;
  if (BOTH.test(name)) return "both";
  const code = industry.get(t.merchant);
  if (code?.startsWith("3514")) return "seller";
  if (code?.startsWith("3513")) return "network";
  // gas, district heat or another trade: whatever the name says, the bill is for something else
  if (code && code !== "35" && !code.startsWith("351")) return null;
  if (NETWORK.test(name)) return "network";
  return SELLER.test(name) ? "seller" : null;
}

const one = new Intl.NumberFormat("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("fi-FI");
const perKwh = (tenths: number) => `${one.format(tenths / 10)}\u00a0c/kWh`;
const kwhText = (kwh: number) => `${whole.format(kwh)}\u00a0kWh`;
const tenthsOf = (f: Fact) => Math.round(f.value * 10);

const PRICE_LABEL = "Sähkön hinta";
const CONTRACT_LABEL = "Sähkösopimuksen päättyminen";

interface Bills {
  bills: { t: AnalysisTx; kind: BillKind }[];
  /** Money in from the same payees (credits, refunds): netted against the bills whether a refund was matched or not. */
  credits: AnalysisTx[];
}

/** The electricity bills and credits of the window: rows on accounts that existed before it. */
function billsOf(ctx: AnalysisContext, a: AreaInput, months: readonly string[], from: IsoDate): Bills {
  const before = accountsBefore(ctx, from);
  const inWindow = new Set(months);
  const rows = ctx.txs.filter((t) => !t.isTransfer && inWindow.has(monthOf(t.bookingDate)) && before.has(t.accountId));
  const bills: Bills["bills"] = [];
  for (const t of rows) {
    const kind = t.spend > 0 ? billKind(t, a.industry) : null;
    if (kind) bills.push({ t, kind });
  }
  const payees = new Set(bills.map((b) => b.t.merchant));
  return { bills, credits: rows.filter((t) => t.amountCents > 0 && payees.has(t.merchant)) };
}

const CADENCES = [
  { months: 1, days: 30.44, tolerance: 5 },
  { months: 2, days: 60.88, tolerance: 8 },
  { months: 3, days: 91.31, tolerance: 12 },
];

/** Months one bill covers, by the median gap between the payee's bills (monthly, bimonthly, quarterly), or null. */
function monthsPerBill(ctx: AnalysisContext, merchant: string, industry: ReadonlyMap<string, string>): number | null {
  const days = ctx.txs.filter((t) => t.merchant === merchant && !t.isTransfer && t.spend > 0 && billKind(t, industry)).map((t) => dayNumber(t.bookingDate));
  const gaps = days.slice(1).map((d, i) => d - days[i]!);
  if (!gaps.length) return null;
  const gap = median(gaps);
  return CADENCES.find((c) => Math.abs(gap - c.days) <= c.tolerance)?.months ?? null;
}

/**
 * Whether the counted bills of one side (energy or network) cover exactly the 12 months: 12 monthly, 6 bimonthly or 4
 * quarterly bills, summed over payees so a switch of seller still fits. A thirteenth payment would raise the price.
 */
function coversYear(ctx: AnalysisContext, side: readonly AnalysisTx[], industry: ReadonlyMap<string, string>): boolean {
  let months = 0;
  for (const merchant of new Set(side.map((t) => t.merchant))) {
    const each = monthsPerBill(ctx, merchant, industry);
    if (each === null) return false;
    months += each * side.filter((t) => t.merchant === merchant).length;
  }
  return months === 12;
}

function priceCheck(status: Check["status"], hint?: string, input?: string): Check {
  return { id: "electricity:price", label: PRICE_LABEL, status, ...(hint ? { hint } : {}), ...(input ? { input } : {}) };
}

function assessPrice(a: AreaInput): { finding: FindingDraft | null; check: Check } {
  const { ctx, today } = a;
  if (a.months.length < 12) return { finding: null, check: priceCheck("no_data", "Vertailuun tarvitaan 12 täyttä kuukautta.") };
  const from = `${a.months[0]}-01`;
  const moved = valueOf(a.values, "moved_on", today);
  // the bills of the old home are another household's use: the year starts after the move
  if (moved && moved >= from) return { finding: null, check: priceCheck("no_data", "Muuton jälkeen on alle 12 täyttä kuukautta.") };
  const { bills, credits } = billsOf(ctx, a, a.months, from);
  if (!bills.length) return { finding: null, check: priceCheck("no_data", "Sähkölaskuja ei löytynyt 12 kuukauden ajalta.") };
  const sellers = bills.filter((b) => b.kind !== "network");
  const networks = bills.filter((b) => b.kind !== "seller");
  if (!networks.length) return { finding: null, check: priceCheck("no_data", "Verkkoyhtiön laskuja ei löytynyt 12 kuukauden ajalta.") };
  if (!sellers.length) return { finding: null, check: priceCheck("no_data", "Sähkönmyyjän laskuja ei löytynyt 12 kuukauden ajalta.") };
  // two network companies in one year are two addresses: the typed kWh is for one of them
  if (new Set(networks.map((b) => b.t.merchant)).size > 1) return { finding: null, check: priceCheck("no_data", "Verkkolaskuja on kahdelta yhtiöltä 12 kuukauden ajalta.") };
  // a row over three times its payee's median (a connection fee, a final bill) leaves the level and the count
  const struck = new Set(levelWithoutOneOffs(bills.map((b) => b.t), a.months).struck);
  const counted = bills.filter((b) => !struck.has(b.t.id));
  for (const side of [counted.filter((b) => b.kind !== "network"), counted.filter((b) => b.kind !== "seller")]) {
    if (!coversYear(ctx, side.map((b) => b.t), a.industry)) return { finding: null, check: priceCheck("no_data", "12 kuukauden laskut eivät kata täsmälleen yhtä vuotta.") };
  }
  const kwh = valueOf(a.values, "electricity_kwh", today);
  if (kwh === null) return { finding: null, check: priceCheck("needs_input", "Lisää vuosikulutus, niin hintaa verrataan saman kokoluokan keskihintaan.", "electricity_kwh") };
  const at = BANDS.findIndex((b) => kwh <= b.max);
  const band = factOn(`electricity_price:${BANDS[at]!.id}`, today);
  if (!band) return { finding: null, check: priceCheck("no_data", "Vertailutieto on vanhentunut.") };
  const dearer = at > 0 ? factOn(`electricity_price:${BANDS[at - 1]!.id}`, today) : null;
  const cheaper = at < BANDS.length - 1 ? factOn(`electricity_price:${BANDS[at + 1]!.id}`, today) : null;

  // whole bills less every credit from the same payees: a matched refund counts once, an unmatched one too
  const sum = (kind: BillKind) => counted.filter((b) => b.kind === kind).reduce((s, b) => s + b.t.spend, 0);
  const creditSum = credits.reduce((s, t) => s + t.amountCents, 0);
  const total = sum("seller") + sum("network") + sum("both") - creditSum;
  if (total <= 0) return { finding: null, check: priceCheck("clear") };
  const own = Math.round((total / kwh) * 10);
  const bandT = tenthsOf(band);
  if (own > MAX_FACTOR * bandT) return { finding: null, check: priceCheck("no_data", "Hinta on yli kaksi kertaa kokoluokan keskihinta: tarkista vuosikulutus.") };
  // the band's edges lie halfway to the neighbouring bands' means: the price this household could expect is between them
  const lowEdge = dearer ? Math.round(((band.value + dearer.value) / 2) * 10) : bandT;
  const highEdge = cheaper ? Math.round(((band.value + cheaper.value) / 2) * 10) : bandT;
  const gap = own - bandT;
  if (gap < GATE_TENTHS || own <= lowEdge) return { finding: null, check: priceCheck("clear") };
  const euros = (edge: number) => Math.round(((own - edge) * kwh) / 10);
  const mid = euros(bandT);

  const stored = inputStatus(a.values, "electricity_kwh", today);
  const kwhDate = stored.state === "ok" ? stored.stored.asOf : today;
  const sellerSum = sum("seller");
  const networkSum = sum("network");
  const bothSum = sum("both");
  const struckRows = bills.filter((b) => struck.has(b.t.id)).map((b) => b.t);
  const calc: CalcLine[] = [
    ...(sellerSum ? [{ label: "Sähkönmyyjän laskut 12 kuukaudessa", value: formatEur(sellerSum, false) }] : []),
    ...(networkSum ? [{ label: "Verkkoyhtiön laskut 12 kuukaudessa", value: formatEur(networkSum, false) }] : []),
    ...(bothSum ? [{ label: "Myynnin ja siirron yhteislaskut 12 kuukaudessa", value: formatEur(bothSum, false) }] : []),
    ...(creditSum ? [{ label: "Hyvitykset samoilta yhtiöiltä", value: formatEur(-creditSum, false) }] : []),
    ...struckRows.map((t) => ({ label: `${t.merchant} ${formatFiDate(t.bookingDate)}, kertaluonteinen`, value: formatEur(t.spend), struck: true })),
    { label: "Sähkölaskut yhteensä", value: formatEur(total, false) },
    { label: `Vuosikulutus, syötetty ${formatFiDate(kwhDate)}`, value: kwhText(kwh) },
    { label: "Oma hinta", value: perKwh(own) },
    { label: band.label, value: perKwh(bandT) },
    ...(dearer ? [{ label: "Vertailuhinta enintään, puolivälissä pienemmän kulutuksen kokoluokkaan", value: perKwh(lowEdge) }] : []),
    ...(cheaper ? [{ label: "Vertailuhinta vähintään, puolivälissä suuremman kulutuksen kokoluokkaan", value: perKwh(highEdge) }] : []),
    { label: `Ero ${perKwh(gap)} × ${kwhText(kwh)}`, value: formatEur(mid, false) },
  ];
  // the one-offs stay among the rows, the latest bills fill the rest
  const kept = struckRows.slice(0, MAX_ROWS).map((t) => t.id);
  const used = new Set([...counted.map((b) => b.t.id), ...credits.map((t) => t.id)]);
  const evidence = ctx.txs.filter((t) => used.has(t.id)).map((t) => t.id);
  const rows = [...kept, ...evidence.slice(Math.max(0, evidence.length - (MAX_ROWS - kept.length)))];
  const merchants = [...new Set(bills.map((b) => b.t.merchant))].sort();
  const finding: FindingDraft = {
    id: findingId("electricity", "price"),
    area: "electricity",
    kind: "price",
    subject: null,
    title: `Sähkö ${perKwh(own)}, kokoluokan keskihinta ${perKwh(bandT)}. Laskut ${formatEur(total, false)} ja kulutus ${kwhText(kwh)} 12 kuukaudessa.`,
    action: "Kilpailuta sähkösopimus Energiaviraston hintavertailussa sahkonhinta.fi.",
    effort: "tunti",
    euros: { lowCents: euros(lowEdge), midCents: mid, highCents: euros(highEdge), assumption: "Jos hinta laskee kokoluokan keskihintaan." },
    decideBy: null,
    weaknesses: [{ id: "estimate", reason: "Vertailuhinta on saman kokoluokan kotitalouksien keskiarvo." }],
    shared: false,
    calc,
    rows,
    struck: kept,
    claims: merchants.map((m) => `merchant:${m}`),
    measure: { kind: "unit", keys: merchants, perYear: 12 },
    facts: [band, dearer, cheaper].filter((f): f is Fact => !!f).map((f) => f.id),
  };
  return { finding, check: priceCheck("finding") };
}

/** A typed contract end: put it out to tender two weeks before. A deadline, so no euros. */
function assessContract(a: AreaInput, hasBills: boolean): { finding: FindingDraft | null; check: Check | null } {
  const { today } = a;
  const end = valueOf(a.values, "electricity_contract_end", today);
  const check: Check = { id: "electricity:contract_end", label: CONTRACT_LABEL, status: "clear" };
  if (!end) {
    // asked only of a household that pays electricity bills; an open-ended contract leaves it unanswered
    return { finding: null, check: hasBills ? { ...check, status: "needs_input", input: "electricity_contract_end", hint: "Lisää määräaikaisen sopimuksen päättymispäivä." } : null };
  }
  const lead = addDays(end, -CONTRACT_LEAD_DAYS);
  const decideBy = lead >= today ? lead : end;
  const stored = inputStatus(a.values, "electricity_contract_end", today);
  const typed = stored.state === "ok" ? stored.stored.asOf : today;
  const short = decideBy.slice(0, 4) === today.slice(0, 4) ? formatFiDate(decideBy).replace(/\d{4}$/, "") : formatFiDate(decideBy);
  const finding: FindingDraft = {
    id: findingId("electricity", "contract_end"),
    area: "electricity",
    kind: "contract_end",
    subject: null,
    title: `Sähkösopimus päättyy ${formatFiDate(end)}.`,
    action: `Kilpailuta sopimus ennen ${short}`,
    effort: "tunti",
    euros: null,
    decideBy,
    weaknesses: [],
    shared: false,
    calc: [
      { label: `Sopimus päättyy, syötetty ${formatFiDate(typed)}`, value: formatFiDate(end) },
      { label: "Kilpailuta viimeistään", value: formatFiDate(decideBy) },
    ],
    rows: [],
    struck: [],
    claims: [],
    measure: { kind: "none", keys: [] },
    facts: [],
  };
  return { finding, check: { ...check, status: "finding" } };
}

export const electricity: Area = {
  id: "electricity",
  label: "Sähkö",
  assess: (a) => {
    const price = assessPrice(a);
    const hasBills = a.ctx.txs.some((t) => !t.isTransfer && t.spend > 0 && t.bookingDate > addDays(a.end, -365) && billKind(t, a.industry) !== null);
    const contract = assessContract(a, hasBills);
    return {
      findings: [price.finding, contract.finding].filter((f): f is FindingDraft => !!f),
      checks: [price.check, ...(contract.check ? [contract.check] : [])],
    };
  },
};
