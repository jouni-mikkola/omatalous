import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichIsland, enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { enrichTransactionsReference } from "./pipeline-reference.ts";

/** A row as the server stores it: with the payment's reference. */
type Stored = Transaction & { reference: string | null };

interface Party {
  counterparty?: string;
  iban?: string;
  reference?: string;
  /** The text of the row; a payment with a reference shows the reference. */
  description?: string;
  account?: string;
}

const CHK: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const CARD: Account = { id: "card", name: "Esimerkkipankki Gold", iban: null, currency: "EUR", type: "credit_card" };

/** Where the card is paid: the bank's collection account and the card's reference. Nothing in it says "card". */
const BANK: Party = { counterparty: "ESIMERKKIPANKKI OYJ", iban: "FI0000000000000009", reference: "10016" };
const PERSON: Party = { counterparty: "MEIKALAINEN MATTI", iban: "FI0000000000000017", description: "KIITOS" };
const SHOP: Party = { counterparty: "KAUPPA ESIMERKKI OY", iban: "FI0000000000000025", reference: "40040" };
const onCard = (description: string): Party => ({ description, account: "card" });

function row(id: string, date: string, cents: number, party: Party): Stored {
  const counterparty = party.counterparty ?? null;
  const description = party.description ?? party.reference ?? null;
  return {
    id,
    accountId: party.account ?? "chk",
    bookingDate: date,
    amountCents: cents,
    currency: "EUR",
    status: "booked",
    counterparty,
    counterpartyIban: party.iban ?? null,
    description,
    reference: party.reference ?? null,
    mcc: null,
    merchant: normalizeMerchant(counterparty, description),
    category: cents >= 0 ? "income" : "other",
    categorySource: "default",
    isTransfer: false,
  };
}

const byDateAndId = (a: Stored, b: Stored) => a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id);

/** The rows as a database holds them after a full run, which reads them by date. */
function stored(rows: readonly Stored[], accounts: readonly Account[]): Stored[] {
  const sorted = [...rows].sort(byDateAndId);
  const changed = new Map(enrichTransactions(sorted, accounts, []).map((t) => [t.id, t as Stored]));
  return sorted.map((t) => changed.get(t.id) ?? t);
}

/** Each row's category after a full run; a transfer's is "transfer". */
const categories = (rows: readonly Stored[], accounts: readonly Account[]) => Object.fromEntries(stored(rows, accounts).map((t) => [t.id, t.category]));

/** The card's rows begin on 10.9. and its bill of 300 is paid on 14.9. */
const connected = [
  row("purchase", "2026-09-10", -4200, onCard("KAHVILA ESIMERKKI HELSINKI")),
  row("pay", "2026-09-14", -30000, BANK),
  row("paid", "2026-09-15", 30000, onCard("SUORITUS 14.09")),
];

describe("a card's payment channel is learned from paired rows", () => {
  it("a payment to the channel from before the card's rows is a card bill, and counted as spending", () => {
    const rows = [row("june", "2026-06-03", -50000, BANK), ...connected, row("soon", "2026-09-25", -12000, BANK)];
    const after = stored(rows, [CHK, CARD]);
    const of = (id: string) => after.find((t) => t.id === id)!;
    expect(of("pay").isTransfer && of("paid").isTransfer).toBe(true);
    // what the `card_bills` data quality signal adds up: the category, on a row that is no transfer
    expect(of("june")).toMatchObject({ category: "card_bill", categorySource: "rule", isTransfer: false });
    // 15 days after the card's first row: the purchases this pays for are older than the card's rows
    expect(of("soon")).toMatchObject({ category: "card_bill", isTransfer: false });
  });

  it("an unpaired payment to the channel after the card's rows began is a transfer", () => {
    const rows = [...connected, row("later", "2026-11-14", -45000, BANK)];
    expect(categories(rows, [CHK, CARD])).toMatchObject({ pay: "transfer", paid: "transfer", later: "transfer" });
  });

  it("a category the user set on a payment to the channel stays", () => {
    const june: Stored = { ...row("june", "2026-06-03", -50000, BANK), category: "home", categorySource: "user" };
    expect(categories([june, ...connected], [CHK, CARD]).june).toBe("home");
  });

  it("one pair with a person or with a shop teaches no channel", () => {
    const others = [
      row("person-early", "2026-06-01", -10000, PERSON),
      row("shop-early", "2026-07-05", -9000, SHOP),
      // the same sum as the money that reached the card, a day after it: the person's payment came first and took the pair
      row("shop-same", "2026-09-21", -25000, { counterparty: "TOINEN KAUPPA OY", iban: "FI0000000000000041", reference: "50051" }),
    ];
    const chance = [
      row("person", "2026-09-19", -25000, PERSON),
      row("card-in", "2026-09-20", 25000, onCard("SUORITUS 19.09")),
      row("shop", "2026-10-05", -18000, SHOP),
      row("card-in-2", "2026-10-05", 18000, onCard("SUORITUS 05.10")),
    ];
    const all = categories([...others, ...connected, ...chance], [CHK, CARD]);
    // the pairs themselves are found as before
    expect(all).toMatchObject({ person: "transfer", "card-in": "transfer", shop: "transfer", "card-in-2": "transfer" });
    const alone = categories(others, [CHK, CARD]);
    for (const t of others) expect(`${t.id} ${all[t.id]}`).toBe(`${t.id} ${alone[t.id]}`);
  });

  it("a payee that paired twice is a channel, whoever it is", () => {
    const rows = [
      row("early", "2026-06-01", -10000, PERSON),
      ...connected,
      row("first", "2026-09-19", -25000, PERSON),
      row("first-in", "2026-09-20", 25000, onCard("SUORITUS 19.09")),
      row("second", "2026-10-19", -26000, PERSON),
      row("second-in", "2026-10-20", 26000, onCard("SUORITUS 19.10")),
    ];
    expect(categories(rows, [CHK, CARD]).early).toBe("card_bill");
  });

  it("a household with no connected card: every row as before", () => {
    const rows = [
      row("june", "2026-06-03", -50000, BANK),
      row("pay", "2026-09-14", -30000, BANK),
      row("person", "2026-09-19", -25000, PERSON),
      row("shop", "2026-10-05", -18000, SHOP),
      row("in", "2026-09-15", 30000, { counterparty: "ESIMERKKI OY", description: "HYVITYS" }),
    ];
    const savings: Account = { id: "sav", name: "Säästötili", iban: "FI1410093000123458", currency: "EUR", type: "savings" };
    expect(enrichTransactions(rows, [CHK, savings], [])).toEqual(enrichTransactionsReference(rows, [CHK, savings], [], new Map()));
  });
});

describe("one reference is one contract", () => {
  // a finance company that both lends and issues cards, and a card of the same issuer
  const issuerCard: Account = { id: "card", name: "Resurs Bank Gold", iban: null, currency: "EUR", type: "credit_card" };
  const lender = (reference?: string): Party => ({ counterparty: "RESURS BANK AB", reference });
  /** Four equal instalments, one large extra payment, two equal instalments at a new level. */
  const loan = (reference?: string) =>
    [-40000, -40000, -40000, -40000, -250000, -45000, -45000].map((cents, i) => row(`l${i + 1}`, `2026-0${i + 2}-05`, cents, lender(reference)));
  const cardPaid = [
    row("purchase", "2026-08-01", -4200, onCard("KAHVILA ESIMERKKI HELSINKI")),
    row("pay", "2026-09-14", -30000, { counterparty: "RESURS BANK AB", iban: "FI0000000000000033", reference: "10016" }),
    row("paid", "2026-09-15", 30000, onCard("SUORITUS 14.09")),
  ];
  const ids = ["l1", "l2", "l3", "l4", "l5", "l6", "l7"];
  const pick = (all: Record<string, string>) => ids.map((id) => all[id]);

  it("seven payments under one reference, four of them equal, are seven loan rows, and the card's payment still pairs", () => {
    const all = categories([...loan("20028"), ...cardPaid], [CHK, issuerCard]);
    expect(pick(all)).toEqual(Array(7).fill("loans"));
    expect(all).toMatchObject({ pay: "transfer", paid: "transfer" });
    // the reference decides it, with no card's channel known either
    expect(pick(categories(loan("20028"), [CHK, issuerCard]))).toEqual(Array(7).fill("loans"));
  });

  it("without a reference the amounts decide row by row, and only the card's channel is its bill", () => {
    const bills = ["loans", "loans", "loans", "loans", "card_bill", "card_bill", "card_bill"];
    expect(pick(categories([...loan(), ...cardPaid], [CHK, issuerCard]))).toEqual(bills);
    // no channel is known: a bill whose text names the card is the card's, as before
    expect(pick(categories(loan(), [CHK, issuerCard]))).toEqual(["loans", "loans", "loans", "loans", "transfer", "transfer", "transfer"]);
  });

  it("the payments to the account that paid credit out are a lender's contract: its bills are no transfers", () => {
    const account = "FI0000000000000058";
    const payout = (iban?: string) => row("payout", "2026-01-15", 200000, { counterparty: "RESURS BANK AB", iban, description: "LUOTON NOSTO" });
    const all = categories([payout(account), ...loan().map((t) => ({ ...t, counterpartyIban: account }))], [CHK, issuerCard]);
    expect(all.payout).toBe("credit_draw");
    expect(pick(all)).toEqual(["loans", "loans", "loans", "loans", "card_bill", "card_bill", "card_bill"]);
    // the issuer's name alone ties no payment to the payout: a card's own credit moved to the account carries it too
    const byName = categories([payout(), ...loan()], [CHK, issuerCard]);
    expect(pick(byName)).toEqual(["loans", "loans", "loans", "loans", "transfer", "transfer", "transfer"]);
  });
});

describe("a loan's reference is no card's channel", () => {
  const issuerCard: Account = { id: "card", name: "Resurs Bank Gold", iban: null, currency: "EUR", type: "credit_card" };
  const finance: Party = { counterparty: "RESURS BANK AB", iban: "FI0000000000000033" };
  const monthly = (prefix: string, cents: number, count: number, party: Party) =>
    Array.from({ length: count }, (_, i) => {
      const month = String(i + 1).padStart(2, "0");
      return row(`${prefix}${month}`, `2026-${month}-05`, cents, party);
    });
  // seven instalments of one loan at a finance company that also issues the connected card
  const instalments = monthly("l", -15000, 7, { ...finance, reference: "20028" });
  const purchase = row("purchase", "2026-01-10", -4200, onCard("KAHVILA ESIMERKKI HELSINKI"));
  const ids = instalments.map((t) => t.id);
  const pick = (all: Record<string, string>) => ids.map((id) => all[id]);

  it("one instalment equal to a payment to the card does not turn the loan into card bills and transfers", () => {
    const rows = [...instalments, purchase, row("paid", "2026-06-06", 15000, onCard("SUORITUS 05.06"))];
    const all = categories(rows, [CHK, issuerCard]);
    // the instalment of 5.6. pairs with the payment, as pairing always did; the other six are loans
    expect(pick(all)).toEqual(["loans", "loans", "loans", "loans", "loans", "transfer", "loans"]);
    expect(all.paid).toBe("transfer");
  });

  it("twelve mortgage payments to the bank whose card was once paid the same sum stay loans", () => {
    const mortgage = monthly("m", -85000, 12, { ...BANK, reference: "30031", description: "LAINAN LYHENNYS" });
    const card = [row("purchase", "2026-09-10", -4200, onCard("KAHVILA ESIMERKKI HELSINKI")), row("paid", "2026-11-06", 85000, onCard("SUORITUS 05.11"))];
    const all = categories([...mortgage, ...card], [CHK, CARD]);
    expect(mortgage.map((t) => all[t.id])).toEqual(mortgage.map((t) => (t.id === "m11" ? "transfer" : "loans")));
  });

  it("the card's own payment, found first, is the pair and the loan is untouched", () => {
    const own = row("bill", "2026-06-05", -15000, { ...finance, reference: "10016" });
    const rows = [...instalments, purchase, own, row("paid", "2026-06-06", 15000, onCard("SUORITUS 05.06"))];
    const all = categories(rows, [CHK, issuerCard]);
    expect(pick(all)).toEqual(Array(7).fill("loans"));
    expect(all).toMatchObject({ bill: "transfer", paid: "transfer" });
  });

  it("with no payment to the card of the same sum nothing pairs", () => {
    const rows = [...instalments, purchase, row("paid", "2026-06-06", 14900, onCard("SUORITUS 05.06"))];
    expect(pick(categories(rows, [CHK, issuerCard]))).toEqual(Array(7).fill("loans"));
  });

  it("a card paid one fixed sum every month teaches no channel: its payments are what they were before channels", () => {
    // six payments of 300 to the bank, the card's rows begin on 10.9.; the one of 14.9. pairs with the card's payment
    const payments = ["06-14", "07-14", "08-14", "09-14", "10-14", "11-14"].map((day, i) => row(`p${i + 1}`, `2026-${day}`, -30000, BANK));
    const rows = [...payments, row("purchase", "2026-09-10", -4200, onCard("KAHVILA ESIMERKKI HELSINKI")), row("paid", "2026-09-15", 30000, onCard("SUORITUS 14.09"))];
    const all = categories(rows, [CHK, CARD]);
    // the pair is a transfer; the rest are not recognised as the card's, so they are `other` as before
    expect(payments.map((t) => all[t.id])).toEqual(["other", "other", "other", "transfer", "other", "other"]);
    expect(all.paid).toBe("transfer");
  });
});

describe("the incremental path and a card's channel", () => {
  const island = (rows: readonly Stored[], merchant: string, before: [string, Pick<Transaction, "category" | "categorySource">][]) =>
    enrichIsland({
      rows: rows.filter((t) => t.merchant === merchant).sort(byDateAndId),
      before: new Map(before),
      accounts: [CHK, CARD],
      rules: [],
      oldRules: [],
      industries: new Map(),
      outsideMatches: [],
    });

  it("an island with a pair that teaches a new channel forces the full run", () => {
    // the user had set the paying row by hand, so it paired with nothing and taught nothing
    const byHand = { category: "other", categorySource: "user" } as const;
    const before = stored([row("june", "2026-06-03", -50000, BANK), ...connected.map((t) => (t.id === "pay" ? { ...t, ...byHand } : t))], [CHK, CARD]);
    expect(before.find((t) => t.id === "june")!.category).toBe("other");
    // the user takes the choice back
    const after = before.map((t) => (t.id === "pay" ? { ...t, category: "other", categorySource: "default" as const } : t));
    expect(island(after, "Esimerkkipankki", [["pay", byHand]]).ok).toBe(false);
    expect(categories(after, [CHK, CARD])).toMatchObject({ pay: "transfer", june: "card_bill" });
  });

  it("a row that a channel learned from another name of the payee decides is left to the full run", () => {
    const bare = { ...BANK, counterparty: "ESIMERKKIPANKKI" };
    const rows = stored([row("june", "2026-06-03", -50000, bare), row("note", "2026-06-20", -1500, { counterparty: "ESIMERKKIPANKKI", description: "KOPIOT" }), ...connected], [CHK, CARD]);
    const note = rows.find((t) => t.id === "note")!;
    expect(rows.find((t) => t.id === "june")).toMatchObject({ merchant: "Esimerkkipankki", category: "card_bill" });
    const after = rows.map((t) => (t.id === "note" ? { ...t, category: "home", categorySource: "user" as const } : t));
    expect(island(after, "Esimerkkipankki", [["note", { category: note.category, categorySource: note.categorySource }]]).ok).toBe(false);
  });
});
