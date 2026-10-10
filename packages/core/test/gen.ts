import { addDays } from "../src/dates.ts";
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

/** A mixed history with every kind of row the pipeline treats specially: ids are unique, ties are common. */
export function randomHistory(seed: number, count: number): { txs: Transaction[]; accounts: Account[]; rules: CategoryRule[] } {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const day = () => addDays("2025-01-01", Math.floor(r() * 300));
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
      add({ bookingDate: d, amountCents: 300000 + Math.floor(r() * 50000), merchant: "Työnantaja Oy", counterparty: "TYÖNANTAJA OY", description: "PALKKA", accountId: "chk" });
    } else if (x < 0.88) {
      add({ bookingDate: d, amountCents: -Math.round(40000 + r() * 100), merchant: "Nordea", description: "LAINANLYHENNYS", accountId: "chk", counterpartyIban: "FI5512345600000123" });
    } else if (x < 0.93) {
      // the user chose these by hand
      const t = pick(["groceries", "restaurants", "other", "transfer", "p2p", "savings"]);
      add({ bookingDate: d, amountCents: -Math.round(200 + r() * 6000), merchant: pick([...SHOPS, ...UNKNOWN]), category: t, categorySource: "user", accountId: pick(["chk", "card"]) });
    } else {
      add({ bookingDate: d, amountCents: pick([1, -1]) * Math.round(100 + r() * 30000), merchant: pick(UNKNOWN), accountId: pick(["chk", "sav", "card"]), counterpartyIban: pick([null, null, "FI2112345600000785", "FI1410093000123458", "FI9900000000000009"]) });
    }
  }
  // the order the server reads: date, then id
  txs.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || (a.id < b.id ? -1 : 1));
  const rules: CategoryRule[] = [
    { id: 1, field: "merchant_exact", pattern: "Xyzzy Tuntematon", category: "shopping", priority: 5 },
    { id: 2, field: "merchant", pattern: "Zorro", category: "hobbies", priority: 10 },
  ];
  return { txs, accounts: ACCOUNTS, rules };
}
