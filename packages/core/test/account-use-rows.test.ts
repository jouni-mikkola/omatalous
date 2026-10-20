/**
 * A member's own view of rows (`applyUse`): a joint account at the viewer's part, nothing of an account somebody else
 * uses alone, and what the money between the two becomes. The two own views of a joint account add up to the account.
 */
import { describe, expect, it } from "vitest";
import { applyUse, NONE, partOf, WHOLE } from "../src/account-use.ts";
import { createContext } from "../src/analysis/context.ts";
import { totalsOf } from "../src/analysis/flows.ts";
import type { Account, AccountUse, Part, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const MATTI = "MEIKALAINEN MATTI";
const ELISA = "KORHONEN ELISA";
const TODAY = "2026-10-09";

const account = (id: string, holder: string, extra: Partial<Account> = {}): Account => ({ id, name: id, holder, iban: null, currency: "EUR", type: "checking", ...extra });
const his = account("his", MATTI);
const hers = account("hers", ELISA);
const joint = account("joint", `${MATTI}, ${ELISA}`);

/** 600 and 400 euros a month: three fifths and two fifths. */
const use: AccountUse = { users: [{ userId: "u-1", label: "Matti", weight: 60000 }, { userId: "u-2", label: "Elisa", weight: 40000 }], source: "said" };
const HALF: Part = { from: 0, to: 1, of: 2 };

const parts = (...entries: [Account, Part][]) => new Map(entries.map(([a, part]) => [a.id, part]));
const on = (a: Account, bookingDate: string, euros: number, extra: Partial<Transaction> = {}) => tx({ accountId: a.id, bookingDate, amountCents: Math.round(euros * 100), ...extra });
/** A leg of a transfer between two accounts of one member, as the categorisation stores it. */
const moved = (a: Account, bookingDate: string, euros: number) => on(a, bookingDate, euros, { category: "transfer", categorySource: "transfer", isTransfer: true });
const byCategory = (rows: readonly Transaction[]) => {
  const sums: Record<string, number> = {};
  for (const t of rows) sums[t.category] = (sums[t.category] ?? 0) + t.amountCents;
  return sums;
};
const totals = (rows: readonly Transaction[], accounts: readonly Account[]) => totalsOf(createContext(rows, accounts, TODAY).txs.map((t) => t.flows));
const pick = (rows: readonly Transaction[], id: string) => rows.find((t) => t.id === id);

describe("the rows of a joint account in a member's own view", () => {
  const month = [
    on(joint, "2026-09-01", 2500.01, { category: "salary", categorySource: "rule" }),
    on(joint, "2026-09-02", -733.33, { category: "housing", categorySource: "rule" }),
    on(joint, "2026-09-03", -84.37, { category: "groceries", categorySource: "mcc" }),
    on(joint, "2026-09-05", -12.01, { category: "groceries", categorySource: "mcc" }),
    // a refund: money back into the category it left
    on(joint, "2026-09-08", 15.99, { category: "groceries", categorySource: "mcc" }),
    on(joint, "2026-09-11", -0.01, { category: "bank_fees", categorySource: "rule" }),
    on(joint, "2026-09-14", -49.9, { category: "p2p", categorySource: "rule", counterparty: "VIERAS VEIKKO" }),
  ];

  it("two users at 600 and 400 a month: their own views add up to the account, in every category and in every flow", () => {
    const [mine, yours] = ["u-1", "u-2"].map((id) => applyUse(month, [joint], parts([joint, partOf(use, id)])));
    const [a, b, whole] = [byCategory(mine!), byCategory(yours!), byCategory(month)];
    expect(Object.keys(a).sort()).toEqual(Object.keys(whole).sort());
    for (const category of Object.keys(whole)) expect(a[category]! + b[category]!).toBe(whole[category]);
    // three fifths of the salary and of the rent, to the cent
    expect(a).toMatchObject({ salary: 150001, housing: -44000 });
    expect(b).toMatchObject({ salary: 100000, housing: -29333 });

    const [flowsA, flowsB, flows] = [totals(mine!, [joint]), totals(yours!, [joint]), totals(month, [joint])];
    for (const key of ["incomeCents", "consumptionCents", "expenseCents", "netCents"] as const) expect(flowsA[key] + flowsB[key]).toBe(flows[key]);
    expect(flows.incomeCents).toBe(250001);
  });

  it("a cut row keeps the bank's amount beside the part, and a row of a whole account is the object it was", () => {
    const own = on(his, "2026-09-03", -20, { category: "groceries", categorySource: "mcc" });
    const rows = applyUse([...month, own], [his, joint], parts([his, WHOLE], [joint, partOf(use, "u-2")]));
    expect(rows).toHaveLength(month.length + 1);
    expect(pick(rows, month[1]!.id)).toEqual({ ...month[1], amountCents: -29333, wholeCents: -73333 });
    // one cent over three and two fifths: the first user's, so the second one's row counts nothing and is still a row
    expect(pick(rows, month[5]!.id)).toMatchObject({ amountCents: 0, wholeCents: -1 });
    expect(pick(rows, own.id)).toBe(own);
    expect(own.wholeCents).toBeUndefined();
  });

  it("every part whole: the same array comes back", () => {
    expect(applyUse(month, [his, joint], parts([his, WHOLE], [joint, { from: 0, to: 2, of: 2 }]))).toBe(month);
    expect(applyUse(month, [joint], new Map())).toBe(month);
    // near miss: one account at a half
    expect(applyUse(month, [his, joint], parts([his, WHOLE], [joint, HALF]))).not.toBe(month);
  });
});

describe("money a user pays into the joint account", () => {
  /** Her 400 as his categorisation stored it: money from another holder of his account. */
  const deposit = (extra: Partial<Transaction> = {}) => on(joint, "2026-09-01", 400, { category: "p2p_in", categorySource: "rule", counterparty: ELISA, ...extra });

  it("her 400 is a transfer in his view, where her own account is not seen", () => {
    const row = deposit();
    const [seen] = applyUse([row], [his, joint], parts([his, WHOLE], [joint, HALF]));
    expect(seen).toMatchObject({ category: "transfer", isTransfer: true, amountCents: 20000, wholeCents: 40000 });
    expect(totals([seen!], [his, joint]).incomeCents).toBe(0);
  });

  it("her 400 is a transfer in her view: both legs, whether she linked the joint account or sees his copy", () => {
    // his copy shared with her: her categorisation saw a payment to a person, his saw money from one
    const [paid, got] = [on(hers, "2026-09-01", -400, { category: "p2p", categorySource: "rule", counterparty: MATTI }), deposit()];
    const shared = applyUse([paid, got], [hers, joint], parts([hers, WHOLE], [joint, HALF]), new Map([[joint.id, "u-1"]]));
    expect(shared).toMatchObject([{ id: paid.id, category: "transfer", isTransfer: true, amountCents: -40000 }, { id: got.id, category: "transfer", isTransfer: true, amountCents: 20000, wholeCents: 40000 }]);
    expect(shared[0]!.wholeCents).toBeUndefined();
    expect(totals(shared, [hers, joint])).toMatchObject({ incomeCents: 0, consumptionCents: 0 });

    // her own copy: the pair was stored as a transfer already
    const [out, into] = [moved(hers, "2026-09-01", -400), moved(joint, "2026-09-01", 400)];
    const linked = applyUse([out, into], [hers, joint], parts([hers, WHOLE], [joint, HALF]));
    expect(linked[0]).toBe(out);
    expect(linked[1]).toEqual({ ...into, amountCents: 20000, wholeCents: 40000 });
  });

  it("the household view counts the account whole, and her 400 stays money from a person", () => {
    const rows = [deposit()];
    const seen = applyUse(rows, [his, joint], parts([his, WHOLE], [joint, WHOLE]));
    expect(seen).toBe(rows);
    expect(seen[0]).toMatchObject({ category: "p2p_in", isTransfer: false, amountCents: 40000 });
  });

  it("it comes from an account of hers that he linked and has no part in: still a transfer, and her account's rows are gone", () => {
    const [out, into] = [moved(hers, "2026-09-01", -400), moved(joint, "2026-09-02", 400)];
    const rows = applyUse([out, into], [his, hers, joint], parts([his, WHOLE], [hers, NONE], [joint, HALF]));
    expect(rows).toEqual([{ ...into, amountCents: 20000, wholeCents: 40000 }]);
  });

  it("near misses: money from somebody who holds no part of the account is income at the part, and a category set by hand stays", () => {
    const [stranger, set, refund] = [
      deposit({ counterparty: "VIERAS VEIKKO" }),
      deposit({ category: "sales", categorySource: "user" }),
      on(joint, "2026-09-04", 30, { category: "groceries", categorySource: "mcc", counterparty: "ESIMERKKI OY" }),
    ];
    const rows = applyUse([stranger, set, refund], [joint], parts([joint, HALF]));
    expect(rows).toMatchObject([
      { category: "p2p_in", isTransfer: false, amountCents: 20000 },
      { category: "sales", categorySource: "user", isTransfer: false, amountCents: 20000 },
      { category: "groceries", isTransfer: false, amountCents: 1500 },
    ]);
    // the money back on groceries has no payment behind it, so it is income as well: 200,00 + 200,00 + 15,00
    expect(totals(rows, [joint]).incomeCents).toBe(41500);
  });

  it("the joint account pays her own account: his part of it is money to a person", () => {
    const [out, into] = [moved(joint, "2026-09-10", -100), moved(hers, "2026-09-10", 100)];
    const rows = applyUse([out, into], [hers, joint], parts([hers, NONE], [joint, HALF]));
    expect(rows).toEqual([{ ...out, category: "p2p", categorySource: "rule", isTransfer: false, amountCents: -5000, wholeCents: -10000 }]);
  });
});

describe("an account somebody else uses alone", () => {
  // he linked her account: his categorisation paired what moves between the two as his own transfers
  const [sent, landed] = [moved(his, "2026-09-01", -300), moved(hers, "2026-09-01", 300)];
  const [back, received] = [moved(hers, "2026-09-12", -80), moved(his, "2026-09-13", 80)];
  const hersOnly = on(hers, "2026-09-05", -20, { category: "groceries", categorySource: "mcc" });
  const hisOnly = on(his, "2026-09-06", -50, { category: "groceries", categorySource: "mcc" });
  const rows = [sent, landed, hersOnly, hisOnly, back, received];
  const view = parts([his, WHOLE], [hers, NONE]);

  it("his 300 to it is money to a person, her 80 back is money from one, and the account's own rows are in no figure of his", () => {
    const seen = applyUse(rows, [his, hers], view);
    expect(seen.map((t) => t.id)).toEqual([sent.id, hisOnly.id, received.id]);
    expect(pick(seen, sent.id)).toEqual({ ...sent, category: "p2p", categorySource: "rule", isTransfer: false });
    expect(pick(seen, received.id)).toEqual({ ...received, category: "p2p_in", categorySource: "rule", isTransfer: false });
    expect(pick(seen, hisOnly.id)).toBe(hisOnly);
    // 300 to her and 50 of groceries left him, 80 came: her 20 of groceries is nowhere
    expect(totals(seen, [his])).toMatchObject({ consumptionCents: 35000, incomeCents: 8000 });
  });

  it("the row names her account by its number and nothing pairs with it: still money to a person", () => {
    const withIban = account("hers", ELISA, { iban: "FI21 1234 5600 0007 85" });
    const named = { ...moved(his, "2026-08-01", -45), counterpartyIban: "FI2112345600000785" };
    expect(applyUse([named], [his, withIban], view)).toEqual([{ ...named, category: "p2p", categorySource: "rule", isTransfer: false }]);
  });

  it("near misses: a category he set by hand stays, and a transfer between two accounts he uses stays a transfer", () => {
    const savings = account("savings", MATTI, { type: "savings" });
    const set = on(his, "2026-09-01", -300, { category: "housing", categorySource: "user" });
    const [saved, kept] = [moved(his, "2026-09-20", -150), moved(savings, "2026-09-20", 150)];
    const seen = applyUse([set, landed, saved, kept], [his, hers, savings], parts([his, WHOLE], [hers, NONE], [savings, WHOLE]));
    expect(seen).toEqual([set, saved, kept]);
    expect(seen[0]).toBe(set);
    expect(seen[1]).toBe(saved);
  });

  it("a refund that matched its payment is no leg of a transfer", () => {
    // her copy of the joint account, shared with him: her categorisation matched the 25 to a payment of hers
    const [paid, returned] = [on(his, "2026-09-01", -25, { category: "p2p", categorySource: "rule" }), on(joint, "2026-09-02", 25, { category: "p2p", categorySource: "match" })];
    const [seen, hersCopy] = [parts([his, WHOLE], [joint, HALF]), new Map([[joint.id, "u-2"]])];
    expect(applyUse([paid, returned], [his, joint], seen, hersCopy)).toEqual([paid, { ...returned, amountCents: 1250, wholeCents: 2500 }]);
    // near miss: the same two rows with nothing matched are one movement between the accounts of two members
    const plain = { ...returned, categorySource: "rule" as const };
    expect(applyUse([paid, plain], [his, joint], seen, hersCopy)).toMatchObject([
      { id: paid.id, category: "transfer", isTransfer: true, amountCents: -2500 },
      { id: plain.id, category: "transfer", isTransfer: true, amountCents: 1250, wholeCents: 2500 },
    ]);
  });
});

describe("what a member's categorisation decided of its own rows stays", () => {
  const savings = account("savings", MATTI, { type: "savings" });
  // 25 paid to a person who paid it back: the categorisation matched the two and kept both out of its pairing
  const paid = on(his, "2026-09-01", -25, { category: "p2p", categorySource: "rule", counterparty: "VIERAS VEIKKO" });
  const returned = on(his, "2026-09-03", 25, { category: "p2p", categorySource: "match", counterparty: "VIERAS VEIKKO" });
  // and 25 from somebody else onto his other account a day later
  const other = on(savings, "2026-09-02", 25, { category: "p2p_in", categorySource: "rule", counterparty: "TOINEN TYYPPI" });
  const rows = [paid, returned, other];

  it("no joint account, only an account shared with him that he has no part in: the rows come back as they were given", () => {
    const seen = applyUse(rows, [his, savings], new Map([["his", WHOLE], ["savings", WHOLE], ["theirs", NONE]]));
    expect(seen).toBe(rows);
    expect(totals(seen, [his, savings])).toMatchObject({ incomeCents: 2500, consumptionCents: 0 });
  });

  it("with a joint account in view too: the payment that came back is still no leg of a transfer", () => {
    const rent = on(joint, "2026-09-05", -700, { category: "housing", categorySource: "rule" });
    const accounts = [his, savings, joint];
    const seen = applyUse([...rows, rent], accounts, parts([joint, HALF]));
    expect(seen.slice(0, 3)).toEqual(rows);
    for (const [i, row] of rows.entries()) expect(seen[i]).toBe(row);
    expect(seen[3]).toEqual({ ...rent, amountCents: -35000, wholeCents: -70000 });
    expect(totals(seen, accounts).incomeCents).toBe(totals(rows, accounts).incomeCents);
  });

  it("a stored transfer keeps its other leg when an equal sum lands on the joint account the same day", () => {
    const [out, into] = [moved(his, "2026-09-01", -500), moved(savings, "2026-09-02", 500)];
    const gift = on(joint, "2026-09-01", 500, { category: "p2p_in", categorySource: "rule", counterparty: "VIERAS VEIKKO" });
    const accounts = [his, savings, joint];
    const mine = applyUse([out, into, gift], accounts, parts([joint, { from: 0, to: 1, of: 2 }]));
    const yours = applyUse([gift], [joint], parts([joint, { from: 1, to: 2, of: 2 }]));
    expect(mine).toEqual([out, into, { ...gift, amountCents: 25000, wholeCents: 50000 }]);
    // the two own views of the 500 add up to it
    expect(totals(mine, accounts).incomeCents + totals(yours, [joint]).incomeCents).toBe(totals([out, into, gift], accounts).incomeCents);
    expect(totals(mine, accounts).incomeCents).toBe(25000);
  });

  it("money out of one member's account pairs with money into another member's, and never with a row of its own member", () => {
    // her copy of the joint account pays 25 to his savings: his 25 that came back must not take the leg on his savings
    const sent = on(joint, "2026-09-02", -25, { category: "p2p", categorySource: "rule", counterparty: MATTI });
    const seen = applyUse([paid, returned, other, sent], [his, savings, joint], parts([joint, HALF]), new Map([[joint.id, "u-2"]]));
    expect(seen).toEqual([
      paid,
      returned,
      { ...other, category: "transfer", isTransfer: true },
      { ...sent, category: "transfer", isTransfer: true, amountCents: -1250, wholeCents: -2500 },
    ]);
    // near miss: with every account one member's, nothing is paired that the member's categorisation left alone
    expect(applyUse([paid, returned, other, sent], [his, savings, joint], parts([joint, HALF]))).toEqual([paid, returned, other, { ...sent, amountCents: -1250, wholeCents: -2500 }]);
  });

  // she linked the card both hold, and her categorisation stored the leg that reached it with its other leg on her
  // copy of the joint account. His view holds his own copy, whose row his categorisation, with no card, left a payment
  const card = account("card", `${ELISA}, ${MATTI}`, { type: "credit_card" });
  const bought = on(card, "2026-09-02", -200, { category: "travel", categorySource: "mcc" });
  const reached = moved(card, "2026-09-13", 200);
  const bill = on(joint, "2026-09-13", -200, { category: "card_bill", categorySource: "rule", counterparty: "YHTEISKORTTI LASKU" });
  const hisCopy = new Map([[joint.id, "u-1"], [his.id, "u-1"], [card.id, "u-2"], [hers.id, "u-2"]]);
  const [first, second] = [HALF, { from: 1, to: 2, of: 2 }];

  it("the bill of a card another member linked is a movement inside the household, and the card's purchases are spent once", () => {
    const accounts = [joint, card];
    const mine = applyUse([bought, reached, bill], accounts, parts([joint, partOf(use, "u-1")], [card, first]), hisCopy);
    expect(mine).toEqual([
      { ...bought, amountCents: -10000, wholeCents: -20000 },
      { ...reached, amountCents: 10000, wholeCents: 20000 },
      { ...bill, category: "transfer", isTransfer: true, amountCents: -12000, wholeCents: -20000 },
    ]);
    // her view holds her own copy, where the bill is the stored other leg: the two own views add up to the 200 that was spent
    const yours = applyUse([bought, reached, moved(joint, "2026-09-13", -200)], accounts, parts([joint, partOf(use, "u-2")], [card, second]));
    expect([totals(mine, accounts).consumptionCents, totals(yours, accounts).consumptionCents]).toEqual([10000, 10000]);
    expect(totals([bought, reached, moved(joint, "2026-09-13", -200)], accounts).consumptionCents).toBe(20000);
  });

  it("near misses of a card's bill: only money into a card, with no other leg in view, takes a payment, and only another member's", () => {
    const view = parts([joint, partOf(use, "u-1")], [card, first], [hers, HALF]);
    const cut = (t: Transaction, cents: number) => ({ ...t, amountCents: cents, wholeCents: t.amountCents });
    const seen = (rows: Transaction[], accounts: Account[], owners = hisCopy) => applyUse(rows, accounts, view, owners);
    // the leg has its other leg in view, on an account of hers he has a half of: his payment of the same day is a payment
    const [left, paid] = [moved(hers, "2026-09-13", -200), on(his, "2026-09-13", -200, { category: "p2p", categorySource: "rule" })];
    expect(seen([left, reached, paid], [his, hers, card])).toEqual([cut(left, -10000), cut(reached, 10000), paid]);
    expect(seen([reached, paid], [his, hers, card])).toEqual([cut(reached, 10000), { ...paid, category: "transfer", isTransfer: true }]);
    // a refund to the card is no stored leg, and money that left the card for an account outside the view pairs with nothing
    const refund = on(card, "2026-09-13", 200, { category: "travel", categorySource: "match" });
    const [drawn, got] = [moved(card, "2026-09-13", -200), on(joint, "2026-09-13", 200, { category: "p2p_in", categorySource: "rule", counterparty: "VIERAS VEIKKO" })];
    expect(seen([refund, bill], [joint, card])).toEqual([cut(refund, 10000), cut(bill, -12000)]);
    expect(seen([drawn, got], [joint, card])).toEqual([cut(drawn, -10000), cut(got, 12000)]);
    // a stored leg on an account that is no card says nothing of who paid, and a row of the card's own member stays as her categorisation left it
    const saved = moved(hers, "2026-09-13", 200);
    expect(seen([saved, bill], [joint, hers])).toEqual([cut(saved, 10000), cut(bill, -12000)]);
    expect(seen([reached, bill], [his, joint, card], new Map([[joint.id, "u-2"], [card.id, "u-2"], [his.id, "u-1"]]))).toEqual([cut(reached, 10000), cut(bill, -12000)]);
    // a payment six days from the leg is not its bill, and one that his own categorisation gave a purchase's category is none
    const [late, shop] = [{ ...bill, bookingDate: "2026-09-19" }, { ...bill, category: "groceries", categorySource: "mcc" as const }];
    expect(seen([reached, late], [joint, card])).toEqual([cut(reached, 10000), cut(late, -12000)]);
    expect(seen([reached, shop], [joint, card])).toEqual([cut(reached, 10000), cut(shop, -12000)]);
  });

  it("a card's bill takes one payment, and nothing that had paired or was left unpaired before it", () => {
    const third = account("third", "VIERAS VEIKKO");
    const owners = new Map([...hisCopy, [third.id, "u-3"]]);
    const cut = (t: Transaction, cents: number) => ({ ...t, amountCents: cents, wholeCents: t.amountCents });
    const person = { category: "p2p", categorySource: "rule" as const };
    // two members paid the sum that day: the leg is the other leg of one payment only
    const also = on(third, "2026-09-13", -200, person);
    const two = applyUse([reached, bill, also], [joint, card, third], parts([joint, HALF], [card, first]), owners);
    expect(two).toEqual([cut(reached, 10000), { ...cut(bill, -10000), category: "transfer", isTransfer: true }, also]);
    // his 200 to an account of hers he has no part in paired with the row it landed as: still money to a person
    const [sent, landed] = [on(his, "2026-09-13", -200, person), on(hers, "2026-09-13", 200, { category: "p2p_in", categorySource: "rule" })];
    const gone = parts([hers, NONE], [card, first]);
    expect(applyUse([sent, landed, reached], [his, hers, card], gone, owners)).toEqual([{ ...sent, isTransfer: false }, cut(reached, 10000)]);
    // 25 out and 25 in that his own categorisation left unpaired stay so beside a card's leg
    const [out, into] = [on(his, "2026-09-01", -25, person), on(joint, "2026-09-02", 25, { category: "p2p_in", categorySource: "rule", counterparty: "TOINEN TYYPPI" })];
    expect(applyUse([out, into, reached], [his, joint, card], parts([joint, HALF], [card, first]), owners)).toEqual([out, cut(into, 1250), cut(reached, 10000)]);
    // money a card lent to an account outside the view and a bill that reached a third member's card are two movements
    const theirs = account("theirs", "VIERAS VEIKKO", { type: "credit_card" });
    const [drawn, repaid] = [moved(card, "2026-09-13", -200), moved(theirs, "2026-09-13", 200)];
    const lent = applyUse([drawn, repaid], [joint, card, theirs], parts([joint, HALF], [card, first], [theirs, NONE]), new Map([...owners, [theirs.id, "u-3"]]));
    expect(lent).toEqual([cut(drawn, -10000)]);
  });

  it("a row that names an account by its number is a movement only when the account is another member's", () => {
    const numbered = account("his", MATTI, { iban: "FI21 1234 5600 0007 85" });
    const to = { counterpartyIban: "FI2112345600000785", category: "p2p", categorySource: "rule" as const };
    const [own, theirs] = [on(savings, "2026-09-05", -60, to), on(joint, "2026-09-06", -60, to)];
    const seen = applyUse([own, theirs], [numbered, savings, joint], parts([joint, HALF]), new Map([[joint.id, "u-2"]]));
    // his own categorisation saw both of his accounts and left the row a payment: it stays one
    expect(seen[0]).toBe(own);
    expect(seen[1]).toEqual({ ...theirs, category: "transfer", isTransfer: true, amountCents: -3000, wholeCents: -6000 });
  });
});
