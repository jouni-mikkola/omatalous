/**
 * Decision: what the household has and owes before any analysis: each account, each card with what is used of its
 * limit, each loan with what is left. The first page (Yhteenveto) and the balance report (Saldot) read this one answer.
 *
 * It computes no figure of its own (ADR 0004) beyond the totals of a group: the accounts' known balances, the cards'
 * known use and the loans' known balances, each added once. An account's
 * balance is the day walk's (`balanceWalk`), a debt's figures are `householdDebts`' and `loans.ts`', and so is the
 * flag for a debt that may be counted twice (`maybeTwice`). The cards' `usedCents` and the loans' `leftCents` add
 * up to the debt total, to the cent, in a member's own view as in the household's: where the viewer has a part of
 * an account, every figure here is that part.
 *
 * It stands beside `household-debts.ts`, below analysis and reports, because the dashboard (analysis) and the balance
 * report (reports) both call it and neither folder may import the other.
 */
import { balanceWalk } from "./analysis/balance-walk.ts";
import type { AnalysisContext } from "./analysis/context.ts";
import type { Debt } from "./debt-part.ts";
import { belowWhole, householdDebts, maybeTwice, paidFrom } from "./household-debts.ts";
import { creditAccountLoan, creditUse, debtPaymentsPerMonth, loanBalanceOn } from "./loans.ts";
import { normalizeIban } from "./transfers.ts";
import type { AccountUse, BalanceInput, IsoDate, Loan, Part, UserInputs } from "./types.ts";

/**
 * Whose a row of the holdings is, where the request tells it. `use`: who uses the account behind the row. `part`: the
 * viewer's part of it when that is below the whole, and the row's cent figures are then that part. Both are left out
 * where nothing is known, and `part` where the row is all the viewer's.
 */
interface Used {
  use?: AccountUse;
  part?: Part;
}

/** What a row carries of the account behind it. */
const usedOf = (account: Pick<BalanceInput, "use" | "part"> | undefined): Used => ({
  ...(account?.use ? { use: account.use } : {}),
  ...(belowWhole(account?.part) ? { part: account.part } : {}),
});

/**
 * Every list is in the order of the accounts the request holds, the loans in the order of `householdDebts`. A name is
 * the series' name: with the owner's name in brackets when the account is shared with the viewer. A cent figure that
 * is not known is null, never 0.
 */
export interface Holdings {
  /** Checking, savings and other accounts that hold money (Saldot's total holds all three). A joint account both partners linked is here once. */
  accounts: (Used & {
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
    /** The last four characters of the account number, null when the account has none. The page shows it after the name when two accounts share one. */
    mask: string | null;
  })[];
  /** The known balances of `accounts` added once. Null when no account has a balance: an unknown total is never 0. */
  accountsCents: number | null;
  cards: (Used & {
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
  })[];
  /** The known `usedCents` of `cards` added once. Null when no card has a balance: an unknown total is never 0. */
  cardsCents: number | null;
  /**
   * Every debt of `householdDebts` that is no connected card's: saved loans, loan accounts, a saved loan linked to a
   * loan account. `use` and `part` are those of the account that tells the debt, and for a typed loan those of the
   * account its payments leave (`paidFrom`).
   */
  loans: (Used & {
    /** The saved loan's id, or `account:<account id>` for a connected account. */
    id: string;
    name: string;
    lender: string | null;
    kind: Loan["kind"];
    /** Whose account tells the debt when another member shared it, null for a typed loan and the viewer's own account. */
    ownerName: string | null;
    /** Who typed the loan in, when that is another member (`Loan.typedBy`): the viewer cannot change such a loan. Left out on the viewer's own and on an account's debt. */
    typedBy?: string;
    /** What is left on the day (`loanBalanceOn`). Null when it is not known on the day; the debt total leaves such a loan out. */
    leftCents: number | null;
    /** The next payment spread over a month (`debtPaymentsPerMonth`), null where the loan has none or does not tell it. */
    monthlyPaymentCents: number | null;
    /** An account tells it (the bank's, or the account a saved loan is linked to), or the household typed it with no account. */
    source: "account" | "typed";
    /** The debt may be in the totals twice: no link says that a saved loan and a connected account are one (`maybeTwice`). */
    maybeTwice: boolean;
  })[];
  /** The known `leftCents` of `loans` added once; a loan without a balance is not in it, as it is not in `debtCents`. Null when no loan has one. */
  loansCents: number | null;
  /** What the household owes in all, the one debt total of `householdDebts`: the cards' `usedCents` and the loans' `leftCents` add up to it, to the cent. 0 without debt. */
  debtCents: number;
}

/** The known figures added once, in the order given; null when none is known, so that an unknown sum is not read as 0. */
const sumKnown = (figures: readonly (number | null)[]): number | null => {
  const known = figures.filter((c): c is number => c !== null);
  return known.length ? known.reduce((sum, cents) => sum + cents, 0) : null;
};

/** The last four characters of an account number, null for no number or one shorter than that. */
const accountMask = (iban: string | null | undefined): string | null => {
  const number = normalizeIban(iban);
  return number && number.length >= 4 ? number.slice(-4) : null;
};

/** A card has a limit when the bank gave one above zero. The one place that decides it: the cards here and Asetukset > Tilit both ask. */
export const cardLimitCents = (cents: number | null | undefined): number | null => (cents != null && cents > 0 ? cents : null);

/** The holdings on the context's today, from the accounts in view and the user's saved loans. */
export function buildHoldings(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): Holdings {
  const day: IsoDate = ctx.today;
  const debts = householdDebts(balances, inputs, day);
  // one debt for each account that has one, in `connected`'s order
  const debtOf = new Map(debts.sources.map((s, i) => [s.accountId, debts.connected[i]!]));

  const numberOf = new Map(ctx.accounts.map((a) => [a.id, a.iban]));
  const accounts = balances.flatMap((b): Holdings["accounts"] =>
    b.type !== "credit_card" && b.type !== "loan"
      ? [{ id: b.id, name: b.name, type: b.type, bank: b.bank ?? null, ownerName: b.ownerName, balanceCents: balanceWalk(ctx, b)?.at(ctx.todayDay) ?? null, balanceAt: b.balanceAt, mask: accountMask(numberOf.get(b.id)), ...usedOf(b) }]
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
        ...usedOf(b),
      },
    ];
  });

  const loans = heldLoans(balances, debts).map((held) => held.row);
  return {
    accounts,
    accountsCents: sumKnown(accounts.map((a) => a.balanceCents)),
    cards,
    cardsCents: sumKnown(cards.map((c) => c.usedCents)),
    loans,
    loansCents: sumKnown(loans.map((l) => l.leftCents)),
    debtCents: debts.total.cents,
  };
}

/**
 * The loans of a view with the debt each row is told from, in the order of `householdDebts`: every debt that is no
 * connected card's. Asuminen reads its home loans here (`housing.ts`), so the two blocks hold the same loans at the
 * same part.
 */
export function heldLoans(balances: readonly BalanceInput[], debts: ReturnType<typeof householdDebts>): { row: Holdings["loans"][number]; debt: Debt }[] {
  const { day } = debts;
  const twice = maybeTwice(balances, debts);
  const twiceLoans = new Set(twice.flatMap((t) => t.loans.map((l) => l.id)));
  const twiceAccounts = new Set(twice.flatMap((t) => t.accounts.map((a) => a.id)));
  const accountOf = new Map(balances.map((b) => [b.id, b]));
  const held = (loan: Debt, source: "account" | "typed", account: BalanceInput | undefined, flagged: boolean) => {
    const monthly = debtPaymentsPerMonth([loan], day);
    const row: Holdings["loans"][number] = {
      id: loan.id,
      name: loan.name,
      lender: loan.lender,
      kind: loan.kind,
      // a typed loan has no owner's account behind it, whoever linked the one its payments leave: `typedBy` says whose it is
      ownerName: source === "account" ? (account?.ownerName ?? null) : null,
      ...(loan.typedBy ? { typedBy: loan.typedBy } : {}),
      leftCents: loanBalanceOn(loan, day).cents,
      monthlyPaymentCents: monthly.counted ? monthly.monthlyCents : null,
      source,
      maybeTwice: flagged,
      ...usedOf(account),
    };
    return { row, debt: loan };
  };
  return [
    ...debts.saved.map((loan) => held(loan, "typed", paidFrom(loan, balances), twiceLoans.has(loan.id))),
    ...debts.connected.flatMap((loan, i) => {
      const accountId = debts.sources[i]!.accountId;
      const account = accountOf.get(accountId);
      return account?.type === "credit_card" ? [] : [held(loan, "account", account, twiceAccounts.has(accountId))];
    }),
  ];
}
