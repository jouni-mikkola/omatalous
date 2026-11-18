/**
 * Loans the signed-in user typed in and confirmed. Own rows only.
 *
 * Core trusts a loan's values (`packages/core/src/loans.ts`), so this file is where they are bounded. After
 * `parseLoan` every amount and rate is a whole number in a range where core's products stay exact, the dates are
 * within a lifetime of today, and no plan can make the balance grow. So a balance on any day is a whole number of
 * cents between zero and the stated balance.
 */
import { addMonthsToDate, DEBT_ACCOUNT_TYPES, isRevolving, LOAN_KINDS, LOAN_REFERENCES, LOAN_REPAYMENTS, type Loan, loanPeriodInterest, MAX_LOAN_INTERVAL_MONTHS, mortgageSeriesKeys, type PaymentParts } from "@banking/core";
import { Hono } from "hono";
import { NotFound, UserError } from "../platform/errors.ts";
import { randomToken } from "../platform/ids.ts";
import { isIsoDate, strictObject, UNSEEN } from "../platform/validate.ts";
import { proposalsFor } from "../services/analysis.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { reprocess } from "../services/enrich.ts";
import { body } from "./shared.ts";

type LoanFields = Omit<Loan, "id">;
/** Reads the signed-in user's own accounts: another member's account is null, as one nobody has. */
type OwnAccounts = Pick<ReturnType<Services["finance"]>, "getAccount">;

const FIELDS = [
  "name",
  "lender",
  "kind",
  "grantedCents",
  "balanceCents",
  "balanceDate",
  "rateBp",
  "reference",
  "marginBp",
  "repayment",
  "intervalMonths",
  "paymentCents",
  "endDate",
  "limitCents",
  "seriesKey",
  "accountId",
  "rateReviewDate",
] as const satisfies readonly (keyof LoanFields)[];
/** The body of a save also holds the split of the last payment a document stated, which is not a field of the loan (`parseLastPayment`). */
const BODY_FIELDS = [...FIELDS, "lastPayment"] as const;
const LAST_PAYMENT_FIELDS = ["date", "principalCents", "interestCents", "feeCents"] as const;

const MAX_NAME = 80;
/**
 * Ten million euros. Core multiplies a balance by a rate in thousandths of a percent and by the months of an interval
 * (`intervalInterest`): at this size, `MAX_RATE_BP` and twelve months the product is about 6e14, well under 2^53, so
 * the interest is exact to the cent. A product past 2^53 (a margin and a fixing on top) core computes in whole numbers
 * of a wider type. A typo stays visible too.
 */
const MAX_CENTS = 1_000_000_000;
const MAX_EUROS = "10 000 000 €";
/** 50 % a year, in hundredths of a percent. A higher one is a typo. */
const MAX_RATE_BP = 5000;
/** A balance told decades ago still has payments ahead of it: a mortgage can run that long. */
const YEARS_BACK = 40;
/**
 * With `YEARS_BACK` the last due date is at most 90 years after the balance date: 1 080 monthly payments, under core's
 * `MAX_LOAN_PAYMENTS`, so a plan always reaches its last due date.
 */
const YEARS_AHEAD = 50;
const MAX_SERIES_KEY = 200;
const MAX_ACCOUNT_ID = 200;
/**
 * One sentence for every account a loan cannot be linked to: an id nobody has, another member's account and an account
 * that is no debt. So the answer tells nothing about the accounts of other members.
 */
const NOT_LINKABLE = "Lainan voi liittää vain omaan luottokortti- tai lainatiliin.";
/** Every request reads them all, so a runaway list stays out. */
const MAX_LOANS = 50;

const absent = (value: unknown): value is null | undefined => value === null || value === undefined;
/** A field the source did not give is null, also when the body leaves it out. */
const orNull = <T>(value: unknown, parse: (given: unknown) => T): T | null => (absent(value) ? null : parse(value));

/** A whole number from `min` to `max`: no fraction of a cent or of a hundredth of a percent reaches core. */
function whole(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new UserError(message);
  // JSON can say -0
  return value || 0;
}

/** `subject` is the field as the sentence needs it ("Maksuerän"), in the words of the loan form. */
const cents = (value: unknown, min: 0 | 1, subject: string) => whole(value, min, MAX_CENTS, `${subject} pitää olla vähintään ${min === 0 ? "0" : "0,01"} € ja enintään ${MAX_EUROS}.`);

const rate = (value: unknown, subject: string) => whole(value, 0, MAX_RATE_BP, `${subject} pitää olla 0–${MAX_RATE_BP / 100} %, enintään kahden desimaalin tarkkuudella.`);

function oneOf<T extends string>(value: unknown, list: readonly T[], message: string): T {
  if (typeof value !== "string" || !(list as readonly string[]).includes(value)) throw new UserError(message);
  return value as T;
}

function date(value: unknown, from: string, to: string, message: string): string {
  if (!isIsoDate(value) || value < from || value > to) throw new UserError(message);
  return value;
}

function parseName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_NAME || UNSEEN.test(name)) throw new UserError(`Anna lainalle nimi, 1–${MAX_NAME} merkkiä.`);
  return name;
}

/** A blank lender is none. */
function parseLender(value: unknown): string | null {
  const lender = typeof value === "string" ? value.trim() : null;
  if (lender === null || lender.length > MAX_NAME || UNSEEN.test(lender)) throw new UserError(`Lainanantajan nimi voi olla enintään ${MAX_NAME} merkkiä.`);
  return lender || null;
}

function parseSeriesKey(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > MAX_SERIES_KEY || UNSEEN.test(value)) throw new UserError("Virheellinen maksusarja.");
  return value;
}

/**
 * The account a loan is linked to: one of the user's own, of a type whose balance is a debt. Every other value gets
 * the one sentence of `NOT_LINKABLE`.
 */
async function parseAccountId(value: unknown, accounts: OwnAccounts): Promise<string> {
  const account = typeof value === "string" && value && value.length <= MAX_ACCOUNT_ID ? await accounts.getAccount(value) : null;
  if (!account || !DEBT_ACCOUNT_TYPES.includes(account.type)) throw new UserError(NOT_LINKABLE);
  return account.id;
}

/**
 * The split of the last payment a loan document stated, from the body of a save: null when the body has none. The date
 * is a payment that has been made, and the parts are whole cents that make a payment of at most the largest amount
 * (the sum is exact in core). Whether they fit the loan's own payment is for the form to tell: a document may state a
 * payment that differs from the usual one.
 */
function parseLastPayment(raw: unknown, today: string): PaymentParts | null {
  const given = strictObject(raw, BODY_FIELDS).lastPayment;
  if (absent(given)) return null;
  const input = strictObject(given, LAST_PAYMENT_FIELDS);
  const part: PaymentParts = {
    dueDate: date(input.date, addMonthsToDate(today, -12 * YEARS_BACK), today, `Viimeisen erän päivä voi olla enintään ${YEARS_BACK} vuotta sitten, eikä se voi olla tulevaisuudessa.`),
    principalCents: cents(input.principalCents, 0, "Viimeisen erän lyhennyksen"),
    interestCents: cents(input.interestCents, 0, "Viimeisen erän koron"),
    feeCents: cents(input.feeCents, 0, "Viimeisen erän kulujen"),
  };
  const total = part.principalCents + part.interestCents + part.feeCents;
  if (total < 1 || total > MAX_CENTS) throw new UserError(`Viimeisen erän osat pitää olla yhteensä vähintään 0,01 € ja enintään ${MAX_EUROS}.`);
  return part;
}

/** An account has one saved loan. The loan in the way is the user's own, so the answer names it. */
const heldBy = (holder: Loan) => new UserError(`Tähän tiliin on jo liitetty laina ${holder.name}. Poista liitos siitä ensin.`);

/**
 * The fields of a loan, each checked against its range or list. Throws a UserError with a message safe to show.
 * `accounts` reads the user's own accounts, for the one a loan is linked to.
 */
export async function parseLoan(raw: unknown, today: string, accounts: OwnAccounts): Promise<LoanFields> {
  const input = strictObject(raw, BODY_FIELDS);
  const oldest = addMonthsToDate(today, -12 * YEARS_BACK);
  const latest = addMonthsToDate(today, 12 * YEARS_AHEAD);
  const loan: LoanFields = {
    name: parseName(input.name),
    lender: orNull(input.lender, parseLender),
    kind: oneOf(input.kind, LOAN_KINDS, "Tuntematon laji."),
    grantedCents: orNull(input.grantedCents, (v) => cents(v, 1, "Myönnetyn määrän")),
    balanceCents: cents(input.balanceCents, 0, "Lainaa jäljellä"),
    // a balance told for a day that has not come is a guess, and core tells nothing before the balance date
    balanceDate: date(input.balanceDate, oldest, today, `Saldon päivä voi olla enintään ${YEARS_BACK} vuotta sitten, eikä se voi olla tulevaisuudessa.`),
    rateBp: orNull(input.rateBp, (v) => rate(v, "Kokonaiskoron")),
    reference: orNull(input.reference, (v) => oneOf(v, LOAN_REFERENCES, "Tuntematon viitekorko.")),
    marginBp: orNull(input.marginBp, (v) => rate(v, "Marginaalin")),
    repayment: orNull(input.repayment, (v) => oneOf(v, LOAN_REPAYMENTS, "Tuntematon lyhennystapa.")),
    intervalMonths: orNull(input.intervalMonths, (v) => whole(v, 1, MAX_LOAN_INTERVAL_MONTHS, `Lyhennysvälin pitää olla 1–${MAX_LOAN_INTERVAL_MONTHS} kuukautta.`)),
    paymentCents: orNull(input.paymentCents, (v) => cents(v, 1, "Maksuerän")),
    // one that has passed is kept: core reads it as no last due date
    endDate: orNull(input.endDate, (v) => date(v, oldest, latest, `Viimeinen eräpäivä voi olla enintään ${YEARS_BACK} vuotta sitten ja ${YEARS_AHEAD} vuoden päässä.`)),
    limitCents: orNull(input.limitCents, (v) => cents(v, 1, "Luottorajan")),
    seriesKey: orNull(input.seriesKey, parseSeriesKey),
  };
  // a day that has passed is kept: the rate has been reviewed since. A loan with no day has no field, as with the link.
  if (!absent(input.rateReviewDate)) loan.rateReviewDate = date(input.rateReviewDate, oldest, latest, `Koron tarkistuspäivä voi olla enintään ${YEARS_BACK} vuotta sitten ja ${YEARS_AHEAD} vuoden päässä.`);
  // a fixed rate is not set again: a day sent with one is checked and dropped, as the form leaves it out
  if (loan.reference === "fixed") delete loan.rateReviewDate;
  // a card or a credit line is drawn and paid as its holder likes: it has a limit and no plan
  if (isRevolving(loan.kind) && loan.repayment !== null) {
    throw new UserError("Luottokortilla ja luottolimiitillä ei ole lyhennystapaa. Jätä se tyhjäksi.");
  }
  if (loan.repayment === "bullet" && loan.paymentCents !== null) throw new UserError("Kertalyhenteisellä lainalla ei ole maksuerää. Jätä maksuerä tyhjäksi.");
  // The one way a balance could grow: a payment that holds the interest and is smaller than it. The interest only
  // shrinks with the balance, so a payment that covers the first interval covers every later one.
  const holdsInterest = loan.repayment === "annuity" || loan.repayment === "fixed_instalment";
  if (holdsInterest && loan.paymentCents !== null && loan.rateBp !== null && loan.intervalMonths !== null) {
    if (loan.paymentCents < loanPeriodInterest(loan.balanceCents, loan.rateBp, loan.intervalMonths)) {
      throw new UserError(
        "Maksuerä on pienempi kuin lyhennysvälin korko, joten laina ei lyhenisi. Tarkista luvut tai jätä maksuerä tyhjäksi, jos maksat vain korkoa.",
      );
    }
  }
  // Read last, so a body that fails a cheaper check costs no query. A loan with no link has no field: it is saved and
  // answered as it was before the field, and a body that leaves the field out or says null removes the link.
  if (!absent(input.accountId)) loan.accountId = await parseAccountId(input.accountId, accounts);
  return loan;
}

export function loanRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  /**
   * The home loans' series are the household's word for which payments are the mortgage, and the categories of those rows
   * follow it (core `applyDeclaredMortgages`), which also reads every saved loan's key to keep another loan's rows out. So
   * while a home loan is saved a change of any key reprocesses; any other change of a loan moves no category and is read
   * per request.
   */
  const mortgageSeries = async (userId: string) => {
    const loans = await s.finance(userId).listLoans();
    const mortgages = mortgageSeriesKeys(loans);
    return mortgages.length ? JSON.stringify([mortgages, loans.flatMap((loan) => loan.seriesKey ?? []).sort()]) : "";
  };
  /** The loan as it is answered: with the payment parts it holds, which a save keeps or adds to. */
  const withParts = async (repo: ReturnType<Services["finance"]>, loan: Loan): Promise<Loan> => {
    const stated = (await repo.listLoans()).find((l) => l.id === loan.id)?.paymentParts;
    return stated ? { ...loan, paymentParts: stated } : loan;
  };
  const afterSave = async (userId: string, before: string) => {
    if ((await mortgageSeries(userId)) !== before) await reprocess(s.finance(userId), s.settings);
  };

  /**
   * The saved loans and the published fixings they count from, so the web works loans out with the same `loansOf` as the
   * server. The fixings start at the oldest balance date, with the one before it that holds until the first.
   */
  app.get("/loans", async (c) => {
    const loans = await s.finance(c.get("user").id).listLoans();
    const since = loans.reduce((oldest, loan) => (loan.balanceDate < oldest ? loan.balanceDate : oldest), s.today());
    return c.json({ loans, fixings: await s.referenceRates.since(since) });
  });

  /**
   * The loans the bank rows show and the household has not answered (`loanProposals`). Worked out for each request
   * from the viewer's own rows and marks and the saved loans of the own view (`loansInView`: a loan another user of a
   * joint account saved is not proposed again), outside the cached context: "Ei ole laina" or a saved loan takes effect
   * at once and moves no data version. A row id, the account and the payment reference stay on the server.
   */
  app.get("/loans/proposals", async (c) => {
    const proposals = (await proposalsFor(s, c.get("user").id)).map(({ key, payee, paymentCents, months, firstDate, lastDate, kind }) => ({ key, payee, paymentCents, months, firstDate, lastDate, kind }));
    return c.json({ proposals });
  });

  app.post("/loans", async (c) => {
    const repo = s.finance(c.get("user").id);
    const raw = await body(c);
    const input = await parseLoan(raw, s.today(), repo);
    const lastPayment = parseLastPayment(raw, s.today());
    if ((await repo.listLoans()).length >= MAX_LOANS) throw new UserError(`Lainoja voi olla enintään ${MAX_LOANS}. Poista ensin turhat.`);
    const loan: Loan = { id: randomToken(), ...input };
    const before = await mortgageSeries(repo.userId);
    const holder = await repo.addLoan(loan, s.now().toISOString());
    if (holder) throw heldBy(holder);
    if (lastPayment) await repo.saveLoanPaymentParts(loan.id, lastPayment);
    await afterSave(repo.userId, before);
    return c.json({ loan: await withParts(repo, loan) });
  });

  // the body is the whole loan: a field it leaves out is saved as not given. Payment parts are kept: the body adds or replaces one payment's.
  app.put("/loans/:id", async (c) => {
    const repo = s.finance(c.get("user").id);
    const raw = await body(c);
    const loan: Loan = { id: c.req.param("id"), ...(await parseLoan(raw, s.today(), repo)) };
    const lastPayment = parseLastPayment(raw, s.today());
    const before = await mortgageSeries(repo.userId);
    const saved = await repo.updateLoan(loan, s.now().toISOString());
    // another member's loan is not this user's row: the same 404 as an id that never existed
    if (saved === false) throw new NotFound("Lainaa ei löydy.");
    if (saved !== true) throw heldBy(saved);
    if (lastPayment) await repo.saveLoanPaymentParts(loan.id, lastPayment);
    await afterSave(repo.userId, before);
    return c.json({ loan: await withParts(repo, loan) });
  });

  app.delete("/loans/:id", async (c) => {
    const userId = c.get("user").id;
    const before = await mortgageSeries(userId);
    if (!(await s.finance(userId).deleteLoan(c.req.param("id")))) throw new NotFound("Lainaa ei löydy.");
    await afterSave(userId, before);
    return c.json({ ok: true });
  });

  return app;
}
