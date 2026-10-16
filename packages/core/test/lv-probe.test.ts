/**
 * Probe: page fixes from the live review, checked where the page reads them: the window's card row and Laskut's lists
 * (cashAhead, ctx.recurring), the data quality report, the settlement of a joint account, and the ops wait helper. Each
 * item has its near miss. Made-up names, accounts and sums only.
 */
import { describe, expect, it } from "vitest";
import * as opsElapsed from "../../../apps/web/src/components/ops/ops-elapsed.ts";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { dataQualityReport } from "../src/analysis/data-quality.ts";
import { addDays, addMonths } from "../src/dates.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { trace, type TraceRow } from "../src/money-trace.ts";
import { type Settlement, settlement } from "../src/settlement.ts";
import { type Account, type BalanceInput, type ExpectedBill, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { dayNumber } from "../src/dates.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-09";
const own: Account = { id: "own", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const bal = (a: Pick<Account, "id" | "name" | "type">, balanceCents: number | null, extra: Partial<BalanceInput> = {}): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents, ownerName: null, balanceAt: `${TODAY}T06:00:00Z`, ...extra });
const everyDay = (from: IsoDate, until: IsoDate, row: (day: IsoDate) => Transaction[]): Transaction[] => {
  const rows: Transaction[] = [];
  for (let d = from; d <= until; d = addDays(d, 1)) rows.push(...row(d));
  return rows;
};
/** Both legs of an own transfer, as the pipeline leaves them. */
const move = (from: Account, to: Account, bookingDate: IsoDate, cents: number): Transaction[] => [
  tx({ accountId: from.id, bookingDate, amountCents: -cents, merchant: "Oma siirto", category: "transfer", categorySource: "transfer", isTransfer: true, counterpartyIban: to.iban }),
  tx({ accountId: to.id, bookingDate, amountCents: cents, merchant: "Oma siirto", category: "transfer", categorySource: "transfer", isTransfer: true, counterpartyIban: from.iban }),
];
const groceries = (until: IsoDate) => everyDay("2026-03-01", until, (d) => [tx({ accountId: "own", bookingDate: d, amountCents: -2000, merchant: "Ruokakauppa", category: "groceries" })]);
/** A connected card: ten euros a day on it, its bill paid from the own account on the 20th since March. */
const cardRows = (card: Account) => [
  ...everyDay("2026-03-01", TODAY, (d) => [tx({ accountId: card.id, bookingDate: d, amountCents: -1000, merchant: "Kahvila", category: "restaurants" })]),
  ...["03", "04", "05", "06", "07", "08", "09"].flatMap((m, i) => move(own, card, `2026-${m}-20`, [30_000, 31_000, 29_000, 30_500, 29_500, 30_000, 30_000][i]!)),
];

describe("LV1: a card's bill is named by the card, without the bank's type in brackets", () => {
  const cardRowName = (name: string) => {
    const card: Account = { id: "card", name, iban: null, currency: "EUR", type: "credit_card" };
    const d = cashAhead(createContext([...groceries(TODAY), ...cardRows(card)], [own, card], TODAY), [bal(own, 200_000), bal(card, -41_200)], NO_INPUTS);
    return [...d.rows, ...d.upcoming].filter((r) => r.source === "card").map((r) => r.name);
  };

  it.each([
    ["Esimerkki Gold (credit)", "Esimerkki Gold"],
    ["Esimerkki Gold (Credit card)", "Esimerkki Gold"],
    ["Esimerkki Visa (debit)", "Esimerkki Visa"],
    ["Esimerkki Gold  ( credit )", "Esimerkki Gold"],
  ])("%s is printed as %s in Erääntyvät maksut", (name, shown) => {
    const names = cardRowName(name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set([shown]));
  });

  it.each([
    // the owner's name of a shared card is no type word, and a name that is only the type is not left empty
    ["Esimerkki Gold (Eero)", "Esimerkki Gold (Eero)"],
    ["(credit)", "(credit)"],
    ["Credit Esimerkki", "Credit Esimerkki"],
  ])("near miss: %s stays %s", (name, shown) => {
    expect(new Set(cardRowName(name))).toEqual(new Set([shown]));
  });
});

describe("LV2: card bills without purchases tell two cards of one issuer apart", () => {
  const RANGE = { from: "2025-11-01", to: "2026-10-31" };
  const bill = (date: IsoDate, cents: number) =>
    tx({ accountId: "own", bookingDate: date, amountCents: -cents, counterparty: "ESIMERKKIPANKKI OYJ", description: "LUOTTOKORTTI", merchant: normalizeMerchant("ESIMERKKIPANKKI OYJ", null), category: "card_bill", categorySource: "rule" });
  /** A connected card of the issuer whose rows begin in June: its bills before June are of the bank's history. */
  const visa: Account = { id: "visa", name: "Esimerkkipankki Visa", bankName: "Esimerkkipankki Visa", bank: "Esimerkkipankki", iban: null, currency: "EUR", type: "credit_card" };
  const visaRows = everyDay("2026-06-01", TODAY, (d) => (d.endsWith("-03") ? [tx({ accountId: "visa", bookingDate: d, amountCents: -4500, merchant: "Kirjakauppa", category: "shopping" })] : []));
  /** The label the page prints for a row. */
  const label = (m: { issuer: string }): string => (m as { label?: string }).label ?? m.issuer; // API: adjust name
  const rowsOf = (txs: Transaction[], balances: BalanceInput[]) => {
    const ctx = createContext([...groceries(TODAY), ...txs], [own, visa], TODAY);
    return dataQualityReport(ctx, RANGE, balances).signals.find((s) => s.id === "card_bills")?.cardPurchases ?? [];
  };

  it("bills before the connected card's history and bills of a second, unconnected card get two different names, the known one with its last four digits", () => {
    const rows = rowsOf([...["2026-03-15", "2026-04-15", "2026-05-15"].map((d) => bill(d, 21_000)), ...["2026-07-15", "2026-08-15", "2026-09-15"].map((d) => bill(d, 9_000)), ...visaRows], [bal(own, 100_000), bal(visa, -4500, { cardMask: "•••• 1234" })]);
    expect(rows).toHaveLength(2);
    const labels = rows.map(label);
    expect(new Set(labels).size).toBe(2);
    const early = rows.find((m) => m.reason === "before_history")!;
    expect(label(early)).toMatch(/ ·· 1234$/);
    expect(label(early).startsWith(early.issuer)).toBe(true);
    // the mask is cut to its four digits, never printed with the bank's dots
    for (const l of labels) expect(l).not.toContain("•");
  });

  it("near miss: one row of the issuer keeps its plain name", () => {
    const rows = rowsOf([...["2026-03-15", "2026-04-15", "2026-05-15"].map((d) => bill(d, 21_000)), ...visaRows], [bal(own, 100_000), bal(visa, -4500, { cardMask: "•••• 1234" })]);
    expect(rows).toHaveLength(1);
    expect(label(rows[0]!)).toBe(rows[0]!.issuer);
  });

  it("near miss: two rows and no mask known still read differently, by the card's product name", () => {
    const rows = rowsOf([...["2026-03-15", "2026-04-15", "2026-05-15"].map((d) => bill(d, 21_000)), ...["2026-07-15", "2026-08-15", "2026-09-15"].map((d) => bill(d, 9_000)), ...visaRows], [bal(own, 100_000), bal(visa, -4500)]);
    expect(new Set(rows.map(label)).size).toBe(2);
  });

  it("the sums do not move: the rows still add up to the signal", () => {
    const ctx = createContext([...["2026-03-15", "2026-07-15"].map((d) => bill(d, 10_000)), ...visaRows, ...groceries(TODAY)], [own, visa], TODAY);
    const signal = dataQualityReport(ctx, RANGE, [bal(visa, -4500, { cardMask: "•••• 1234" })]).signals.find((s) => s.id === "card_bills")!;
    expect(signal.cardPurchases!.reduce((s, m) => s + m.cents, 0)).toBe(signal.cents);
  });
});

describe("LV7: the ops queue's wait is counted by the server's clock", () => {
  // API: adjust name. waitedMs(requestedAt, serverNow, receivedAt, now): the server's now when the answer came, plus the
  // browser's time since then, less the request time.
  const waitedMs = (opsElapsed as Record<string, unknown>).waitedMs as ((requestedAt: string, serverNow: string, receivedAt: number, now: number) => number) | undefined;
  const at = Date.parse("2026-10-09T09:00:00Z");

  it("the browser's clock ten minutes ahead shows the server's three minutes", () => {
    expect(typeof waitedMs).toBe("function");
    const browser = at + 10 * 60_000;
    expect(waitedMs!("2026-10-09T09:00:00Z", "2026-10-09T09:03:00Z", browser, browser)).toBe(180_000);
    expect(opsElapsed.elapsed(waitedMs!("2026-10-09T09:00:00Z", "2026-10-09T09:03:00Z", browser, browser + 5000))).toBe("3 min 5 s");
  });

  it("a browser behind the server shows no zero", () => {
    const browser = at - 30 * 60_000;
    expect(waitedMs!("2026-10-09T09:00:00Z", "2026-10-09T09:02:30Z", browser, browser + 1000)).toBe(151_000);
  });

  it("near miss: equal clocks read as before", () => {
    const browser = at + 120_000;
    expect(waitedMs!("2026-10-09T09:00:00Z", "2026-10-09T09:02:00Z", browser, browser + 15_000)).toBe(135_000);
  });
});

describe("LV8: a joint account's shares in Raportit", () => {
  const POOL = "iban-yhteinen-tili";
  const USER = "u:1";
  /** The holder of the account who has no login: the bank names them, the app has no user. */
  const OTHER = "u:";
  const row = (label: string, date: string, cents: number, extra: Partial<TraceRow> = {}): TraceRow => ({ key: `${dayNumber(date)}|${cents}|${label}|00000`, ids: [label], day: dayNumber(date), cents, ...extra });
  const rows: TraceRow[] = [
    row("in-u1", "2026-09-01", 100_000, { from: { owner: USER, kind: "own" } }),
    row("in-other", "2026-09-01", 100_000, { from: { owner: OTHER, kind: "own" } }),
    row("food", "2026-09-10", -40_000),
    row("power", "2026-09-20", -12_000),
  ];
  const run = (users: { owner: string; weight: number }[]): Settlement => {
    const t = trace(rows, 0, Math.min(...rows.map((r) => r.day)));
    return settlement("2026-09", { key: POOL, trace: t, answers: [], users }, [], new Set([USER]), [], new Map(), "2026-10-05");
  };
  const ownerOf = (s: Settlement, owner: string) => s.members.find((m) => m.owner === owner);

  it("two holders and an equal split: both shares are known, none reads Ei tiedossa", () => {
    const s = run([{ owner: USER, weight: 1 }, { owner: OTHER, weight: 1 }]);
    expect(ownerOf(s, USER)?.owed).toBe(26_000);
    // API: adjust name. The other holder's share is known: a member's row, or at least no unknown share
    expect(s.unknownOwedBy.filter((e) => e.owner === OTHER)).toEqual([]);
    expect(ownerOf(s, OTHER)?.owed).toBe(26_000);
    expect(s.unknownOwed).toBe(0);
  });

  it("near miss: an unequal split keeps the honest unknown, once", () => {
    const s = run([{ owner: USER, weight: 2 }, { owner: OTHER, weight: 1 }]);
    expect(s.unknownOwedBy.length).toBeLessThanOrEqual(1);
    expect(s.unknownOwedBy.length + s.unknownPaidBy.filter((e) => e.owner === OTHER).length).toBeGreaterThan(0);
  });

  it("the month still balances: what was owed and paid both make the net cost", () => {
    const s = run([{ owner: USER, weight: 1 }, { owner: OTHER, weight: 1 }]);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(s.members.map((m) => m.owed)) + s.unknownOwed).toBe(s.netCost);
    expect(sum(s.members.map((m) => m.paid)) + s.unknownPaid).toBe(s.netCost);
  });
});

// Built against claude/sharp-edison-t55z1g at KB3 (62b5c14b); core output, plus the ops helper of apps/web.
// Expected red until the task lands: LV1 card row names, LV2 labels, LV5 card issuer/lender in contracts, LV7 waitedMs,
// LV8 the other holder's equal share. LV1 may move to the server's account mapping if the builder strips it there.
