import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { buildQuestions, QUESTION_PAYEE } from "../src/analysis/questions.ts";
import { addMonths } from "../src/dates.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { type Account, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const range = { from: "2026-10-01", to: today };
const eur = (euros: number) => Math.round(euros * 100);
const names = (items: ReturnType<typeof buildQuestions>["items"]) => items.map((i) => (i.kind === "loan" ? i.payee : i.merchant));

/** A row the household's rules recognised: nothing in it is a question. */
const known = (euros: number, merchant: string, category: string, over: Partial<Transaction> = {}) =>
  tx({ bookingDate: "2026-09-20", amountCents: eur(euros), merchant, category, categorySource: "rule", ...over });
/** A payment the default left in Muut menot. */
const unknownOut = (euros: number, merchant: string, over: Partial<Transaction> = {}) => tx({ bookingDate: "2026-09-21", amountCents: -eur(euros), merchant, ...over });
/** Money in the default left as Muut tulot. */
const unknownIn = (euros: number, merchant: string, over: Partial<Transaction> = {}) => tx({ bookingDate: "2026-09-22", amountCents: eur(euros), merchant, category: "income", ...over });

const base = () => [known(-800, "Prisma", "groceries"), known(1000, "Acme Oy", "salary")];
const questionsOf = (rows: Transaction[], inputs: UserInputs = NO_INPUTS, accounts: Account[] = [checking]) => buildQuestions(createContext(rows, accounts, today), range, inputs);
const dismiss = (merchant: string): UserInputs => ({ ...NO_INPUTS, marks: [{ subject: QUESTION_PAYEE + merchant, mark: "dismissed", markedAt: "2026-10-01T10:00:00" }] });

describe("how much of the money is classified", () => {
  it("is 1 when every row has its category, and null without money", () => {
    expect(questionsOf(base())).toMatchObject({ share: 1, outCents: 80000, inCents: 100000, outUnknownCents: 0, inUnknownCents: 0, cardBillCents: 0, items: [], total: 0 });
    expect(questionsOf([]).share).toBeNull();
    expect(questionsOf([known(-800, "Oma tili", "transfer", { isTransfer: true })]).share).toBeNull();
  });

  it("takes each of the three unknown sums alone, to the cent", () => {
    expect(questionsOf([...base(), unknownOut(100, "Kioski Oy")])).toMatchObject({ outCents: 90000, outUnknownCents: 10000, share: 1 - 10000 / 190000 });
    expect(questionsOf([...base(), unknownIn(50, "Kaveri")])).toMatchObject({ inCents: 105000, inUnknownCents: 5000, share: 1 - 5000 / 185000 });
    expect(questionsOf([...base(), known(-200, "Visa", "card_bill")])).toMatchObject({ outCents: 100000, cardBillCents: 20000, outUnknownCents: 0, share: 1 - 20000 / 200000 });
  });

  it("takes the three together, and a transfer and a pending row move nothing", () => {
    const rows = [...base(), unknownOut(100, "Kioski Oy"), unknownIn(50, "Kaveri"), known(-200, "Visa", "card_bill")];
    const q = questionsOf(rows);
    expect(q).toMatchObject({ outCents: 110000, inCents: 105000, outUnknownCents: 10000, inUnknownCents: 5000, cardBillCents: 20000 });
    expect(q.share).toBe(1 - 35000 / 215000);
    const noise = [known(-500, "Oma tili", "transfer", { isTransfer: true }), unknownOut(900, "Odottaa Oy", { status: "pending" })];
    expect(questionsOf([...rows, ...noise])).toEqual(q);
  });

  it("nets a payment that came back: whole it moves nothing, in part it counts what was left", () => {
    const back = (euros: number) => tx({ bookingDate: "2026-09-28", amountCents: eur(euros), merchant: "Kioski Oy" });
    const whole = questionsOf([...base(), unknownOut(100, "Kioski Oy"), back(100)]);
    expect(whole).toMatchObject({ outCents: 80000, outUnknownCents: 0, share: 1, items: [] });
    const part = questionsOf([...base(), unknownOut(100, "Kioski Oy"), back(40)]);
    expect(part).toMatchObject({ outCents: 86000, outUnknownCents: 6000, items: [{ kind: "payee_out", merchant: "Kioski Oy", cents: 6000, count: 1 }] });
  });

  it("reads the 365 days up to the period's end", () => {
    const old = unknownOut(100, "Kioski Oy", { bookingDate: "2025-10-09" });
    const edge = unknownOut(30, "Kioski Oy", { bookingDate: "2025-10-10" });
    expect(questionsOf([...base(), old]).outUnknownCents).toBe(0);
    expect(questionsOf([...base(), edge]).outUnknownCents).toBe(3000);
  });
});

describe("what would mend it most", () => {
  it("ranks by the sum, then kind, then name, and gives each payee its sum, count and last day", () => {
    const rows = [
      ...base(),
      unknownOut(20, "Beta Oy"),
      unknownOut(20, "Alfa Oy"),
      unknownIn(20, "Alfa Oy"),
      unknownOut(30, "Gamma Oy", { bookingDate: "2026-08-01" }),
      unknownOut(10, "Gamma Oy", { bookingDate: "2026-09-02" }),
      unknownOut(90, "Delta Oy"),
    ];
    expect(questionsOf(rows).items).toEqual([
      { kind: "payee_out", merchant: "Delta Oy", cents: 9000, count: 1, lastDate: "2026-09-21" },
      { kind: "payee_out", merchant: "Gamma Oy", cents: 4000, count: 2, lastDate: "2026-09-02" },
      { kind: "payee_in", merchant: "Alfa Oy", cents: 2000, count: 1, lastDate: "2026-09-22" },
      { kind: "payee_out", merchant: "Alfa Oy", cents: 2000, count: 1, lastDate: "2026-09-21" },
      { kind: "payee_out", merchant: "Beta Oy", cents: 2000, count: 1, lastDate: "2026-09-21" },
    ]);
  });

  it("gives the unknown payee no row but lowers the share", () => {
    const q = questionsOf([...base(), unknownOut(100, "Tuntematon")]);
    expect(q.items).toEqual([]);
    expect(q.total).toBe(0);
    expect(q.share).toBe(1 - 10000 / 190000);
  });

  it("leaves a payee the household set aside without a row, and the share as it was", () => {
    const rows = [...base(), unknownOut(100, "Kioski Oy"), unknownIn(50, "Kaveri")];
    const before = questionsOf(rows);
    const after = questionsOf(rows, dismiss("Kioski Oy"));
    expect(names(before.items)).toEqual(["Kioski Oy", "Kaveri"]);
    expect(names(after.items)).toEqual(["Kaveri"]);
    expect({ ...after, items: [], total: 0 }).toEqual({ ...before, items: [], total: 0 });
    // another payee's name is not set aside
    expect(questionsOf(rows, dismiss("Kioski")).items).toHaveLength(2);
  });

  it("gives a payee with a category of its own no row", () => {
    const rows = [...base(), unknownOut(100, "Kioski Oy", { category: "home", categorySource: "rule" }), unknownOut(100, "Kauppa", { categorySource: "user" }), unknownIn(50, "Kaveri", { categorySource: "rule", category: "salary" })];
    expect(questionsOf(rows)).toMatchObject({ items: [], share: 1 });
  });

  it("gives five of six and says six", () => {
    const rows = [...base(), ...[10, 20, 30, 40, 50, 60].map((euros, i) => unknownOut(euros, `Kauppa ${i}`))];
    const q = questionsOf(rows);
    expect(q.items.map((i) => i.cents)).toEqual([6000, 5000, 4000, 3000, 2000]);
    expect(q.total).toBe(6);
  });

  it("gives a loan proposal a row of twelve payments, and none once it is marked Ei laina", () => {
    const rows: Transaction[] = Array.from({ length: 6 }, (_, i) =>
      tx({ bookingDate: `${addMonths("2026-10", i - 5)}-05`, amountCents: -41200, description: "AUTORAHOITUS 44512", counterparty: "TOYOTA FINANCE FINLAND OY", merchant: normalizeMerchant("TOYOTA FINANCE FINLAND OY", "AUTORAHOITUS 44512") }),
    );
    const ctx = createContext(enrichTransactions([...rows, ...base()], [checking], []), [checking], today);
    const loan = buildQuestions(ctx, range, NO_INPUTS).items.find((i) => i.kind === "loan");
    expect(loan).toMatchObject({ kind: "loan", paymentCents: 41200, cents: 12 * 41200 });
    const key = loan?.kind === "loan" ? loan.key : "";
    const marked: UserInputs = { ...NO_INPUTS, marks: [{ subject: `loan-proposal:${key}`, mark: "dismissed", markedAt: "2026-10-01T10:00:00" }] };
    expect(buildQuestions(ctx, range, marked).items.some((i) => i.kind === "loan")).toBe(false);
  });

  it("differs by scope where a row is on a member's own account", () => {
    const joint = [...base(), unknownOut(100, "Kioski Oy")];
    const second: Account = { id: "acc-2", name: "Oma", iban: null, currency: "EUR", type: "checking" };
    const own = buildQuestions(createContext(joint, [checking], today), range, NO_INPUTS);
    const household = buildQuestions(createContext([...joint, unknownOut(300, "Oma Kauppa", { accountId: "acc-2" })], [checking, second], today), range, NO_INPUTS);
    expect(own.outUnknownCents).toBe(10000);
    expect(household.outUnknownCents).toBe(40000);
    expect(names(household.items)).toEqual(["Oma Kauppa", "Kioski Oy"]);
    expect(own.share).not.toBe(household.share);
  });
});

describe("the dashboard", () => {
  it("carries the answer", () => {
    const rows = [...base(), unknownOut(100, "Kioski Oy")];
    expect(buildDashboard(createContext(rows, [checking], today), range).questions).toEqual(questionsOf(rows));
  });
});
