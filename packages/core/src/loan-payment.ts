/**
 * Loan payment accounts: an account the bank types as a loan that holds no debt but carries a loan's payments. The
 * household moves the instalment to it from its own accounts and the bank takes the instalment out, so its balance
 * stays near zero whatever the loan is. Read as a loan account it showed "Lainaa jäljellä 0,45 €".
 *
 * An account is one when it is typed loan, its balance is under 1 % of the year's flow through it, money came in during the last three months, every row of money
 * in is the household's own transfer, and the money out (nine tenths of it, by sum) goes to a lender, a payee whose text
 * names a loan, a payment in a loan's category, or the bank itself. A real loan account has a balance of the size of
 * the debt, and one that is paid off has no flow, so neither is one.
 *
 * The rows of such an account are bookkeeping of the household's own: the money in and its leg on the paying account
 * are one transfer (`legs`), and the instalments out are the loan payments (category loans), so the debt service is
 * counted once, at the instalment.
 */
import type { AnalysisContext } from "./analysis/context.ts";
import { dayNumber } from "./dates.ts";
import { fold } from "./merchant.ts";
import { nameOf, holdersIn } from "./person-names.ts";
import { sameName } from "./payer-role.ts";
import { isBankName, normalizeIban, PAIR_WINDOW_DAYS, pairable } from "./transfers.ts";
import type { Account, IsoDate, Transaction } from "./types.ts";
import { isLenderName, isLoanText } from "./wording.ts";

/** The balance is under this share of the year's flow. */
const BALANCE_SHARE = 0.01;
/** The money out that goes to the loan, as a share of all that leaves. */
const OUT_SHARE = 0.9;
const YEAR_DAYS = 365;
/** An account that took no money in for this long carries no loan any more. */
const QUIET_DAYS = 90;
const LOAN_CATEGORIES: ReadonlySet<string> = new Set(["mortgage", "loans", "student_loan"]);

type Row = Pick<Transaction, "id" | "accountId" | "bookingDate" | "amountCents" | "counterparty" | "counterpartyIban" | "description" | "category" | "categorySource" | "isTransfer"> & Partial<Pick<Transaction, "merchant" | "status">>;

interface LoanPaymentAccounts {
  /** The loan payment accounts of the view: where the account's balance is known it is held to the 1 % line, else the rows alone decide. */
  ids: ReadonlySet<string>;
  /** The year's flow through each account whose rows show the pattern, by account id: what a balance is held against (`flagLoanPayment`). */
  flow: ReadonlyMap<string, number>;
  /** Rows that are the household's own transfers into such an account, both legs: the row in and the row it left from. */
  legs: ReadonlySet<string>;
}

/**
 * The loan payment accounts among `accounts` on `today`, from the rows of the last 365 days. `balanceCents` is the bank's
 * latest, with either sign; an account that carries none is told by its rows alone (a page with the balances holds it
 * to the 1 % line after, `flagLoanPayment`).
 */
export function loanPaymentAccounts(accounts: readonly Account[], txs: readonly Row[], today: IsoDate): LoanPaymentAccounts {
  const ids = new Set<string>();
  const legs = new Set<string>();
  const flows = new Map<string, number>();
  const candidates = accounts.filter((a) => a.type === "loan");
  if (!candidates.length) return { ids, flow: flows, legs };
  const from = dayNumber(today) - YEAR_DAYS + 1;
  const ibanOf = new Map(accounts.map((a) => [a.id, normalizeIban(a.iban)]));
  const ownIbans = new Set([...ibanOf.values()].filter((x): x is string => !!x));
  const byAccount = new Map<string, Row[]>();
  for (const t of txs) {
    if (t.status === "pending" || dayNumber(t.bookingDate) < from) continue;
    const list = byAccount.get(t.accountId);
    if (list) list.push(t);
    else byAccount.set(t.accountId, [t]);
  }
  for (const account of candidates) {
    const rows = byAccount.get(account.id) ?? [];
    const money = rows.filter((t) => t.amountCents > 0);
    const out = rows.filter((t) => t.amountCents < 0);
    const flow = Math.max(sum(money), -sum(out));
    // a loan with nothing left and no money in for three months is paid off, whatever flowed through it before
    if (!money.length || !out.length || !money.some((t) => dayNumber(t.bookingDate) > dayNumber(today) - QUIET_DAYS)) continue;
    const mine = ownIbans.has(ibanOf.get(account.id) ?? "") ? ibanOf.get(account.id) : null;
    const holders = holdersIn(account.holder).map((h) => h.name);
    const own = (t: Row) => {
      const iban = normalizeIban(t.counterpartyIban);
      if (iban && ownIbans.has(iban) && iban !== mine) return true;
      // the other holder of a joint loan pays in from an account that is not in the view
      return t.categorySource === "transfer" || t.isTransfer === true || (!!t.counterparty && holders.some((h) => sameName(h, nameOf(t.counterparty!))));
    };
    if (!money.every(own)) continue;
    const toLoan = out.filter((t) => LOAN_CATEGORIES.has(t.category) || isLoanPayee(t, account));
    if (-sum(toLoan) < -sum(out) * OUT_SHARE) continue;
    flows.set(account.id, flow);
    if (account.balanceCents != null && !isSmall(account.balanceCents, flow)) continue;
    ids.add(account.id);
    for (const t of money) {
      legs.add(t.id);
      const leg = legOf(t, txs, ibanOf);
      if (leg) legs.add(leg);
    }
  }
  return { ids, flow: flows, legs };
}

/** The balance is under 1 % of the year's flow. */
const isSmall = (balanceCents: number, flow: number) => Math.abs(balanceCents) < flow * BALANCE_SHARE;

/**
 * The balances with a loan payment account marked: a loan typed account that the rows of the view show to carry the
 * instalments (`ctx.paymentFlow`) and whose balance, known here, is under 1 % of the year's flow. Every page that reads
 * the debts asks this one answer, so no page counts such an account as a loan.
 */
export function flagLoanPayment<B extends { id: string; type: string; balanceCents: number | null; loanPayment?: true }>(ctx: Pick<AnalysisContext, "paymentFlow">, balances: readonly B[]): B[] {
  if (!ctx.paymentFlow.size) return [...balances];
  return balances.map((b) => {
    const flow = ctx.paymentFlow.get(b.id);
    return b.type === "loan" && flow !== undefined && b.balanceCents !== null && isSmall(b.balanceCents, flow) ? { ...b, loanPayment: true as const } : b;
  });
}

const sum = (rows: readonly Row[]) => rows.reduce((s, t) => s + t.amountCents, 0);

/** A lender, a text that names a loan, or the bank of the account itself. */
function isLoanPayee(t: Row, account: Account): boolean {
  const payee = t.counterparty ?? t.merchant ?? "";
  const text = fold([t.merchant, t.counterparty, t.description].filter(Boolean).join(" "));
  return isLenderName(text) || isLoanText(text) || (payee !== "" && isBankName(payee, account));
}

/** The row on another account that left the money: the opposite amount within the pairing window, the named account first. */
function legOf(t: Row, txs: readonly Row[], ibanOf: ReadonlyMap<string, string | null>): string | null {
  const day = dayNumber(t.bookingDate);
  const named = normalizeIban(t.counterpartyIban);
  const found = txs
    .filter((o) => o.accountId !== t.accountId && o.amountCents === -t.amountCents && pairable(o) && Math.abs(dayNumber(o.bookingDate) - day) <= PAIR_WINDOW_DAYS)
    .sort((a, b) => Number(ibanOf.get(b.accountId) === named) - Number(ibanOf.get(a.accountId) === named) || Math.abs(dayNumber(a.bookingDate) - day) - Math.abs(dayNumber(b.bookingDate) - day));
  return found[0]?.id ?? null;
}
