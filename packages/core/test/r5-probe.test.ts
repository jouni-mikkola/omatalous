/**
 * Edge cases of loan payment accounts and the kind of a loan: an account the bank types as a loan that only passes
 * the instalments on is no debt, a paid-off loan account says so, and an instalment series nobody can place is asked
 * once, unless its size and the household's charges (or the payee's words) already tell what it is. Made-up rows,
 * payees and sums only.
 *
 * A line marked `API: adjust name` guesses a name the change adds: adapt the call there, never the expectation.
 */
import { describe, expect, it } from "vitest";
import { applyUse } from "../src/account-use.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { LOAN_KIND_ANSWERS, loanKindSubject, loanProposals } from "../src/loan-detect.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, BalanceInput, LoanKind, Part, Transaction, UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const range = { from: "2025-10-10", to: today };
const MONTHS = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const BANK = "ESIMERKKIPANKKI";
const HALF: Part = { from: 0, to: 1, of: 2 };

/** A made-up Finnish account number with a check that holds, so the transfer pairing reads it as any other. */
function iban(bban: string): string {
  const check = 98n - (BigInt(`${bban}151800`) % 97n);
  return `FI${String(check).padStart(2, "0")}${bban}`;
}
const IBANS: Record<string, string> = {
  "acc-1": iban("12345600000017"),
  pay: iban("12345600000025"),
  joint: iban("12345600000033"),
  jpay: iban("12345600000041"),
  old: iban("12345600000058"),
  save: iban("12345600000066"),
  home: iban("12345600000074"),
};
const accountOf = (b: BalanceInput): Account => ({ id: b.id, name: b.name, iban: IBANS[b.id] ?? null, currency: "EUR", type: b.type });
const account = (id: string, type: BalanceInput["type"], balanceCents: number, more: Partial<BalanceInput> = {}): BalanceInput => ({
  id, name: type === "loan" ? "Laina 1234" : "Käyttötili", type, balanceCents, ownerName: null, balanceAt: today, ...more,
});
const checking = account("acc-1", "checking", 250_000);

/** Money moved each month from one own account to another: both legs, each naming the other account. */
function ownTransfers(from: string, to: string, cents: number, months = MONTHS, day = "01"): Transaction[] {
  const leg = (accountId: string, amountCents: number, other: string) =>
    tx({ accountId, bookingDate: "", amountCents, merchant: "Matti Meikalainen", counterparty: "Matti Meikalainen", counterpartyIban: IBANS[other] ?? null, description: "Oma siirto" });
  return months.flatMap((m) => [
    { ...leg(from, -cents, to), bookingDate: `${m}-${day}` },
    { ...leg(to, cents, from), bookingDate: `${m}-${day}` },
  ]);
}

/** A payment to one payee on one day of each month. */
const monthly = (accountId: string, payee: string, cents: number, description: string, category: string, months = MONTHS, day = "02"): Transaction[] =>
  months.map((m) => tx({ accountId, bookingDate: `${m}-${day}`, amountCents: -cents, merchant: payee, counterparty: payee, description, category }));

/** The instalments a bank takes, filed as the bank files them: consumer credit. */
const instalments = (accountId: string, cents: number, payee = BANK, months = MONTHS) => monthly(accountId, payee, cents, "Lainan lyhennys", "loans", months);
const vastike = (accountId = "acc-1") => monthly(accountId, "AS OY ESIMERKKI", 31_000, "Hoitovastike", "housing", MONTHS, "05");
const rent = (accountId = "acc-1") => monthly(accountId, "ESIMERKKI VUOKRAUS OY", 95_000, "Vuokra", "housing", MONTHS, "05");

/**
 * The household's pages on the rows: the transfer flags are the pipeline's, the categories the bank's as given. With a
 * part, the joint accounts are seen as one member's own view (Oma), else as the whole household (Koko talous).
 */
function view(rows: readonly Transaction[], balances: readonly BalanceInput[], inputs: Partial<UserInputs> = {}, part?: Part) {
  const accounts = balances.map(accountOf);
  const flagged = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t.isTransfer]));
  let all: readonly Transaction[] = rows.map((t) => ({ ...t, isTransfer: flagged.get(t.id) ?? t.isTransfer }));
  const shown = balances.map((b) => (part && b.joint ? { ...b, part } : b));
  if (part) all = applyUse(all, accounts.filter((a) => balances.find((b) => b.id === a.id)?.joint), new Map(shown.filter((b) => b.joint).map((b) => [b.id, part])));
  const ctx = createContext(all, accounts, today);
  const full: UserInputs = { marks: [], expectedBills: [], loans: [], ...inputs };
  const dashboard = buildDashboard(ctx, range, shown, full);
  return { ctx, rows: all, balances: shown, inputs: full, housing: dashboard.housing, holdings: dashboard.holdings, questions: buildQuestions(ctx, range, full) };
}
type View = ReturnType<typeof view>;

/** What core makes of an account the bank types as a loan: a payment account (Lainanhoitotili), a paid-off loan (Maksettu) or a debt. */
type Role = "payment" | "paid" | "debt";
const roleOf = (v: View, accountId: string): Role =>
  v.holdings.accounts.find((a) => a.id === accountId)?.loanPayment ? "payment" : debtRow(v, accountId) ? "debt" : "paid"; // API: adjust name

const loanAsked = (v: View) => v.questions.items.filter((q) => q.kind === "loan"); // API: adjust name (the list of questions)
const payeeAsked = (v: View, payee: string) => v.questions.items.filter((q) => q.kind !== "loan" && "merchant" in q && q.merchant.toUpperCase().includes(payee)); // API: adjust name
const debtRow = (v: View, accountId: string) => v.holdings.loans.find((row) => row.id === `account:${accountId}`);
/** The rows of Asuminen made from payments with no saved loan. */
const housingSeries = (v: View) => (v.housing?.loans ?? []).filter((row) => row.seriesId !== null);

/** The household's answer to "Mikä laina tämä on?" for the series a proposal names. */
const answered = (key: string, kind: LoanKind): Partial<UserInputs> => ({
  marks: [{ subject: loanKindSubject(kind as (typeof LOAN_KIND_ANSWERS)[number], key), mark: "in_use", markedAt: "2026-10-01T08:00:00.000Z" }], // API: adjust name
});
const keyOf = (v: View, payee: string) => loanProposals(v.ctx, v.inputs).find((p) => p.payee.toUpperCase().includes(payee))!.key; // API: adjust name

/** A payment account: 650 € in by own transfers each month, 649,90 € out to the bank, 0,45 € short today. */
const paymentRows = (from = "acc-1", to = "pay") => [...ownTransfers(from, to, 65_000), ...instalments(to, 64_990)];

describe("an account typed as a loan that only passes the instalments on", () => {
  it("is a payment account: no debt, its transfers in are own transfers, its instalments the loan's, and the loan is asked once", () => {
    const rows = paymentRows();
    const v = view(rows, [checking, account("pay", "loan", -45)]);
    expect(roleOf(v, "pay")).toBe("payment");
    expect(debtRow(v, "pay")).toBeUndefined();
    expect(v.holdings.debtCents).toBe(0);
    const byId = new Map(v.rows.map((t) => [t.id, t]));
    const inPay = rows.filter((t) => t.accountId === "pay");
    expect(inPay.filter((t) => t.amountCents > 0).every((t) => byId.get(t.id)!.isTransfer)).toBe(true);
    expect(inPay.filter((t) => t.amountCents < 0).some((t) => byId.get(t.id)!.isTransfer)).toBe(false);
    expect(loanAsked(v)).toHaveLength(1);
    expect(loanAsked(v)[0]).toMatchObject({ payee: BANK, paymentCents: 64_990 });
    expect(payeeAsked(v, BANK)).toEqual([]);
    expect(payeeAsked(v, "MEIKALAINEN")).toEqual([]);
  });

  it("the 1 % line: 77 € short of a 7 800 € year is still a payment account, 85 € short is a debt of 85 €", () => {
    const under = view(paymentRows(), [checking, account("pay", "loan", -7_700)]);
    expect(roleOf(under, "pay")).toBe("payment");
    expect(under.holdings.debtCents).toBe(0);
    const over = view(paymentRows(), [checking, account("pay", "loan", -8_500)]);
    expect(roleOf(over, "pay")).toBe("debt");
    expect(over.holdings.debtCents).toBe(8_500);
  });

  it("money in from someone else than the household is no payment account's", () => {
    const stranger = MONTHS.map((m) =>
      tx({ accountId: "pay", bookingDate: `${m}-01`, amountCents: 65_000, merchant: "ESIMERKKI OY", counterparty: "ESIMERKKI OY", counterpartyIban: iban("98765400000012"), description: "Palkka" }),
    );
    const v = view([...stranger, ...instalments("pay", 64_990)], [checking, account("pay", "loan", -45)]);
    expect(roleOf(v, "pay")).not.toBe("payment");
  });

  it("one late fee to the bank leaves it a payment account, and the loan is asked once at its instalment", () => {
    const fee = tx({ accountId: "pay", bookingDate: "2026-07-15", amountCents: -500, merchant: BANK, counterparty: BANK, description: "Muistutusmaksu", category: "loans" });
    const v = view([...paymentRows(), fee], [checking, account("pay", "loan", -45)]);
    expect(roleOf(v, "pay")).toBe("payment");
    expect(v.holdings.debtCents).toBe(0);
    expect(loanAsked(v)).toHaveLength(1);
    expect(loanAsked(v)[0]).toMatchObject({ payee: BANK, paymentCents: 64_990 });
  });

  it("a savings account typed as a loan by mistake is no payment account, no debt and no loan to ask about", () => {
    const v = view(ownTransfers("acc-1", "save", 10_000), [checking, account("save", "loan", 500_000)]);
    expect(roleOf(v, "save")).not.toBe("payment");
    expect(v.holdings.debtCents).toBe(0);
    expect(loanAsked(v)).toEqual([]);
  });

  it("a joint payment account fed from a joint account is no debt in either view, and the question tells the whole instalment in both", () => {
    const balances = [account("joint", "checking", 300_000, { joint: true }), account("jpay", "loan", -45, { joint: true })];
    const rows = paymentRows("joint", "jpay");
    for (const v of [view(rows, balances), view(rows, balances, {}, HALF)]) {
      expect(roleOf(v, "jpay")).toBe("payment");
      expect(debtRow(v, "jpay")).toBeUndefined();
      expect(v.holdings.debtCents).toBe(0);
      expect(loanAsked(v)).toHaveLength(1);
      expect(loanAsked(v)[0]).toMatchObject({ paymentCents: 64_990 });
    }
  });
});

describe("a loan account that owes, or owed", () => {
  it("a real loan with a falling balance is a debt at the bank's balance", () => {
    const v = view(ownTransfers("acc-1", "home", 91_240), [checking, account("home", "loan", -12_000_000)]);
    expect(roleOf(v, "home")).toBe("debt");
    expect(debtRow(v, "home")?.leftCents).toBe(12_000_000);
    expect(v.holdings.debtCents).toBe(12_000_000);
  });

  it("paid off: balance 0 and no flow for over 3 months is paid, no debt, nothing asked", () => {
    const v = view(ownTransfers("acc-1", "old", 30_000, MONTHS.slice(0, 7)), [checking, account("old", "loan", 0)]);
    expect(roleOf(v, "old")).toBe("paid");
    expect(v.holdings.debtCents).toBe(0);
    expect(loanAsked(v)).toEqual([]);
  });

  it("paid off with one last interest row two months after the last payment is still paid, not a payment account", () => {
    const interest = tx({ accountId: "old", bookingDate: "2026-07-31", amountCents: -312, merchant: BANK, counterparty: BANK, description: "Korko", category: "loans" });
    const v = view([...ownTransfers("acc-1", "old", 30_000, MONTHS.slice(0, 7)), interest], [checking, account("old", "loan", 0)]);
    expect(roleOf(v, "old")).toBe("paid");
    expect(v.holdings.debtCents).toBe(0);
    expect(loanAsked(v)).toEqual([]);
  });

  it("balance 0 while the money still runs through it is a payment account, not paid", () => {
    const v = view(paymentRows(), [checking, account("pay", "loan", 0)]);
    expect(roleOf(v, "pay")).toBe("payment");
  });
});

describe("instalments to a bank with no loan account", () => {
  it("a series nothing places is asked once, with the payee and the month, and Asuminen does not take it", () => {
    const v = view(instalments("acc-1", 65_000), [checking]);
    expect(loanAsked(v)).toHaveLength(1);
    expect(loanAsked(v)[0]).toMatchObject({ payee: BANK, paymentCents: 65_000 });
    expect(payeeAsked(v, BANK)).toEqual([]);
    expect(housingSeries(v)).toEqual([]);
  });

  it("over 400 € a month with a housing company charge and no rent is the home loan, without asking", () => {
    const v = view([...instalments("acc-1", 91_240), ...vastike()], [checking]);
    expect(housingSeries(v).map((row) => row.monthlyCents)).toEqual([91_240]);
    expect(v.housing!.ask).toBe(false);
    expect(loanAsked(v)).toEqual([]);
  });

  it("the 400 € line: 380 € is asked and not taken as the home loan, 401 € is taken", () => {
    const under = view([...instalments("acc-1", 38_000), ...vastike()], [checking]);
    expect(housingSeries(under)).toEqual([]);
    expect(loanAsked(under).map((q) => q.kind === "loan" && q.paymentCents)).toEqual([38_000]);
    const over = view([...instalments("acc-1", 40_100), ...vastike()], [checking]);
    expect(housingSeries(over).map((row) => row.monthlyCents)).toEqual([40_100]);
    expect(loanAsked(over)).toEqual([]);
  });

  it("a household that pays rent has no home loan to infer: the instalments are asked", () => {
    const v = view([...instalments("acc-1", 91_240), ...rent()], [checking]);
    expect(housingSeries(v)).toEqual([]);
    expect(loanAsked(v).map((q) => q.kind === "loan" && q.paymentCents)).toEqual([91_240]);
  });

  it("a bank's car-finance payee is a car loan without asking, and no home loan", () => {
    const payee = "ESIMERKKI AUTORAHOITUS OY";
    const v = view([...monthly("acc-1", payee, 32_000, "Autolaina", "loans"), ...vastike()], [checking]);
    expect(loanProposals(v.ctx, v.inputs).find((p) => p.payee.toUpperCase().includes("AUTORAHOITUS"))?.kind ?? "car").toBe("car");
    expect(loanAsked(v)).toEqual([]);
    expect(housingSeries(v)).toEqual([]);
  });

  it("a home loan paid from a joint account: the whole month for the household, the member's part in Oma, asked in neither", () => {
    const joint = account("joint", "checking", 300_000, { joint: true });
    const rows = [...instalments("joint", 91_240), ...vastike("joint")];
    const whole = view(rows, [joint]);
    const own = view(rows, [joint], {}, HALF);
    expect(housingSeries(whole).map((row) => row.monthlyCents)).toEqual([91_240]);
    expect(housingSeries(own).map((row) => [row.monthlyCents, row.part])).toEqual([[45_620, HALF]]);
    for (const v of [whole, own]) {
      expect(v.housing!.ask).toBe(false);
      expect(loanAsked(v)).toEqual([]);
    }
  });
});

describe("the household's answer wins and is never asked again", () => {
  it("380 € answered Asuntolaina is Asuminen's home loan, also after the rate moves the payment", () => {
    const base = [...instalments("acc-1", 38_000, BANK, MONTHS.slice(0, 11)), ...vastike()];
    const key = keyOf(view(base, [checking]), BANK);
    const v = view(base, [checking], answered(key, "mortgage"));
    expect(housingSeries(v).map((row) => row.monthlyCents)).toEqual([38_000]);
    expect(v.housing!.ask).toBe(false);
    expect(loanAsked(v)).toEqual([]);
    const moved = view([...base, ...instalments("acc-1", 38_500, BANK, ["2026-10"])], [checking], answered(key, "mortgage"));
    expect(loanAsked(moved)).toEqual([]);
    expect(housingSeries(moved)).toHaveLength(1);
  });

  it("912,40 € with a housing company charge answered Kulutusluotto is no home loan, whatever the inference says", () => {
    const rows = [...instalments("acc-1", 91_240), ...vastike()];
    const key = keyOf(view(rows, [checking], {}), BANK);
    const v = view(rows, [checking], answered(key, "consumer"));
    expect(housingSeries(v)).toEqual([]);
    expect(loanAsked(v)).toEqual([]);
  });

  it("a car-finance payee answered Muu laina stays the household's word: not asked, not a home loan", () => {
    const payee = "ESIMERKKI AUTORAHOITUS OY";
    const rows = [...monthly("acc-1", payee, 52_000, "Autolaina", "loans"), ...vastike()];
    const key = keyOf(view(rows, [checking]), "AUTORAHOITUS");
    const v = view(rows, [checking], answered(key, "other"));
    expect(loanAsked(v)).toEqual([]);
    expect(housingSeries(v)).toEqual([]);
  });

  it("the instalments of a payment account answered Asuntolaina are the home loan, and the account is still no debt", () => {
    const rows = paymentRows();
    const balances = [checking, account("pay", "loan", -45)];
    const key = keyOf(view(rows, balances), BANK);
    const v = view(rows, balances, answered(key, "mortgage"));
    expect(housingSeries(v).map((row) => row.monthlyCents)).toEqual([64_990]);
    expect(v.housing!.ask).toBe(false);
    expect(v.holdings.debtCents).toBe(0);
    expect(loanAsked(v)).toEqual([]);
  });
});
