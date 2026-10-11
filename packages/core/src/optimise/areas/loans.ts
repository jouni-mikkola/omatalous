/**
 * Lainat: the mortgage margin against sample offers, prepaying the mortgage from savings beyond a three-month buffer,
 * and card interest paid in months when the checking account could have paid the whole bill. Rates come from the
 * user's `loan_rate` input and the Euribor facts; the deposit yield is the household's own (`savingsYield`).
 */
import type { AnalysisTx } from "../../analysis/context.ts";
import { formatFiDate } from "../../analysis/format.ts";
import { addMonths, monthOf } from "../../dates.ts";
import type { RecurringSeries } from "../../recurring.ts";
import type { BalanceWalk } from "../../reports/balances.ts";
import type { BalanceInput } from "../../types.ts";
import { annualise, findingId, MAX_ROWS, netCost, rowsById } from "../common.ts";
import { type Fact, factOn, isSampleFact } from "../facts/index.ts";
import { valueOf } from "../inputs.ts";
import type { Area, AreaInput, Check, FindingDraft, LoanReference, LoanRateValue } from "../types.ts";
import { eur, monthEndDays, ownAccounts, pct, savingsYield, usualSpend, walksOf } from "./savings.ts";

/** The margin finding needs a margin this far over the offers' top: 0,2 percentage points, in hundredths of a percent. */
const MARGIN_OVER_TOP_BP = 20;
/** Savings beyond the buffer under this are not worth a prepayment (the plan's gate). */
const PREPAY_MIN_CENTS = 200_000;
/** The loan rate must beat the deposit yield by this much, in percentage points. */
const PREPAY_MIN_SPREAD = 1.5;
/** The buffer kept on savings: three months of usual spending, as in the buffer report. */
const BUFFER_MONTHS = 3;
/** A monthly mortgage series of this many payments is a running loan, not a one-off. */
const MIN_PAYMENTS = 6;
/** The months a reference rate stays fixed between resets. The reset date is unknown, so the rate is somewhere in them. */
const RESET_MONTHS: Record<Exclude<LoanReference, "fixed">, number> = { euribor_12: 12, euribor_6: 6, euribor_3: 3 };
/** How far back the latest Euribor month may lie before the facts count as missing. */
const REFERENCE_LAG_MONTHS = 2;

const ADD_LOAN_BALANCE = "Lisää lainatilin saldo kohdassa Asetukset > Tilit.";
const FACTS_OLD = "Vertailutieto on vanhentunut.";

const LABELS = { margin: "Asuntolainan marginaali", prepay: "Lainan lyhentäminen säästöillä", card_interest: "Luottokortin korot" } as const;
type Kind = keyof typeof LABELS;
type Outcome = { check: Check; draft?: FindingDraft };

const checkOf = (kind: Kind, status: Check["status"], extra: Partial<Check> = {}): Outcome => ({ check: { id: `loans:${kind}`, label: LABELS[kind], status, ...extra } });
const round10 = (cents: number) => Math.round(cents / 1000) * 1000;
const margin = (bp: number) => pct(bp / 10_000);

/** The mortgage being paid now: the largest active monthly `mortgage` series with six payments or more. */
function mortgageSeries(a: AreaInput): RecurringSeries | null {
  const series = a.ctx.recurring.filter((s) => s.category === "mortgage" && s.cadence === "monthly" && s.active && s.occurrences >= MIN_PAYMENTS);
  return series.sort((x, y) => y.monthlyCents - x.monthlyCents || x.id.localeCompare(y.id))[0] ?? null;
}

/** The series' rows in the window, newest last, at most `MAX_ROWS`. */
function seriesRows(a: AreaInput, series: RecurringSeries): AnalysisTx[] {
  const byId = rowsById(a.ctx);
  const from = `${a.months[0]}-01`;
  return series.transactionIds
    .map((id) => byId.get(id))
    .filter((t): t is AnalysisTx => !!t && !t.isTransfer && t.bookingDate >= from && t.bookingDate <= a.end)
    .sort((x, y) => x.bookingDate.localeCompare(y.bookingDate) || x.id.localeCompare(y.id))
    .slice(-MAX_ROWS);
}

const normalIban = (iban: string | null | undefined) => (iban ? iban.replace(/\s+/g, "").toUpperCase() : null);

/**
 * The outstanding balance of the loan the series pays, in positive cents: the loan account the payments go to, or the
 * only loan account. Null when no loan account has a balance.
 */
function loanBalance(a: AreaInput, series: RecurringSeries): number | null {
  const loans = a.balances.filter((b) => b.type === "loan");
  const byId = rowsById(a.ctx);
  const paidTo = new Set(series.transactionIds.map((id) => normalIban(byId.get(id)?.counterpartyIban)).filter((x): x is string => !!x));
  const target = a.ctx.accounts.find((acc) => acc.type === "loan" && paidTo.has(normalIban(acc.iban) ?? ""));
  const loan: BalanceInput | undefined = target ? loans.find((b) => b.id === target.id) : loans.length === 1 ? loans[0] : undefined;
  if (!loan || loan.balanceCents === null || loan.balanceCents === 0) return null;
  return Math.abs(loan.balanceCents);
}

interface ReferenceRange {
  /** Percent. */
  low: number;
  mid: number;
  high: number;
  facts: Fact[];
}

/**
 * The reference rate over the months of one reset period up to the latest month with a fact, in percent: a loan reset
 * at an unknown day in that period pays one of these. Mid is their mean. Null when a month's fact is missing or expired.
 */
function referenceRange(reference: Exclude<LoanReference, "fixed">, endMonth: string, today: string): ReferenceRange | null {
  let latest: string | null = null;
  for (let back = 0; back <= REFERENCE_LAG_MONTHS && !latest; back++) {
    const month = addMonths(endMonth, -back);
    if (factOn(`${reference}:${month}`, today)) latest = month;
  }
  if (!latest) return null;
  const facts: Fact[] = [];
  for (let i = RESET_MONTHS[reference] - 1; i >= 0; i--) {
    const fact = factOn(`${reference}:${addMonths(latest, -i)}`, today);
    if (!fact) return null;
    facts.push(fact);
  }
  const values = facts.map((f) => f.value);
  return { low: Math.min(...values), mid: values.reduce((s, v) => s + v, 0) / values.length, high: Math.max(...values), facts };
}

const rangeText = (low: number, high: number, format: (x: number) => string) => (format(low) === format(high) ? format(low) : `${format(low).replace(/\u00a0%$/, "")}–${format(high)}`);

/** The rate the user typed, or the outcome that says what is missing. */
function loanInputs(a: AreaInput, kind: "margin" | "prepay"): { series: RecurringSeries; rate: LoanRateValue & { reference: Exclude<LoanReference, "fixed"> } } | Outcome {
  const series = mortgageSeries(a);
  if (!series) return checkOf(kind, "clear");
  if (!a.months.length) return checkOf(kind, "no_data");
  const rate = valueOf(a.values, "loan_rate", a.today);
  if (!rate) return checkOf(kind, "needs_input", { input: "loan_rate" });
  // a fixed rate cannot be moved to a new margin, and prepaying it usually costs a fee
  if (rate.reference === "fixed") return checkOf(kind, "clear");
  return { series, rate: { marginBp: rate.marginBp, reference: rate.reference } };
}

function marginFinding(a: AreaInput): Outcome {
  const inputs = loanInputs(a, "margin");
  if ("check" in inputs) return inputs;
  const { series, rate } = inputs;
  const low = factOn("mortgage_margin_sample_low", a.today);
  const high = factOn("mortgage_margin_sample_high", a.today);
  if (!low || !high) return checkOf("margin", "no_data", { hint: FACTS_OLD });
  const balance = loanBalance(a, series);
  if (balance === null) return checkOf("margin", "no_data", { hint: ADD_LOAN_BALANCE });
  const lowBp = Math.round(low.value * 100);
  const highBp = Math.round(high.value * 100);
  if (rate.marginBp < highBp + MARGIN_OVER_TOP_BP) return checkOf("margin", "clear");
  const yearly = (bp: number) => round10((balance * bp) / 10_000);
  const euros = { lowCents: yearly(rate.marginBp - highBp), midCents: yearly(rate.marginBp - (lowBp + highBp) / 2), highCents: yearly(rate.marginBp - lowBp) };
  const offers = rangeText(lowBp, highBp, margin);
  const rows = seriesRows(a, series);
  const draft: FindingDraft = {
    id: findingId("loans", "margin", series.id),
    area: "loans",
    kind: "margin",
    subject: series.id,
    title: `Asuntolainan marginaali ${margin(rate.marginBp)}, esimerkkitarjouksissa ${offers}. Lainaa on jäljellä ${eur(balance)}.`,
    action: "Kilpailuta asuntolainan marginaali.",
    effort: "tunti",
    euros: { ...euros, assumption: "Jos marginaali laskee esimerkkitarjousten tasolle." },
    decideBy: null,
    weaknesses: isSampleFact(high) ? [{ id: "sample", reason: "Esimerkkitarjoukset eivät ole tarjous tälle taloudelle." }] : [],
    shared: false,
    calc: [
      { label: "Oma marginaali", value: margin(rate.marginBp) },
      { label: `Esimerkkitarjousten marginaali (Taloustaito ${formatFiDate(high.asOf)})`, value: offers },
      { label: "Lainan saldo", value: eur(balance) },
      { label: "Ero vuodessa", value: `${eur(euros.lowCents).replace(/\u00a0€$/, "")}–${eur(euros.highCents)}` },
      { label: "Marginaalin 0,1 prosenttiyksikköä", value: `${eur(yearly(10))} vuodessa` },
    ],
    rows: rows.map((t) => t.id),
    struck: [],
    claims: [`series:${series.id}`],
    measure: { kind: "series", keys: [series.id], perYear: 12 },
    facts: [low.id, high.id],
  };
  return { check: { id: "loans:margin", label: LABELS.margin, status: "finding" }, draft };
}

function prepayFinding(a: AreaInput): Outcome {
  const inputs = loanInputs(a, "prepay");
  if ("check" in inputs) return inputs;
  const { series, rate } = inputs;
  const balance = loanBalance(a, series);
  if (balance === null) return checkOf("prepay", "no_data", { hint: ADD_LOAN_BALANCE });
  const reference = referenceRange(rate.reference, monthOf(a.end), a.today);
  if (!reference) return checkOf("prepay", "no_data", { hint: FACTS_OLD });
  const yieldOf = savingsYield(a);
  if (!yieldOf) return checkOf("prepay", "no_data", { hint: "Säästötilin tuotto lasketaan säästötilin saldosta ja 12 kuukauden koroista." });
  const usual = usualSpend(a);
  if (usual === null) return checkOf("prepay", "no_data");
  const todayDay = a.ctx.todayDay;
  const savingsCents = yieldOf.walks.reduce((s, w) => s + w.at(todayDay)!, 0);
  const buffer = BUFFER_MONTHS * usual;
  const excess = savingsCents - buffer;
  // percent: the loan's rate at each end of the reference range against the yield already after tax
  const margin100 = rate.marginBp / 100;
  const yieldPct = yieldOf.rate * 100;
  const spread = { low: reference.low + margin100 - yieldPct, mid: reference.mid + margin100 - yieldPct, high: reference.high + margin100 - yieldPct };
  if (excess < PREPAY_MIN_CENTS || spread.low < PREPAY_MIN_SPREAD) return checkOf("prepay", "clear");
  const principal = Math.min(excess, balance);
  const yearly = (points: number) => round10((principal * points) / 100);
  const loanRate = rangeText((reference.low + margin100) / 100, (reference.high + margin100) / 100, pct);
  const refName = { euribor_12: "12 kuukauden Euribor", euribor_6: "6 kuukauden Euribor", euribor_3: "3 kuukauden Euribor" }[rate.reference];
  const first = reference.facts[0]!.period!;
  const last = reference.facts[reference.facts.length - 1]!.period!;
  const rows = [...seriesRows(a, series).map((t) => t.id), ...yieldOf.rows].slice(-MAX_ROWS);
  const draft: FindingDraft = {
    id: findingId("loans", "prepay"),
    area: "loans",
    kind: "prepay",
    subject: null,
    title: `${yieldOf.accounts.length === 1 ? "Säästötilillä" : "Säästötileillä"} on ${eur(excess)} yli kolmen kuukauden menojen. Lainan korko on ${loanRate}, säästöjen tuotto ${pct(yieldOf.rate)}.`,
    action: "Maksa ylimääräinen lyhennys säästöistä.",
    effort: "tunti",
    euros: { lowCents: yearly(spread.low), midCents: yearly(spread.mid), highCents: yearly(spread.high), assumption: "Kolmen kuukauden menot jäävät säästötilille." },
    decideBy: null,
    weaknesses: [{ id: "estimate", reason: "Lainan korko on arvio, koska koron tarkistuspäivää ei tiedetä." }],
    shared: false,
    calc: [
      { label: "Säästötilien saldo", value: eur(savingsCents) },
      { label: "Kolmen kuukauden menot", value: eur(buffer) },
      { label: "Ylimääräiset säästöt", value: eur(excess) },
      { label: "Lainan saldo", value: eur(balance) },
      { label: `${refName} ${Number(first.slice(5))}/${first.slice(0, 4)}–${Number(last.slice(5))}/${last.slice(0, 4)}`, value: rangeText(reference.low / 100, reference.high / 100, pct) },
      { label: "Marginaali", value: margin(rate.marginBp) },
      { label: "Lainan korko", value: loanRate },
      { label: "Säästötilien tuotto", value: pct(yieldOf.rate) },
      { label: "Lyhennys", value: eur(principal) },
    ],
    rows,
    struck: [],
    // the same loan as the margin finding: the headline counts the larger of the two, never both
    claims: [`series:${series.id}`],
    measure: { kind: "series", keys: [series.id], perYear: 12 },
    facts: reference.facts.map((f) => f.id),
  };
  return { check: { id: "loans:prepay", label: LABELS.prepay, status: "finding" }, draft };
}

const CARD_SIGNALS = ["gap", "stale", "own_unconnected"] as const;
/**
 * Purchase interest only: the `interest` category also holds withdrawal fees and late interest, which paying the bill
 * in full does not save (late interest is the late-fee alert's, rule 8).
 */
const PURCHASE_INTEREST = /KORKO/i;
const NOT_PURCHASE_INTEREST = /VIIV[AÄ]STYS|PALKKIO|LUOTTOKULU|LUOTTOKUSTANNU|MAKSU/i;
const isPurchaseInterest = (t: AnalysisTx) => {
  const text = `${t.description ?? ""} ${t.merchant} ${t.counterparty ?? ""}`;
  return PURCHASE_INTEREST.test(text) && !NOT_PURCHASE_INTEREST.test(text);
};

function cardInterestFinding(a: AreaInput): Outcome {
  const cards = ownAccounts(a, "credit_card");
  if (!cards.length || !a.months.length) return checkOf("card_interest", "clear");
  const from = `${a.months[0]}-01`;
  const cardIds = new Set(cards.map((b) => b.id));
  const interest = a.ctx.txs.filter((t) => cardIds.has(t.accountId) && !t.isTransfer && t.category === "interest" && isPurchaseInterest(t) && t.bookingDate >= from && t.bookingDate <= a.end);
  if (!interest.length) return checkOf("card_interest", "clear");
  const checking = ownAccounts(a, "checking");
  const walksChecking = checking.length ? walksOf(a, checking) : null;
  const walksCard = walksOf(a, cards);
  if (!walksChecking || !walksCard) return checkOf("card_interest", "no_data", { hint: "Lisää käyttötilin ja luottokortin saldo kohdassa Asetukset > Tilit." });
  const flagged = [...checking, ...cards].some((b) => CARD_SIGNALS.some((s) => a.quality.byAccount[b.id]?.includes(s))) || a.quality.signals.some((s) => s.id === "no_balance");
  if (flagged) return checkOf("card_interest", "no_data", { hint: "Käyttötilin tai kortin tiedoissa on tauko tai puuttuvia tapahtumia." });
  // month ends of the month before the window and of each window month: interest booked in a month counts only when
  // the checking accounts held the card's whole debt at both ends of it
  const ends = monthEndDays([addMonths(a.months[0]!, -1), ...a.months]);
  const sum = (walks: readonly BalanceWalk[], day: number) => (walks.every((w) => w.at(day) !== null) ? walks.reduce((s, w) => s + w.at(day)!, 0) : null);
  const position = ends.map((day) => {
    const cash = sum(walksChecking, day);
    const card = sum(walksCard, day);
    return cash === null || card === null ? null : { cash, debt: Math.max(0, -card) };
  });
  const covered = position.map((p) => p !== null && p.cash >= p.debt);
  const index = new Map(a.months.map((m, i) => [m, i]));
  const byMonth = a.months.map(() => 0);
  const counted: AnalysisTx[] = [];
  for (const t of interest) {
    const i = index.get(monthOf(t.bookingDate))!;
    if (!covered[i] || !covered[i + 1]) continue;
    byMonth[i]! += netCost(t);
    counted.push(t);
  }
  const months = new Set(counted.map((t) => monthOf(t.bookingDate)));
  if (!counted.length) return checkOf("card_interest", "clear");
  const yearly = annualise(byMonth);
  if (!yearly) return checkOf("card_interest", "no_data");
  const paid = byMonth.reduce((s, x) => s + x, 0);
  const at = [...months].map((m) => index.get(m)! + 1);
  const maxDebt = Math.max(...at.flatMap((i) => [position[i - 1]!.debt, position[i]!.debt]));
  const minCash = Math.min(...at.flatMap((i) => [position[i - 1]!.cash, position[i]!.cash]));
  const draft: FindingDraft = {
    id: findingId("loans", "card_interest"),
    area: "loans",
    kind: "card_interest",
    subject: null,
    title: `Luottokortin korkoja maksettiin ${eur(paid)} ${months.size} kuukautena, joiden alussa ja lopussa käyttötilin saldo kattoi kortin velan.`,
    action: "Maksa kortin lasku kokonaan eräpäivänä.",
    effort: "minuutteja",
    euros: { lowCents: yearly.yearlyCents, midCents: yearly.yearlyCents, highCents: yearly.yearlyCents, assumption: "Jos kortin lasku maksetaan kokonaan eräpäivänä." },
    decideBy: null,
    weaknesses: yearly.weakness ? [yearly.weakness] : [],
    shared: false,
    calc: [
      { label: "Korot näinä kuukausina", value: eur(paid) },
      { label: "Kuukausia", value: String(months.size) },
      { label: "Kortin velka kuun vaihteessa enintään", value: eur(maxDebt) },
      { label: "Käyttötilin saldo kuun vaihteessa vähintään", value: eur(minCash) },
      { label: "Korot vuodessa", value: eur(yearly.yearlyCents) },
    ],
    rows: counted.map((t) => t.id).slice(-MAX_ROWS),
    struck: [],
    claims: ["category:interest", ...cards.map((b) => `account:${b.id}`)],
    measure: { kind: "category", keys: ["interest"] },
    facts: [],
  };
  return { check: { id: "loans:card_interest", label: LABELS.card_interest, status: "finding" }, draft };
}

export const loans: Area = {
  id: "loans",
  label: "Lainat",
  assess: (a) => {
    const outcomes = [marginFinding(a), prepayFinding(a), cardInterestFinding(a)];
    return { findings: outcomes.flatMap((o) => (o.draft ? [o.draft] : [])), checks: outcomes.map((o) => o.check) };
  },
};
