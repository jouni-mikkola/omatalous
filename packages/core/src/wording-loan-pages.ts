/**
 * What a bank's loan page, the positive credit register and a SECCI form print: the part of the bank dialect
 * (ADR 0008) that loan-intake/ reads. The words of bank rows are in wording.ts.
 */
import type { LoanReference } from "./optimise/types.ts";
import { type LoanRepayment, MAX_LOAN_INTERVAL_MONTHS } from "./types.ts";
import { words } from "./wording.ts";

// A label is a plain phrase with no regex syntax, because it is also matched with the letters OCR mixes up collapsed.
// Labels match as whole words, so KORKO reads neither VIITEKORKO nor TODELLINEN VUOSIKORKO.

/**
 * What a label names: a field of the loan, `amortisationCents` for the principal part of a payment (the payment of an
 * equal-principal loan, no field otherwise), or `marker` for a label that only opens a loan's block (its type, its number).
 */
export type LoanLabelField =
  | "lender"
  | "grantedCents"
  | "balanceCents"
  | "balanceDate"
  | "rateBp"
  | "reference"
  | "marginBp"
  | "repayment"
  | "intervalMonths"
  | "paymentCents"
  | "amortisationCents"
  | "endDate"
  | "limitCents"
  | "marker";

/** The labels of each field, as alternations. The first ones are the register's and the SECCI form's own words. */
export const LOAN_LABELS: Readonly<Record<LoanLabelField, string>> = {
  lender: "LUOTONANTAJA|LUOTONANTAJAN NIMI|LAINANANTAJA|VELKOJA",
  grantedCents: "MYONNETTY MAARA|LUOTON KOKONAISMAARA|LAINAN ALKUPERAINEN MAARA|ALKUPERAINEN LAINAMAARA",
  balanceCents: "LUOTON SALDO|LAINAN SALDO|JALJELLA OLEVA PAAOMA|JALJELLA OLEVA LAINAMAARA|JALJELLA OLEVA LAINAPAAOMA|LAINAA JALJELLA",
  balanceDate: "SALDON PAIVAMAARA|SALDOPAIVA",
  rateBp: "KOKONAISKORKO|LAINAKORKO|LAINAN KORKO|NIMELLISKORKO",
  reference: "VIITEKORKO",
  marginBp: "MARGINAALI|KORKOMARGINAALI|LAINAN MARGINAALI",
  repayment: "LYHENNYSTAPA",
  intervalMonths: "LYHENNYSVALI",
  paymentCents: "KUUKAUSIERA|KUUKAUSIERAN SUURUUS|MAKSUERA|MAKSUERAN SUURUUS",
  amortisationCents: "LYHENNYS|LYHENNYKSEN MAARA|LYHENNYKSEN SUURUUS|KUUKAUSILYHENNYS",
  endDate: "VIIMEINEN ERAPAIVA|VIIMEINEN MAKSUPAIVA|LAINA-AIKA PAATTYY",
  limitCents: "LUOTTORAJA",
  marker: "LUOTTOTYYPPI|LUOTON TYYPPI|LAINATYYPPI|LAINAN TYYPPI|LAINANUMERO|LAINAN NUMERO|LUOTON NUMERO|SOPIMUSNUMERO",
};

/**
 * Labels that most often name the field and can name another figure: Lainan määrä what is left of the loan, Myönnetty
 * luotto a card's limit, Korko the reference rate or an amount of interest. Their value is read and never `sure`.
 */
export const LOAN_LABELS_UNSURE: Readonly<Partial<Record<LoanLabelField, string>>> = {
  grantedCents: "LAINAN MAARA|MYONNETTY LUOTTO",
  rateBp: "KORKO",
};

/** A label found in a folded line. */
export interface LoanLabelHit {
  field: LoanLabelField;
  /** The phrase of the lists that matched. */
  label: string;
  start: number;
  end: number;
  /** False when it matched only with OCR's look-alike letters collapsed. */
  exact: boolean;
  /** False for a phrase of LOAN_LABELS_UNSURE. */
  certain: boolean;
}

/** OCR reads l, I and 1 as one another, and O as 0. Both sides of a loose comparison go through this; the length stays. */
const lookAlike = (folded: string) => folded.replace(/[1L|]/g, "I").replace(/0/g, "O");
const labelRows = (lists: Partial<Record<LoanLabelField, string>>, certain: boolean) =>
  (Object.entries(lists) as [LoanLabelField, string][]).flatMap(([field, list]) => list.split("|").map((label) => ({ field, label, certain })));
const LOAN_LABEL_TABLE = [...labelRows(LOAN_LABELS, true), ...labelRows(LOAN_LABELS_UNSURE, false)];
const LOAN_LABEL_EXACT = new Map(LOAN_LABEL_TABLE.map((e) => [e.label, e]));
const LOAN_LABEL_LOOSE = new Map(LOAN_LABEL_TABLE.map((e) => [lookAlike(e.label), e]));
/** Longest phrase first, so LAINAN KORKO wins over KORKO; any run of spaces between the words of a phrase. */
const labelPattern = (phrases: Iterable<string>) => new RegExp(words([...phrases].sort((a, b) => b.length - a.length).map((p) => p.replace(/ /g, " +")).join("|")).source, "g");
const LOAN_LABEL_EXACT_RE = labelPattern(LOAN_LABEL_EXACT.keys());
const LOAN_LABEL_LOOSE_RE = labelPattern(LOAN_LABEL_LOOSE.keys());
const oneSpace = (s: string) => s.replace(/ +/g, " ");

/** Every loan label in a folded line, left to right. Where a loose match covers more than an exact one, the longer wins. */
export function loanLabelsIn(folded: string): LoanLabelHit[] {
  const hits: LoanLabelHit[] = [];
  for (const m of folded.matchAll(LOAN_LABEL_EXACT_RE)) hits.push({ ...LOAN_LABEL_EXACT.get(oneSpace(m[0]))!, start: m.index, end: m.index + m[0].length, exact: true });
  for (const m of lookAlike(folded).matchAll(LOAN_LABEL_LOOSE_RE)) {
    const [start, end] = [m.index, m.index + m[0].length];
    const over = hits.filter((h) => h.start < end && start < h.end);
    if (over.some((h) => h.end - h.start >= end - start)) continue;
    for (const h of over) hits.splice(hits.indexOf(h), 1);
    hits.push({ ...LOAN_LABEL_LOOSE.get(oneSpace(m[0]))!, start, end, exact: false });
  }
  return hits.sort((a, b) => a.start - b.start);
}

const everyWord = (list: string) => new RegExp(words(list).source, "g");
/** The one value whose words occur in the text, with those words blanked out of `rest`. Null for none and for two. */
function oneValueIn<T>(folded: string, table: readonly (readonly [T, RegExp])[]): { value: T; rest: string } | null {
  const found: T[] = [];
  let rest = folded;
  for (const [value, re] of table) {
    const next = rest.replace(re, " ");
    if (next !== rest) found.push(value);
    rest = next;
  }
  return found.length === 1 ? { value: found[0]!, rest } : null;
}

// KIINTEA TASAERA is read first: the plain TASAERA is an annuity (tasaerälaina), the fixed one keeps the payment and moves the end
const LOAN_REPAYMENT: readonly (readonly [LoanRepayment, RegExp])[] = [
  ["fixed_instalment", everyWord("KIINTEA TASAERA[A-Z]*")],
  ["annuity", everyWord("ANNUITEET[A-Z]*|TASAERA[A-Z]*")],
  ["equal_principal", everyWord("TASALYHEN[A-Z]*")],
  ["bullet", everyWord("KERTALYHEN[A-Z]*|BULLET")],
];
/** The way a loan is paid back, from the value of Lyhennystapa. */
export const loanRepaymentIn = (folded: string) => oneValueIn(folded, LOAN_REPAYMENT);

const LOAN_INTERVAL_COUNT = /(?<![A-Z0-9,.])(\d{1,2}) ?(?:KK|KUUKAU[A-Z]*)(?: VALEIN)?(?![A-Z0-9])/g;
const LOAN_INTERVAL: readonly (readonly [number, RegExp])[] = [
  [3, everyWord("NELJANNESVUOSI[A-Z]*|KOLMEN KUUKAUDEN VALEIN")],
  [6, everyWord("PUOLIVUOSI[A-Z]*|PUOLEN VUODEN VALEIN")],
  [12, everyWord("VUOSITTAIN|VUOSI|VUODEN VALEIN|KERRAN VUODESSA")],
  [1, everyWord("KUUKAUSITTAIN|KUUKAUSI|KUUKAUDEN VALEIN|KERRAN KUUKAUDESSA|KK")],
];
/** Months between two payments, from the value of Lyhennysväli: "1 kk", "kuukausittain", "neljännesvuosittain". */
export function loanIntervalIn(folded: string): { value: number; rest: string } | null {
  const counts = [...folded.matchAll(LOAN_INTERVAL_COUNT)];
  if (counts.length === 0) return oneValueIn(folded, LOAN_INTERVAL);
  const months = Number(counts[0]![1]);
  return counts.length === 1 && months >= 1 && months <= MAX_LOAN_INTERVAL_MONTHS ? { value: months, rest: folded.replace(LOAN_INTERVAL_COUNT, " ") } : null;
}

const EURIBOR_WORD = everyWord("EURIBOR[A-Z]*");
// the months stand before the word or after it: "12 KK EURIBOR", "EURIBOR 12 KK", "EURIBOR 12"
const EURIBOR_MONTHS_UNIT = /(?<![A-Z0-9,.])(12|6|3) ?(?:KK:N|KK|KUUKAUDEN|KUUKAUTTA|M)(?![A-Z0-9])/g;
const EURIBOR_MONTHS_AFTER = /(EURIBOR[A-Z]* ?)(12|6|3)(?![A-Z0-9,.])/g;
const FIXED_RATE = everyWord("KIINTEAKORKOINEN|KIINTEA KORKO|KIINTEA");
/** The reference rate, from the value of Viitekorko. Null for a rate the app has no id for (a bank's prime) and for a Euribor with no months. */
export function loanReferenceIn(folded: string): { value: LoanReference; rest: string } | null {
  const withoutFixed = folded.replace(FIXED_RATE, " ");
  const fixed = withoutFixed !== folded;
  if (!folded.includes("EURIBOR")) return fixed ? { value: "fixed", rest: withoutFixed } : null;
  const months = new Set([...[...folded.matchAll(EURIBOR_MONTHS_UNIT)].map((m) => m[1]!), ...[...folded.matchAll(EURIBOR_MONTHS_AFTER)].map((m) => m[2]!)]);
  if (fixed || months.size !== 1) return null;
  const rest = folded.replace(EURIBOR_MONTHS_UNIT, " ").replace(EURIBOR_MONTHS_AFTER, " ").replace(EURIBOR_WORD, " ");
  return { value: `euribor_${[...months][0]}` as LoanReference, rest };
}

const LOAN_TOTAL = /(?<![A-Z])YHTEENSA(?![A-Z])/;
/** "Luoton saldo yhteensä": the sum over every loan of a listing, no loan's own figure. */
export const isLoanTotal = (folded: string) => LOAN_TOTAL.test(folded);

// The units after a number are read on the text as printed (not folded): the reader of loan-intake/values.ts blanks
// what it read by position. Each takes the text that follows the number.
const LOAN_MONEY_UNIT = /^ ?(?:€|EUR(?!\p{L})|euro(?:a|n)?(?!\p{L})|e(?![\p{L}\p{N}]))/iu;
const LOAN_PERCENT_UNIT = /^ ?(?:%|prosentti\p{L}*|pros\.)/iu;
const LOAN_OTHER_UNIT = /^(?: ?(?:kk|kuukau\p{L}*|vuo\p{L}*|v|pv|päiv\p{L}*|kpl|krt|erää|x)(?![\p{L}\p{N}])|\p{L})/iu;
/** The euro unit right after a number, with its space ("€", " EUR", " euroa", " e"), or null. */
export const loanMoneyUnit = (after: string) => LOAN_MONEY_UNIT.exec(after)?.[0] ?? null;
/** The percent unit right after a number, with its space (" %", " prosenttia", " pros."), or null. */
export const loanPercentUnit = (after: string) => LOAN_PERCENT_UNIT.exec(after)?.[0] ?? null;
/** A count of something else: months, years, days, pieces, instalments. Such a number is never the amount or the rate. */
export const isLoanOtherUnit = (after: string) => LOAN_OTHER_UNIT.test(after);

const RATE_FORMULA = /EURIBOR|PRIME|VIITEKOR|MARGINAAL|[+]/;
/** A rate written as its parts ("3 kk Euribor + 0,65 %"): the one percentage in it is not known to be the whole rate. */
export const isLoanRateFormula = (folded: string) => RATE_FORMULA.test(folded);

const LOAN_LENDER_LINE = words(String.raw`[A-Z-]*PANKKI|[A-Z-]*BANK|[A-Z]*BANKEN|[A-Z]*RAHOITUS|[A-Z]*FINANCE|[A-Z]*FINANS|HYPOTEEKKIYHDISTYS|VALTIOKONTTORI|OYJ|OY|ABP|AB|OSK|A/S`);
const NOT_LENDER_LINE = words(String.raw`VERKKOPANKKI|MOBIILIPANKKI|[A-Z]*PANKKITUNNU[A-Z]*|ASUNTO OY|AS OY|KIINTEISTO OY|KOY|BOSTADS AB|[A-Z]*VAKUUTUS[A-Z]*`);
/**
 * A line that names a lender: a bank, a finance company, or any company by its form (the register lists lenders by
 * their registered names). A housing company (the collateral) or an insurer on a loan page is none.
 */
export const isLoanLenderLine = (folded: string) => LOAN_LENDER_LINE.test(folded) && !NOT_LENDER_LINE.test(folded);
