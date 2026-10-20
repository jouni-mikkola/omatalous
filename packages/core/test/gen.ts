import { addDays, addMonths, daysBetween } from "../src/dates.ts";
import type { Account, CategoryRule, Transaction } from "../src/types.ts";

export function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ACCOUNTS: Account[] = [
  { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" },
  { id: "sav", name: "Säästötili", iban: "FI1410093000123458", currency: "EUR", type: "savings" },
  { id: "card", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" },
  { id: "loan", name: "Asuntolaina", iban: "FI5512345600000123", currency: "EUR", type: "loan" },
];

const SHOPS = ["K-Market Kamppi", "Lidl Tikkurila", "Prisma Itis", "Neste Vantaa", "Hesburger", "Verkkokauppa.com", "Zara", "Apteekki Keskus", "Tokmanni", "Kahvila Ilo"];
const UNKNOWN = ["Xyzzy Tuntematon", "Qwerty Puoti", "Aaltonen Konsultointi Oy", "Metsä Ky", "Pajula Tmi", "Zorro Kauppa", "Oma Putka", "Lumi Palvelut"];
const PEOPLE = ["Matti Meikäläinen", "Liisa Virtanen", "Kari Korhonen", "Anna Laine", "Juha Mäkinen"];
const SUBS = ["Spotify", "Netflix", "HBO Max", "Helen Sähkö", "Elisa"];

/** The last day a generated history can reach. */
const HISTORY_END = "2025-10-28";

export interface HistoryOptions {
  /** Months of history up to 28.10.2025. Without it the history runs 1.1.–28.10.2025. */
  months?: number;
  /**
   * What a settled household has beside the noise, in place of pay and loan rows on random days: monthly pay, rent, a
   * loan instalment, two subscriptions and an electricity bill that run the whole history, yearly subscriptions, a gym
   * that ended long ago, an electricity company switched in mid-history, pay-later invoices of varying sums and, on
   * every third seed, a card account that stopped syncing two months before the end.
   */
  settled?: boolean;
  /**
   * The household's bank says pay in its own transaction code and not in the text: the rows come from an employer that
   * the merchant rules know as a hospital, with the salary code and no word of pay.
   */
  coded?: boolean;
}

/** What a pay row says: the word PALKKA, or (`HistoryOptions.coded`) only the bank's code. */
const payRow = (coded: boolean): Pick<Transaction, "merchant" | "counterparty" | "description" | "bankTxnCode"> =>
  coded
    ? { merchant: "HUS-yhtymä", counterparty: "HUS-YHTYMÄ", description: null, bankTxnCode: "PMNT-RCDT-SALA" }
    : { merchant: "Työnantaja Oy", counterparty: "TYÖNANTAJA OY", description: "PALKKA" };

/** A mixed history with every kind of row the pipeline treats specially: ids are unique, ties are common. */
export function randomHistory(seed: number, count: number, opts: HistoryOptions = {}): { txs: Transaction[]; accounts: Account[]; rules: CategoryRule[] } {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const start = opts.months ? addDays(HISTORY_END, -Math.round(opts.months * 30.44)) : "2025-01-01";
  const span = opts.months ? daysBetween(start, HISTORY_END) : 300;
  const day = () => addDays(start, Math.floor(r() * span));
  const settled = opts.settled ?? false;
  const coded = opts.coded ?? false;
  const txs: Transaction[] = [];
  let n = 0;
  const add = (p: Partial<Transaction> & Pick<Transaction, "bookingDate" | "amountCents" | "merchant">) => {
    txs.push({
      id: `g${seed}-${String(n++).padStart(6, "0")}`,
      accountId: "chk",
      currency: "EUR",
      status: "booked",
      counterparty: null,
      counterpartyIban: null,
      description: null,
      mcc: null,
      category: p.amountCents >= 0 ? "income" : "other",
      categorySource: "default",
      isTransfer: false,
      ...p,
    });
  };
  while (n < count) {
    const x = r();
    const d = day();
    if (x < 0.3) {
      const shop = pick(SHOPS);
      add({ bookingDate: d, amountCents: -Math.round(200 + r() * 9000), merchant: shop, description: shop.toUpperCase(), accountId: pick(["chk", "card", "card"]), mcc: r() < 0.5 ? "5411" : null });
    } else if (x < 0.4) {
      const shop = pick(UNKNOWN);
      add({ bookingDate: d, amountCents: -Math.round(300 + r() * 5000), merchant: shop, counterparty: r() < 0.5 ? shop.toUpperCase() : null, description: r() < 0.5 ? "KORTTIOSTO" : null, accountId: pick(["chk", "card"]), mcc: r() < 0.2 ? "5999" : null });
    } else if (x < 0.5) {
      const who = pick(PEOPLE);
      const out = r() < 0.5;
      add({ bookingDate: d, amountCents: (out ? -1 : 1) * pick([500, 1200, 2500, 4000]), merchant: who, counterparty: who.toUpperCase(), description: "MOBILEPAY", accountId: "chk" });
    } else if (x < 0.58) {
      // a move between own accounts: two legs with a few days between them
      const amount = pick([5000, 10000, 20000, 20000, 33333]);
      const from = pick(["chk", "sav"]);
      add({ bookingDate: d, amountCents: -amount, merchant: "Siirto", description: "SIIRTO", accountId: from });
      if (r() < 0.9) add({ bookingDate: addDays(d, Math.floor(r() * 4)), amountCents: amount, merchant: "Siirto", description: "SIIRTO", accountId: from === "chk" ? "sav" : "chk" });
    } else if (x < 0.64) {
      const amount = Math.round(5000 + r() * 40000);
      add({ bookingDate: d, amountCents: -amount, merchant: "Nordea", description: "LUOTTOKORTIN LASKU", accountId: "chk" });
      if (r() < 0.8) add({ bookingDate: addDays(d, Math.floor(r() * 3)), amountCents: amount, merchant: "Nordea", description: "MAKSU KIITOS", accountId: "card" });
    } else if (x < 0.7) {
      const shop = pick(SHOPS);
      const amount = Math.round(1500 + r() * 8000);
      add({ bookingDate: d, amountCents: -amount, merchant: shop, description: shop.toUpperCase(), accountId: "card" });
      // the shop pays back, in full or in part, some days later
      if (r() < 0.6) add({ bookingDate: addDays(d, 1 + Math.floor(r() * 20)), amountCents: r() < 0.5 ? amount : Math.round(amount / 2), merchant: shop, description: `HYVITYS ${shop.toUpperCase()}`, accountId: "card" });
    } else if (x < 0.74) {
      // a bill split between friends
      const total = pick([6000, 9000, 12000]);
      const shop = pick(["Ravintola Savoy", "Pizzeria Napoli", "Kahvila Ilo"]);
      add({ bookingDate: d, amountCents: -total, merchant: shop, description: shop.toUpperCase(), accountId: "chk", mcc: "5812" });
      for (const who of [pick(PEOPLE), pick(PEOPLE)]) add({ bookingDate: addDays(d, Math.floor(r() * 4)), amountCents: total / 3, merchant: who, counterparty: who.toUpperCase(), description: "MOBILEPAY", accountId: "chk" });
    } else if (x < 0.8) {
      const s = pick(SUBS);
      for (let m = 0; m < 4 && n < count; m++) add({ bookingDate: addDays(d, m * 30), amountCents: -pick([999, 1299, 4900]), merchant: s, description: s.toUpperCase(), accountId: "chk" });
    } else if (x < 0.84) {
      const amountCents = 300000 + Math.floor(r() * 50000);
      if (!settled) add({ bookingDate: d, amountCents, ...payRow(coded), accountId: "chk" });
    } else if (x < 0.88) {
      const amountCents = -Math.round(40000 + r() * 100);
      if (!settled) add({ bookingDate: d, amountCents, merchant: "Nordea", description: "LAINANLYHENNYS", accountId: "chk", counterpartyIban: "FI5512345600000123" });
    } else if (x < 0.93) {
      // the user chose these by hand
      const t = pick(["groceries", "restaurants", "other", "transfer", "p2p", "savings"]);
      add({ bookingDate: d, amountCents: -Math.round(200 + r() * 6000), merchant: pick([...SHOPS, ...UNKNOWN]), category: t, categorySource: "user", accountId: pick(["chk", "card"]) });
    } else {
      add({ bookingDate: d, amountCents: pick([1, -1]) * Math.round(100 + r() * 30000), merchant: pick(UNKNOWN), accountId: pick(["chk", "sav", "card"]), counterpartyIban: pick([null, null, "FI2112345600000785", "FI1410093000123458", "FI9900000000000009"]) });
    }
  }
  if (settled) settle(seed, start, add, coded);
  // a card account that stopped syncing: its rows end two months before the rest
  const kept = settled && seed % 3 === 0 ? txs.filter((t) => t.accountId !== "card" || t.bookingDate < "2025-09-01") : txs;
  // the order the server reads: date, then id
  kept.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || (a.id < b.id ? -1 : 1));
  const rules: CategoryRule[] = [
    { id: 1, field: "merchant_exact", pattern: "Xyzzy Tuntematon", category: "shopping", priority: 5 },
    { id: 2, field: "merchant", pattern: "Zorro", category: "hobbies", priority: 10 },
  ];
  return { txs: kept, accounts: ACCOUNTS, rules };
}

type Add = (p: Partial<Transaction> & Pick<Transaction, "bookingDate" | "amountCents" | "merchant">) => void;

/** The settled household's regular rows (`HistoryOptions.settled`), from their own generator so the noise stays the same. */
function settle(seed: number, start: string, add: Add, coded: boolean): void {
  const r = rng(seed * 7919 + 13);
  const months: string[] = [];
  for (let m = start.slice(0, 7); `${m}-28` <= HISTORY_END; m = addMonths(m, 1)) months.push(m);
  const on = (month: string, dayOfMonth: number) => `${month}-${String(dayOfMonth).padStart(2, "0")}`;
  const inHistory = (date: string) => date >= start && date <= HISTORY_END;
  const pay = 280000 + Math.round(r() * 100000);
  const rent = -(70000 + Math.round(r() * 40000));
  const loan = -(25000 + Math.round(r() * 20000));
  // the electricity company changes once, between the ninth month and six months before the end
  const switchAt = 8 + Math.floor(r() * (months.length - 14));
  const gymEnds = 6 + Math.floor(r() * 6);
  for (const [i, m] of months.entries()) {
    // pay day moves a day or two earlier when the 25th is a weekend
    add({ bookingDate: on(m, 25 - Math.floor(r() * 3)), amountCents: pay + Math.round(r() * 3000), ...payRow(coded), accountId: "chk" });
    add({ bookingDate: on(m, 2), amountCents: rent, merchant: "Vuokranantaja Oy", counterparty: "VUOKRANANTAJA OY", description: "VUOKRA", accountId: "chk" });
    add({ bookingDate: on(m, 20), amountCents: loan, merchant: "Nordea", description: "LAINANLYHENNYS", accountId: "chk", counterpartyIban: "FI5512345600000123" });
    add({ bookingDate: on(m, 8), amountCents: -1199, merchant: "Spotify", description: "SPOTIFY", accountId: "card" });
    add({ bookingDate: on(m, 12), amountCents: -1599, merchant: "Netflix", description: "NETFLIX", accountId: "chk" });
    // a bill that follows the season
    const winter = [1, 2, 3, 11, 12].includes(Number(m.slice(5)));
    add({ bookingDate: on(m, 16), amountCents: -Math.round((winter ? 9000 : 4000) + r() * 2500), merchant: i < switchAt ? "Helen Sähkö" : "Oomi Energia", description: "SÄHKÖ", accountId: "chk" });
    if (i < gymEnds) add({ bookingDate: on(m, 4), amountCents: -3990, merchant: "Elixia", description: "ELIXIA", accountId: "card" });
    // pay-later invoices: a different sum each time, never a plan
    if (r() < 0.7) add({ bookingDate: on(m, 1 + Math.floor(r() * 27)), amountCents: -Math.round(1500 + r() * 12000), merchant: r() < 0.5 ? "Klarna" : "Walley", description: "LASKU", accountId: "chk" });
  }
  // yearly subscriptions renew in February to July; the first was paid more than a year before the end
  for (const [k, merchant] of ["Adobe", "Microsoft 365"].entries()) {
    const month = 2 + Math.floor(r() * 6);
    const amountCents = -(9900 + Math.round(r() * 3000));
    for (let year = 2023 + k; year <= 2025; year++) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(3 + Math.floor(r() * 20)).padStart(2, "0")}`;
      if (inHistory(date)) add({ bookingDate: date, amountCents, merchant, description: merchant.toUpperCase(), accountId: "chk" });
    }
  }
}
