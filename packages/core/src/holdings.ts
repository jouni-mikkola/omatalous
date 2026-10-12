/**
 * Decision: what the household has and owes before any analysis: each account, each card with what is used of its
 * limit, each loan with what is left. The first page (Kuukausi) and the balance report (Saldot) read this one answer.
 *
 * It computes no figure of its own (ADR 0004). An account's balance is the day walk's (`balanceWalk`), a debt's figures
 * are `householdDebts`' and `loans.ts`', and the flag for a debt that may be counted twice is the Lainat report's
 * (`maybeTwice`). The cards' `usedCents` and the loans' `leftCents` add up to the debt total, to the cent.
 *
 * It stands beside `household-debts.ts`, below analysis and reports, because the dashboard (analysis) and the balance
 * report (reports) both call it and neither folder may import the other.
 */
import { balanceWalk } from "./analysis/balance-walk.ts";
import type { AnalysisContext } from "./analysis/context.ts";
import { householdDebts } from "./household-debts.ts";
import { creditAccountLoan, creditUse, debtPaymentsPerMonth, loanBalanceOn } from "./loans.ts";
import { maybeTwice } from "./reports/loans.ts";
import type { BalanceInput, IsoDate, Loan, UserInputs } from "./types.ts";

/**
 * Every list is in the order of the accounts the request holds, the loans in the order of `householdDebts`. A name is
 * the series' name: with the owner's name in brackets when the account is shared with the viewer. A cent figure that
 * is not known is null, never 0.
 */
export interface Holdings {
  /** Checking, savings and other accounts that hold money (Saldot's total holds all three). A joint account both partners linked is here once. */
  accounts: {
    id: string;
    name: string;
    type: "checking" | "savings" | "other";
    /** The bank as the app shows it. Null for an account another member shared: the account lists leave it out too. */
    bank: string | null;
    /** The owner's name when another member shared the account with the viewer, null for the viewer's own. */
    ownerName: string | null;
    /** Today's balance from the day walk, the same as the current month of Saldot's series. Null without a balance from the bank. */
    balanceCents: number | null;
    /** The local day the bank gave the balance, null when unknown. */
    balanceAt: string | null;
  }[];
  cards: {
    id: string;
    name: string;
    bank: string | null;
    ownerName: string | null;
    /** The last four digits as the bank gave them ("•••• 1234"), null when it gave none. */
    mask: string | null;
    /** Null when the bank gave none. */
    limitCents: number | null;
    /** Owed on the card, as `householdDebts` counts it: 0 for a card in credit, never negative. Null without a balance from the bank. */
    usedCents: number | null;
    /** The limit less what is used, 0 over the limit. Null without a limit or without a balance. */
    freeCents: number | null;
    /** Owed above the limit, 0 at and within it, the figure of `creditUse`. Null without a limit or without a balance. */
    overCents: number | null;
    balanceAt: string | null;
  }[];
  /** Every debt of `householdDebts` that is no connected card's: saved loans, loan accounts, a saved loan linked to a loan account. */
  loans: {
    /** The saved loan's id, or `account:<account id>` for a connected account. */
    id: string;
    name: string;
    lender: string | null;
    kind: Loan["kind"];
    /** Whose account tells the debt when another member shared it, null for a typed loan and the viewer's own account. */
    ownerName: string | null;
    /** What is left on the day (`loanBalanceOn`). Null when it is not known on the day; the debt total leaves such a loan out. */
    leftCents: number | null;
    /** The next payment spread over a month (`debtPaymentsPerMonth`), null where the loan has none or does not tell it. */
    monthlyPaymentCents: number | null;
    /** An account tells it (the bank's, or the account a saved loan is linked to), or the household typed it with no account. */
    source: "account" | "typed";
    /** The debt may be in the totals twice: no link says that a saved loan and a connected account are one (`maybeTwice`). */
    maybeTwice: boolean;
  }[];
  /** What the household owes in all, the one debt total of `householdDebts`: the cards' `usedCents` and the loans' `leftCents` add up to it, to the cent. 0 without debt. */
  debtCents: number;
}

/** A card has a limit when the bank gave one above zero. The one place that decides it: the cards here and Asetukset > Tilit both ask. */
export const cardLimitCents = (cents: number | null | undefined): number | null => (cents != null && cents > 0 ? cents : null);

/** The holdings on the context's today, from the accounts in view and the user's saved loans. */
export function buildHoldings(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): Holdings {
  const day: IsoDate = ctx.today;
  const debts = householdDebts(balances, inputs, day);
  const twice = maybeTwice(balances, debts);
  const twiceLoans = new Set(twice.flatMap((t) => t.loans.map((l) => l.id)));
  const twiceAccounts = new Set(twice.flatMap((t) => t.accounts.map((a) => a.id)));
  const accountOf = new Map(balances.map((b) => [b.id, b]));
  // one debt for each account that has one, in `connected`'s order
  const debtOf = new Map(debts.sources.map((s, i) => [s.accountId, debts.connected[i]!]));

  const accounts = balances.flatMap((b): Holdings["accounts"] =>
    b.type !== "credit_card" && b.type !== "loan"
      ? [{ id: b.id, name: b.name, type: b.type, bank: b.bank ?? null, ownerName: b.ownerName, balanceCents: balanceWalk(ctx, b)?.at(ctx.todayDay) ?? null, balanceAt: b.balanceAt }]
      : [],
  );

  const cards = balances.flatMap((b): Holdings["cards"] => {
    if (b.type !== "credit_card") return [];
    // a card with no debt (in credit, or at zero) is read as the bank tells it: nothing used
    const debt = debtOf.get(b.id) ?? creditAccountLoan(b, day);
    const use = debt ? creditUse(debt, day) : null;
    return [
      {
        id: b.id,
        name: b.name,
        bank: b.bank ?? null,
        ownerName: b.ownerName,
        mask: b.cardMask ?? null,
        limitCents: cardLimitCents(debt?.limitCents ?? b.creditLimitCents),
        usedCents: use?.usedCents ?? null,
        freeCents: use?.availableCents ?? null,
        overCents: use?.overCents ?? null,
        balanceAt: b.balanceAt,
      },
    ];
  });

  const loanRow = (loan: Loan, source: "account" | "typed", ownerName: string | null, flagged: boolean): Holdings["loans"][number] => {
    const monthly = debtPaymentsPerMonth([loan], day);
    return {
      id: loan.id,
      name: loan.name,
      lender: loan.lender,
      kind: loan.kind,
      ownerName,
      leftCents: loanBalanceOn(loan, day).cents,
      monthlyPaymentCents: monthly.counted ? monthly.monthlyCents : null,
      source,
      maybeTwice: flagged,
    };
  };
  const loans = [
    ...debts.saved.map((loan) => loanRow(loan, "typed", null, twiceLoans.has(loan.id))),
    ...debts.connected.flatMap((loan, i): Holdings["loans"] => {
      const accountId = debts.sources[i]!.accountId;
      const account = accountOf.get(accountId);
      return account?.type === "credit_card" ? [] : [loanRow(loan, "account", account?.ownerName ?? null, twiceAccounts.has(accountId))];
    }),
  ];

  return { accounts, cards, loans, debtCents: debts.total.cents };
}
