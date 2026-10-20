import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { buildQuestions, QUESTION_PAYEE, withoutRowIds } from "../src/analysis/questions.ts";
import { addMonths } from "../src/dates.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { type Account, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const range = { from: "2026-10-01", to: today };
const eur = (euros: number) => Math.round(euros * 100);
const names = (items: ReturnType<typeof buildQuestions>["items"]) => items.map((i) => (i.kind === "loan" || i.kind === "plan" ? i.payee : i.merchant));

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

describe("how much of the spending is known (knownSpending)", () => {
  it("is 1 when every row has its category, and null without spending", () => {
    expect(questionsOf(base())).toMatchObject({ share: 1, cardBills: [], items: [], total: 0 });
    expect(questionsOf([]).share).toBeNull();
    expect(questionsOf([known(-800, "Oma tili", "transfer", { isTransfer: true })]).share).toBeNull();
  });

  it("takes Muut menot to the cent, and neither money in nor a card bill moves it", () => {
    expect(questionsOf([...base(), unknownOut(100, "Kioski Oy")])).toMatchObject({ share: 1 - 10000 / 90000 });
    // money in is asked about, but the measure is of spending
    expect(questionsOf([...base(), unknownIn(50, "Kaveri")])).toMatchObject({ share: 1 });
    // a bill's purchases are a gap of the data, said in a sentence of its own
    expect(questionsOf([...base(), known(-200, "Visa", "card_bill")])).toMatchObject({ cardBills: [{ cents: 20000, reason: "not_connected" }], share: 1 });
  });

  it("takes the three together, and a transfer and a pending row move nothing", () => {
    const rows = [...base(), unknownOut(100, "Kioski Oy"), unknownIn(50, "Kaveri"), known(-200, "Visa", "card_bill")];
    const q = questionsOf(rows);
    expect(q.cardBills).toMatchObject([{ cents: 20000 }]);
    expect(q.share).toBe(1 - 10000 / 90000);
    expect(questionsOf([...rows, known(-500, "Oma tili", "transfer", { isTransfer: true })])).toEqual(q);
    // money in waits for its booking; a pending payment is spending here as on every page, and asks no question yet
    expect(questionsOf([...rows, unknownIn(700, "Odottaa Oy", { status: "pending" })])).toEqual(q);
    const waiting = questionsOf([...rows, unknownOut(900, "Odottaa Oy", { status: "pending" })]);
    expect(waiting.share).toBe(1 - 100000 / 180000);
    expect(waiting.items).toEqual(q.items);
  });

  it("nets a payment that came back: whole it moves nothing, in part it counts what was left", () => {
    const back = (euros: number) => tx({ bookingDate: "2026-09-28", amountCents: eur(euros), merchant: "Kioski Oy" });
    const whole = questionsOf([...base(), unknownOut(100, "Kioski Oy"), back(100)]);
    expect(whole).toMatchObject({ share: 1, items: [] });
    const part = questionsOf([...base(), unknownOut(100, "Kioski Oy"), back(40)]);
    expect(part).toMatchObject({ share: 1 - 6000 / 86000, items: [{ kind: "payee_out", merchant: "Kioski Oy", cents: 6000, count: 1 }] });
  });

  it("reads the twelve complete months up to the period's end: the month still running is not one", () => {
    const old = unknownOut(100, "Kioski Oy", { bookingDate: "2025-09-30" });
    const edge = unknownOut(30, "Kioski Oy", { bookingDate: "2025-10-01" });
    const running = unknownOut(50, "Kioski Oy", { bookingDate: "2026-10-05" });
    expect(questionsOf([...base(), old]).share).toBe(1);
    expect(questionsOf([...base(), running]).share).toBe(1);
    expect(questionsOf([...base(), edge]).share).toBe(1 - 3000 / 83000);
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
    const items = questionsOf(rows).items as { rowIds?: string[] }[];
    expect(items.map(({ rowIds: _ids, ...rest }) => rest)).toEqual([
      { kind: "payee_out", merchant: "Delta Oy", cents: 9000, count: 1, lastDate: "2026-09-21" },
      { kind: "payee_out", merchant: "Gamma Oy", cents: 4000, count: 2, lastDate: "2026-09-02" },
      { kind: "payee_in", merchant: "Alfa Oy", cents: 2000, count: 1, lastDate: "2026-09-22" },
      { kind: "payee_out", merchant: "Alfa Oy", cents: 2000, count: 1, lastDate: "2026-09-21" },
      { kind: "payee_out", merchant: "Beta Oy", cents: 2000, count: 1, lastDate: "2026-09-21" },
    ]);
    // each question names exactly the rows it counts, for Tarkistettavat to show
    for (const q of items) expect((q as { rowIds?: string[] }).rowIds, (q as { merchant: string }).merchant).toHaveLength((q as { count: number }).count);
  });

  it("gives the unknown payee no row but lowers the share", () => {
    const q = questionsOf([...base(), unknownOut(100, "Tuntematon")]);
    expect(q.items).toEqual([]);
    expect(q.total).toBe(0);
    expect(q.share).toBe(1 - 10000 / 90000);
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
      tx({ bookingDate: `${addMonths("2026-10", i - 5)}-05`, amountCents: -41200, description: "LAINAN LYHENNYS 44512", counterparty: "ESIMERKKI PALVELUT OY", merchant: normalizeMerchant("ESIMERKKI PALVELUT OY", "LAINAN LYHENNYS 44512") }),
    );
    const ctx = createContext(enrichTransactions([...rows, ...base()], [checking], []), [checking], today);
    const loan = buildQuestions(ctx, range, NO_INPUTS).items.find((i) => i.kind === "loan");
    expect(loan).toMatchObject({ kind: "loan", paymentCents: 41200, cents: 12 * 41200 });
    const key = loan?.kind === "loan" ? loan.key : "";
    const marked: UserInputs = { ...NO_INPUTS, marks: [{ subject: `loan-proposal:${key}`, mark: "dismissed", markedAt: "2026-10-01T10:00:00" }] };
    expect(buildQuestions(ctx, range, marked).items.some((i) => i.kind === "loan")).toBe(false);
  });

  it("names the proposals it is given and none it finds itself", () => {
    const rows: Transaction[] = Array.from({ length: 6 }, (_, i) =>
      tx({ bookingDate: `${addMonths("2026-10", i - 5)}-05`, amountCents: -41200, description: "LAINAN LYHENNYS 44512", counterparty: "ESIMERKKI PALVELUT OY", merchant: normalizeMerchant("ESIMERKKI PALVELUT OY", "LAINAN LYHENNYS 44512") }),
    );
    const ctx = createContext(enrichTransactions([...rows, ...base()], [checking], []), [checking], today);
    expect(buildQuestions(ctx, range, NO_INPUTS, []).items.some((i) => i.kind === "loan")).toBe(false);
    expect(buildQuestions(ctx, range, NO_INPUTS).items.some((i) => i.kind === "loan")).toBe(true);
  });

  it("differs by scope where a row is on a member's own account", () => {
    const joint = [...base(), unknownOut(100, "Kioski Oy")];
    const second: Account = { id: "acc-2", name: "Oma", iban: null, currency: "EUR", type: "checking" };
    const own = buildQuestions(createContext(joint, [checking], today), range, NO_INPUTS);
    const household = buildQuestions(createContext([...joint, unknownOut(300, "Oma Kauppa", { accountId: "acc-2" })], [checking, second], today), range, NO_INPUTS);
    expect(own.share).toBe(1 - 10000 / 90000);
    expect(household.share).toBe(1 - 40000 / 120000);
    expect(names(household.items)).toEqual(["Oma Kauppa", "Kioski Oy"]);
    expect(own.share).not.toBe(household.share);
  });
});

describe("the dashboard", () => {
  it("carries the answer", () => {
    const rows = [...base(), unknownOut(100, "Kioski Oy")];
    // without the row ids, which are Tarkistettavat's
    expect(buildDashboard(createContext(rows, [checking], today), range).questions).toEqual(withoutRowIds(questionsOf(rows)));
  });
});
