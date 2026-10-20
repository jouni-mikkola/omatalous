// Decision: what the home costs a month and on what terms its loan runs, told as a statement
import { CATEGORIES, type DashboardData, type HousingCharge, type HousingLoan, LOAN_REFERENCE_LABEL } from "@banking/core";
import { date, dayMonth, money, rateText } from "../../format.ts";
import { addsUp, shares } from "../../marks.ts";
import { partText } from "../../part.ts";

type Answer = NonNullable<DashboardData["housing"]>;

/** A value that is not known. */
export const DASH = "–";

/**
 * The columns of the table Lainat after the loan's name, by their heads. The three of `next` stand under the group head
 * "Seuraava maksuerä"; a column of figures is right-aligned.
 */
export const LOAN_COLUMNS = [
  { key: "rate", head: "Korko", figure: true, next: false },
  { key: "reference", head: "Viitekorko ja marginaali", figure: false, next: false },
  { key: "review", head: "Koron tarkistuspäivä", figure: false, next: false },
  { key: "due", head: "Eräpäivä", figure: false, next: true },
  { key: "amortisation", head: "Lyhennys", figure: true, next: true },
  { key: "interest", head: "Korko", figure: true, next: true },
  { key: "month", head: "Kuussa", figure: true, next: false },
] as const;
type Column = (typeof LOAN_COLUMNS)[number]["key"];

/** A cell of a loan's row: its words, and whether a dash stands for a term the loan's form takes. */
interface Cell {
  text: string;
  missing: boolean;
}
const told = (text: string): Cell => ({ text, missing: false });
/** Not typed: the loan's form in Asetukset takes it. */
const MISSING: Cell = { text: DASH, missing: true };
/** Nothing to tell and nothing to type: a fixed rate is not set again, a loan with nothing due has no next payment. */
const NONE: Cell = { text: DASH, missing: false };

/** A rate as the bank writes it: "3,10 %". */
const rateOf = (bp: number): string => `${rateText(bp)} %`;

/**
 * The cells of a saved loan. The reference rate and the margin are one cell and are told only when the loan names all
 * of it; the day the rate is set again is told while it is ahead (a day that has passed is not the next one, and no
 * later day is worked out); each part of the next payment is told where the plan has it.
 */
function cellsOf(loan: HousingLoan): Record<Column, Cell> {
  const { rateBp, reference, marginBp, referenceBp, reviewDate, reviewPassed, next, monthlyCents } = loan;
  const fixed = reference === "fixed";
  // nothing is due before the last due date: the loan has no next payment and no month to type
  const nothingDue = next !== null && next.cents === null && next.unknown === null;
  const unknown = nothingDue ? NONE : MISSING;
  return {
    rate: rateBp === null ? MISSING : told(rateOf(rateBp)),
    reference: fixed ? told("Kiinteä") : reference !== null && referenceBp !== null && marginBp !== null ? told(`${LOAN_REFERENCE_LABEL[reference]} ${rateOf(referenceBp)} + ${rateOf(marginBp)}`) : MISSING,
    review: fixed ? NONE : reviewDate !== null && !reviewPassed ? told(date(reviewDate)) : MISSING,
    due: next?.date ? told(dayMonth(next.date)) : unknown,
    amortisation: next && next.amortisationCents !== null ? told(money(next.amortisationCents)) : unknown,
    interest: next && next.interestCents !== null ? told(money(next.interestCents)) : unknown,
    month: monthlyCents === null ? unknown : told(money(monthlyCents)),
  };
}

/** The one link that ends a loan's row; both open the card Lainat of Asetukset. */
type RowLink = "Täydennä" | "Lisää laina";

interface LoanRow {
  key: string;
  /** What the household calls the loan; for payments with no saved loan, their payee. */
  name: string;
  /** The lender, the second line under a saved loan's name. */
  lender: string | null;
  /** A saved loan: its name opens the report Lainat. Else the name is a payee and opens its rows in Tapahtumat. */
  saved: boolean;
  /** "osuutesi 60 %" where the row holds the viewer's part of a joint account's payments. */
  part: string | null;
  /** The words of each cell, by its column. */
  cells: Record<Column, string>;
  /**
   * "Täydennä" where a term is missing from a loan the viewer typed, "Lisää laina" for payments with no saved loan.
   * Null when nothing is missing, and for a loan another member typed: it is the typist's to change.
   */
  link: RowLink | null;
}

interface ChargeRow {
  key: string;
  /** What the payment is, in the words of the bank or the housing company; the category's name when they name nothing. */
  kind: string;
  payee: string;
  part: string | null;
  cents: number;
  /** The row's slice of the 100 px track on its rule (`--from`, `--part`), only while the charges add up to the total. */
  share: { from: number; part: number } | null;
}

/** A row of the sums: null cents where no row tells a sum. The last one is the block's total. */
interface SumRow {
  label: string;
  cents: number | null;
  total: boolean;
}

interface HousingView {
  loans: LoanRow[];
  charges: ChargeRow[];
  /** The loans' payments, the charges and the total; the total alone where the block has only loans or only charges. */
  sums: SumRow[];
  /** The sentence under the total when a loan tells no payment. */
  missing: string | null;
  ask: boolean;
  /** The charges add up, to the cent, to the total: their column has the bracket and the tracks. */
  chargesAddUp: boolean;
  /** The loans' payments and the charges add up to the total: the two rows above it have the bracket. */
  sumsAddUp: boolean;
}

function loanRow(loan: HousingLoan): LoanRow {
  const saved = loan.id !== null;
  // payments with no saved loan have a month and none of the terms: every other cell is a dash
  const cells = cellsOf(loan);
  const mend = !loan.typedByOther && Object.values(cells).some((cell) => cell.missing);
  return {
    key: loan.id ?? loan.seriesId ?? "",
    name: loan.name ?? loan.lender ?? DASH,
    lender: saved ? loan.lender : null,
    saved,
    part: partText(loan.part, "debt"),
    cells: Object.fromEntries(LOAN_COLUMNS.map(({ key }) => [key, cells[key].text])) as Record<Column, string>,
    link: saved ? (mend ? "Täydennä" : null) : "Lisää laina",
  };
}

const chargeRow = (charge: HousingCharge): ChargeRow => ({
  key: charge.seriesId,
  kind: charge.label ?? CATEGORIES.find((c) => c.id === charge.category)?.label ?? DASH,
  payee: charge.payee,
  part: partText(charge.part, "debt"),
  cents: charge.monthlyCents,
  share: null,
});

/** The sums are core's: the loans' known payments, the charges, and the two together. A sum no row tells is not a zero. */
function sumsOf({ loans, charges, loansMonthlyCents, chargesMonthlyCents, totalMonthlyCents }: Answer): SumRow[] {
  if (loans.length + charges.length === 0) return [];
  const paid = loans.some((loan) => loan.monthlyCents !== null);
  const total: SumRow = { label: "Asuminen yhteensä kuussa", cents: paid || charges.length > 0 ? totalMonthlyCents : null, total: true };
  if (loans.length === 0 || charges.length === 0) return [total];
  return [{ label: "Lainojen maksuerät", cents: paid ? loansMonthlyCents : null, total: false }, { label: "Asumiskulut", cents: chargesMonthlyCents, total: false }, total];
}

/** The block from core's answer: the loans in core's order, the charges in core's order, the sums as core gives them. */
export function housingView(housing: Answer): HousingView {
  const unpaid = housing.loans.filter((loan) => loan.monthlyCents === null).length;
  const sums = sumsOf(housing);
  const total = sums.find((sum) => sum.total)?.cents ?? null;
  const charges = housing.charges.map(chargeRow);
  // a bracket and a track claim that the rows are the total: they are drawn only when they are, to the cent
  const chargesAddUp = total !== null && addsUp(charges.map((c) => c.cents), total);
  const slices = chargesAddUp ? shares(charges.map((c) => c.cents), total) : null;
  let from = 0;
  slices?.forEach((part, i) => {
    charges[i]!.share = { from, part: part ?? 0 };
    from += part ?? 0;
  });
  const paid = sums.length === 3 ? [sums[0]!.cents, sums[1]!.cents] : [];
  return {
    loans: housing.loans.map(loanRow),
    charges,
    sums,
    missing: housing.partial ? `Summasta puuttuu ${unpaid} lainan maksuerä.` : null,
    ask: housing.ask,
    chargesAddUp,
    sumsAddUp: total !== null && addsUp(paid, total),
  };
}
