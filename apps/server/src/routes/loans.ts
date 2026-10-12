/**
 * Loans the signed-in user typed in and confirmed. Own rows only.
 *
 * Core trusts a loan's values (`packages/core/src/loans.ts`), so this file is where they are bounded. After
 * `parseLoan` every amount and rate is a whole number in a range where core's products stay exact, the dates are
 * within a lifetime of today, and no plan can make the balance grow. So a balance on any day is a whole number of
 * cents between zero and the stated balance.
 */
import { addMonthsToDate, isRevolving, LOAN_KINDS, LOAN_REFERENCES, LOAN_REPAYMENTS, type Loan, loanPeriodInterest, loanProposals, MAX_LOAN_INTERVAL_MONTHS } from "@banking/core";
import { Hono } from "hono";
import { NotFound, UserError } from "../platform/errors.ts";
import { randomToken } from "../platform/ids.ts";
import { isIsoDate, strictObject } from "../platform/validate.ts";
import { requestInputs } from "../services/analysis.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { body } from "./shared.ts";

type LoanFields = Omit<Loan, "id">;

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
] as const satisfies readonly (keyof LoanFields)[];

const MAX_NAME = 80;
/**
 * Ten million euros. Core multiplies a balance by a rate and by the days of a year (`loanInterestNext12Months`): at
 * this size and `MAX_RATE_BP` the product is 1,83e15, which a double still holds exactly. A typo stays visible too.
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
/** Every request reads them all, so a runaway list stays out. */
const MAX_LOANS = 50;

/** Control characters, and the ones nobody sees: a name of zero-width spaces would show as a blank row. */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
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
  if (!name || name.length > MAX_NAME || CONTROL.test(name)) throw new UserError(`Anna lainalle nimi, 1–${MAX_NAME} merkkiä.`);
  return name;
}

/** A blank lender is none. */
function parseLender(value: unknown): string | null {
  const lender = typeof value === "string" ? value.trim() : null;
  if (lender === null || lender.length > MAX_NAME || CONTROL.test(lender)) throw new UserError(`Lainanantajan nimi voi olla enintään ${MAX_NAME} merkkiä.`);
  return lender || null;
}

function parseSeriesKey(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > MAX_SERIES_KEY || CONTROL.test(value)) throw new UserError("Virheellinen maksusarja.");
  return value;
}

/** The fields of a loan, each checked against its range or list. Throws a UserError with a message safe to show. */
function parseLoan(raw: unknown, today: string): LoanFields {
  const input = strictObject(raw, FIELDS);
  const oldest = addMonthsToDate(today, -12 * YEARS_BACK);
  const loan: LoanFields = {
    name: parseName(input.name),
    lender: orNull(input.lender, parseLender),
    kind: oneOf(input.kind, LOAN_KINDS, "Tuntematon laji."),
    grantedCents: orNull(input.grantedCents, (v) => cents(v, 1, "Myönnetyn määrän")),
    balanceCents: cents(input.balanceCents, 0, "Lainaa jäljellä"),
    // a balance told for a day that has not come is a guess, and core tells nothing before the balance date
    balanceDate: date(input.balanceDate, oldest, today, `Jäljellä olevan summan päivä voi olla enintään ${YEARS_BACK} vuotta sitten, eikä se voi olla tulevaisuudessa.`),
    rateBp: orNull(input.rateBp, (v) => rate(v, "Kokonaiskoron")),
    reference: orNull(input.reference, (v) => oneOf(v, LOAN_REFERENCES, "Tuntematon viitekorko.")),
    marginBp: orNull(input.marginBp, (v) => rate(v, "Marginaalin")),
    repayment: orNull(input.repayment, (v) => oneOf(v, LOAN_REPAYMENTS, "Tuntematon lyhennystapa.")),
    intervalMonths: orNull(input.intervalMonths, (v) => whole(v, 1, MAX_LOAN_INTERVAL_MONTHS, `Lyhennysvälin pitää olla 1–${MAX_LOAN_INTERVAL_MONTHS} kuukautta.`)),
    paymentCents: orNull(input.paymentCents, (v) => cents(v, 1, "Maksuerän")),
    // one that has passed is kept: core reads it as no last due date
    endDate: orNull(input.endDate, (v) => date(v, oldest, addMonthsToDate(today, 12 * YEARS_AHEAD), `Viimeinen eräpäivä voi olla enintään ${YEARS_BACK} vuotta sitten ja ${YEARS_AHEAD} vuoden päässä.`)),
    limitCents: orNull(input.limitCents, (v) => cents(v, 1, "Luottorajan")),
    seriesKey: orNull(input.seriesKey, parseSeriesKey),
  };
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
        "Maksuerä on pienempi kuin lyhennysvälin korko, joten laina ei lyhenisi. Tarkista korko ja maksuerä. Jos lainassa on lyhennysvapaa tai maksat vain korkoa, jätä maksuerä tyhjäksi. Jäljellä oleva laina pysyy silloin ennallaan.",
      );
    }
  }
  return loan;
}

export function loanRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.get("/loans", async (c) => c.json({ loans: await s.finance(c.get("user").id).listLoans() }));

  /**
   * The loans the bank rows show and the household has not answered (`loanProposals`). Worked out for each request
   * from the viewer's own rows, marks and saved loans, outside the cached context: "Ei laina" or a saved loan takes
   * effect at once and moves no data version. A row id, the account and the payment reference stay on the server.
   */
  app.get("/loans/proposals", async (c) => {
    const userId = c.get("user").id;
    const { ctx, accounts } = await s.analysis.get(s, userId, "own");
    const { inputs } = await requestInputs(s, userId, accounts);
    const proposals = loanProposals(ctx, inputs).map(({ key, payee, paymentCents, months, firstDate, lastDate, kind }) => ({ key, payee, paymentCents, months, firstDate, lastDate, kind }));
    return c.json({ proposals });
  });

  app.post("/loans", async (c) => {
    const repo = s.finance(c.get("user").id);
    const input = parseLoan(await body(c), s.today());
    if ((await repo.listLoans()).length >= MAX_LOANS) throw new UserError(`Lainoja voi olla enintään ${MAX_LOANS}. Poista ensin turhat.`);
    const loan: Loan = { id: randomToken(), ...input };
    // loans are read per request, so nothing is cached and no data version moves
    await repo.addLoan(loan, s.now().toISOString());
    return c.json({ loan });
  });

  // the body is the whole loan: a field it leaves out is saved as not given
  app.put("/loans/:id", async (c) => {
    const loan: Loan = { id: c.req.param("id"), ...parseLoan(await body(c), s.today()) };
    // another member's loan is not this user's row: the same 404 as an id that never existed
    if (!(await s.finance(c.get("user").id).updateLoan(loan, s.now().toISOString()))) throw new NotFound("Lainaa ei löydy.");
    return c.json({ loan });
  });

  app.delete("/loans/:id", async (c) => {
    if (!(await s.finance(c.get("user").id).deleteLoan(c.req.param("id")))) throw new NotFound("Lainaa ei löydy.");
    return c.json({ ok: true });
  });

  return app;
}
