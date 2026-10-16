/**
 * The rows the reviews of 0.10.0 left: a trade, a company and a school named like a person, a person behind a card
 * account's lead, a card purchase from a company named like a lender, the own bank's loan paid by its reference, a
 * card's bills beside credit drawn from its issuer, and a card that replaced another. Every row is made up.
 */
import { describe, expect, it } from "vitest";
import { flowsOf, totalsOf } from "../src/analysis/flows.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { namesBank } from "../src/transfers.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Esimerkkipankki Gold", iban: null, currency: "EUR", type: "credit_card" };
/** Somebody's account that is not the household's. */
const IBAN = "FI0000000000000017";

type Extra = { mcc?: string; accountId?: string; date?: string; iban?: string; reference?: string | null; id?: string };
/** A row as the server stores it. `reference: null` is a payment with no reference number; left out, the row says nothing of one. */
const row = (counterparty: string | null, description: string | null, euros: number, extra: Extra = {}): Transaction => ({
  ...tx({
    accountId: extra.accountId ?? "chk",
    bookingDate: extra.date ?? "2026-09-05",
    amountCents: Math.round(euros * 100),
    counterparty,
    description,
    counterpartyIban: extra.iban ?? null,
    mcc: extra.mcc ?? null,
    merchant: normalizeMerchant(counterparty, description),
    ...(extra.id ? { id: extra.id } : {}),
  }),
  ...(extra.reference !== undefined ? { reference: extra.reference } : {}),
});

function run(rows: Transaction[], accounts: Account[] = [checking, card]) {
  const sorted = [...rows].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  const changed = new Map(enrichTransactions(sorted, accounts, []).map((t) => [t.id, t]));
  const final = rows.map((t) => changed.get(t.id) ?? t);
  const totals = (month: string) => totalsOf(final.filter((t) => t.bookingDate.startsWith(month)).map((t) => flowsOf(t, new Set())));
  return { final, totals, categories: final.map((t) => t.category), of: (id: string) => final.find((t) => t.id === id)!.category };
}
const one = (counterparty: string | null, description: string | null, euros: number, extra: Extra = {}, accounts?: Account[]) => run([row(counterparty, description, euros, extra)], accounts).categories[0];
/** A credit transfer to a payee's account with no reference number and a message that names nothing. */
const paid = (payee: string, message: string | null = "kiitos", euros = -40) => one(payee, message, euros, { iban: IBAN, reference: null });

describe("a trade in front of a name is a trade, not a person", () => {
  it.each([
    ["KAMPAAMO LIISA", "personal_care"],
    ["PARTURI PEKKA", "personal_care"],
    ["SIIVOUS VIRTANEN", "home"],
    ["REMONTTI VIRTANEN", "home"],
    ["MAALAUS VIRTANEN", "home"],
    ["KUKKA ILO", "home"],
    ["KUKKATALO ILO", "home"],
    ["TAKSI VIRTANEN", "transport"],
    ["FYSIO VIRTANEN", "health"],
    ["KENNEL ESIMERKKI", "pets"],
    ["PIZZERIA MARIO", "restaurants"],
    ["HELSINGIN KAUPUNKI", "taxes"],
    ["KERAVAN KAUPUNKI", "taxes"],
  ])("%s with a bare message is %s", (payee, category) => {
    expect(paid(payee)).toBe(category);
  });

  it("a brand of one word is still a first name or a surname, and a plain name a person", () => {
    expect(["VIRTANEN PEKKA", "ELISA KORHONEN", "HELEN VIRTA"].map((payee) => paid(payee))).toEqual(["p2p", "p2p", "p2p"]);
  });

  it("money in from the trade and a refund on a card read as before, and the allowance with the bank's word is no trade's", () => {
    expect(one("KAMPAAMO LIISA", "kiitos", 40, { iban: IBAN, reference: null })).toBe("personal_care");
    expect(one("KAMPAAMO LIISA", "HYVITYS", 40, { accountId: "card", mcc: "7230" })).toBe("personal_care");
    expect(one("VIRTANEN LIISA", "MOBIILIMAKSU VIIKKORAHA", -20)).toBe("p2p");
  });

  it("a compound another rule lists keeps its category, and a mender with no prefix in the rules is left", () => {
    expect(one("VAATEKORJAAMO ESIMERKKI", "LASKU 12", -30)).toBe("home");
    expect(one("PYORAKORJAAMO ESIMERKKI", "LASKU 12", -30)).toBe("transport");
    expect(one("KOTISIIVOUS ESIMERKKI", "LASKU 12", -30)).toBe("home");
  });
});

describe("a company, a school and an association are not shaped like a person", () => {
  it("a company form between two words, and a word of a school or an association", () => {
    expect(paid("BOSTADS AB EXEMPEL", "mars", -90)).toBe("other");
    expect(paid("ESIMERKKI OY TAMPERE")).toBe("other");
    expect(paid("ESIMERKIN KOULU", "luokkaretki")).toBe("other");
    expect(paid("ESIMERKIN VPK", null)).toBe("other");
    // the rules after the people get to read it
    expect(paid("ESIMERKIN URHEILUSEURA", "kausimaksu Ville")).toBe("fitness");
  });

  it("a person whose name only begins like such a word stays a person", () => {
    expect(["SEURALA MATTI", "KOULUMIES LIISA", "MEIKALAINEN MATTI"].map((payee) => paid(payee))).toEqual(["p2p", "p2p", "p2p"]);
  });

  it("with the bank's word for a payment between people: money in from a school is no person's, a person's is", () => {
    expect(one("ESIMERKIN KOULU", "MOBIILIMAKSU", 20)).toBe("income");
    expect(one("MEIKALAINEN LIISA", "MOBIILIMAKSU", 20)).toBe("p2p_in");
    expect(one("ESIMERKIN KOULU", "MOBIILIMAKSU", -20)).toBe("other");
  });
});

describe("a person behind the lead a card account writes", () => {
  const LEAD = "OSTO FIN KUOPIO MOB.PAY*MATTI MEIKALAINEN";
  it("money to the person, money from the person, and a shop's card code", () => {
    expect(one(LEAD, null, -20, { accountId: "card" })).toBe("p2p");
    // on the card's own account money in is a payment to the card, so the row is read on another account
    expect(one(LEAD, null, 20)).toBe("p2p_in");
    expect(one(LEAD, null, -20, { accountId: "card", mcc: "5411" })).toBe("groceries");
  });

  it("a shop behind the same lead is a shop", () => {
    expect(one("OSTO FIN KUOPIO MOB.PAY*KAHVILA ILO", null, -20, { accountId: "card" })).toBe("restaurants");
  });
});

describe("a row with the text of a card terminal", () => {
  it("is a purchase, also from a payee named like the account's other holder; without that text the holder is a person", () => {
    const mine: Account = { ...checking, holder: "MEIKALAINEN MATTI" };
    const joint: Account = { ...checking, id: "joint", iban: "FI1410093000123458", holder: "MEIKALAINEN MATTI, KORHONEN LIISA" };
    expect(one("KORHONEN LIISA", "483920 HELSINKI", -20, {}, [mine, joint])).toBe("other");
    expect(one("KORHONEN LIISA", "RUOKARAHAT", -20, {}, [mine, joint])).toBe("p2p");
  });
});

describe("a card purchase from a company named by a credit compound", () => {
  const WORKSHOP = "ESIMERKKI AUTORAHOITUS OY";
  it("the card's code decides, for the purchase and for its refund", () => {
    expect(one(WORKSHOP, "HUOLTO", -90, { mcc: "5511" })).toBe("car");
    expect(one(WORKSHOP, "HUOLTO", 90, { mcc: "5511" })).toBe("car");
  });

  it("off a card the same name is a lender: paid is a loan, paying out is credit drawn", () => {
    expect(one(WORKSHOP, "HUOLTO", -90)).toBe("loans");
    expect(one(WORKSHOP, "SOPIMUS 880123", 4000)).toBe("credit_draw");
  });
});

describe("the household's own bank", () => {
  const own: Account = { ...checking, bank: "Esimerkkipankki Oyj" };
  const BANK = "ESIMERKKIPANKKI OYJ";
  const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const monthly = (sums: number[], reference: string | null) => sums.map((euros, i) => row(BANK, null, euros, { date: `${months[i]}-05`, reference, iban: "FI0000000000000009" }));

  it("a loan paid by its reference alone is a loan: six equal payments, and the month's debt payments count one", () => {
    const { categories, totals, final } = run(monthly(Array(6).fill(-152), "30031"), [own]);
    expect(categories).toEqual(Array(6).fill("loans"));
    expect(final[0]!.categorySource).toBe("merchant");
    expect(totals("2026-09")).toMatchObject({ debtCents: 15_200, consumptionCents: 0 });
  });

  it("two payments, sums that jump, and payments with no reference are no contract", () => {
    expect(run(monthly([-152, -152], "30031"), [own]).categories).toEqual(["other", "other"]);
    expect(new Set(run(monthly([-312.4, -188.1, -540, -95.75, -410.2, -267.3], "20028"), [own]).categories)).toEqual(new Set(["other"]));
    // no reference and no text: money moved to the bank of a connected account
    expect(new Set(run(monthly(Array(6).fill(-152), null), [own]).categories)).toEqual(new Set(["transfer"]));
  });

  it("money in under the same reference is no loan, and an instalment sent back takes the instalment's category", () => {
    const rows = [...monthly(Array(6).fill(-152), "30031"), row(BANK, null, 500, { date: "2026-03-01", reference: "30031" }), row(BANK, null, 152, { date: "2026-09-20" })];
    expect(run(rows, [own]).final.slice(6).map((t) => `${t.category}/${t.categorySource}`)).toEqual(["income/default", "loans/match"]);
  });

  it("another bank of the same kind is not the household's own, and a bank named by its kind alone is", () => {
    const savingsBank = { bank: "Esimerkin Säästöpankki" };
    expect(namesBank("TOISEN SAASTOPANKKI OY", savingsBank)).toBe(false);
    expect(namesBank("ESIMERKIN SAASTOPANKKI", savingsBank)).toBe(true);
    expect(namesBank("ESIMERKKIPANKKI OYJ", { bank: "Esimerkkipankki Oyj" })).toBe(true);
    expect(namesBank("LIEDON SAASTOPANKKI", { bank: "Säästöpankki" })).toBe(true);
    // paid with no word: a bank's name alone is no loan, the other bank's or the own one's
    expect(one("TOISEN SAASTOPANKKI OY", null, -152, {}, [{ ...checking, ...savingsBank }])).toBe("other");
    expect(one("ESIMERKIN SAASTOPANKKI OY", null, -152, {}, [{ ...checking, ...savingsBank }])).toBe("transfer");
  });
});

describe("a card's bills beside credit drawn from its issuer", () => {
  const issuerCard: Account = { id: "card", name: "Resurs Bank Gold", iban: null, currency: "EUR", type: "credit_card" };
  const ISSUER = "RESURS BANK AB";
  const sums = [-280, -450, -310, -395, -420, -335];
  const bills = (iban?: string) => sums.map((euros, i) => row(ISSUER, null, euros, { date: `2026-0${i + 2}-14`, iban, id: `bill${i + 1}` }));
  const purchases = sums.map((euros, i) => row("KAHVILA ESIMERKKI", null, euros, { date: `2026-0${i + 1}-20`, accountId: "card" }));

  it("a payout named like the issuer does not make the card's bills spending: the purchases count once", () => {
    const alone = run([...purchases, ...bills()], [checking, issuerCard]);
    expect(new Set(alone.categories.slice(6))).toEqual(new Set(["transfer"]));
    const drawn = run([row(ISSUER, "LUOTON NOSTO", 2000, { date: "2026-01-15" }), ...purchases, ...bills()], [checking, issuerCard]);
    expect(drawn.categories[0]).toBe("credit_draw");
    expect(new Set(drawn.categories.slice(7))).toEqual(new Set(["transfer"]));
    expect(drawn.totals("2026-06").consumptionCents).toBe(33_500);
  });

  it("the payments to the account the credit came from are that credit's, and no card's bill", () => {
    const LENDER_ACCOUNT = "FI0000000000000058";
    const drawn = run([row(ISSUER, "LUOTON NOSTO", 2000, { date: "2026-01-15", iban: LENDER_ACCOUNT }), ...purchases, ...bills(LENDER_ACCOUNT)], [checking, issuerCard]);
    expect(new Set(drawn.categories.slice(7))).toEqual(new Set(["card_bill"]));
  });
});

describe("a card that replaced another is paid through the old card's channel", () => {
  const newCard: Account = { id: "new", name: "Esimerkkipankki Platinum", iban: null, currency: "EUR", type: "credit_card" };
  /** The bank's collection account and the reference both cards are paid under. */
  const pay = (id: string, date: string, euros: number) => row("ESIMERKKIPANKKI OYJ", "10016", euros, { date, iban: "FI0000000000000009", reference: "10016", id });
  const paidIn = (date: string, euros: number, accountId: string) => row(null, "SUORITUS", euros, { date, accountId });
  const old = [
    row("KAHVILA ESIMERKKI", null, -42, { date: "2025-08-10", accountId: "card" }),
    pay("o1", "2025-09-14", -300),
    paidIn("2025-09-15", 300, "card"),
    pay("o2", "2025-10-14", -310),
    paidIn("2025-10-15", 310, "card"),
    pay("o3", "2025-11-14", -320),
    paidIn("2025-11-15", 320, "card"),
  ];
  /** The new card's rows begin on 10.6.2026, and its bill of July pairs. */
  const replaced = [row("KAHVILA ESIMERKKI", null, -55, { date: "2026-06-10", accountId: "new" }), pay("n2", "2026-07-14", -410), paidIn("2026-07-15", 410, "new")];

  it("the new card's first bill pays purchases that are in no data: a card bill, counted as spending", () => {
    const { of, totals } = run([...old, ...replaced, pay("first", "2026-06-14", -400)], [checking, card, newCard]);
    expect([of("o1"), of("n2")]).toEqual(["transfer", "transfer"]);
    expect(of("first")).toBe("card_bill");
    expect(totals("2026-06").consumptionCents).toBe(45_500);
  });

  it("a payment on the 31st day after the card's first row is a card bill, on the 32nd a transfer", () => {
    const at = (date: string) => run([...old, ...replaced, pay("late", date, -400)], [checking, card, newCard]).of("late");
    expect(at("2026-07-11")).toBe("card_bill");
    expect(at("2026-07-12")).toBe("transfer");
  });

  it("with the old card alone the same payment is a transfer, as its rows cover the month", () => {
    expect(run([...old, pay("first", "2026-06-14", -400)], [checking, card]).of("first")).toBe("transfer");
  });
});
