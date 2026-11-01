/**
 * The second household at the second bank (OP in the fake bank): a made-up couple whose checking account, savings account
 * and credit card are worded the way a second bank words them. It differs from household.mjs and first-evening.mjs in the
 * shape of the rows as well as the names: the text is a message beside a payment reference (viite), many card rows carry
 * the merchant in the message and no payee at all, a row may lack its category code, and the newest rows are reserved
 * (PDNG, with a transaction date only and no entry reference). Every booked row has the category a reader expects, which
 * the spec (e2e/second-household.spec.ts) compares with what the app made of it, by value.
 *
 * Seeded like the others: one day always gives the same rows. Rows are { date, cents, text, party, expect, ... } with money
 * signed (negative = out). Everything is made up; the shops and services are real trade names, because the rules read those.
 */

const IBAN = {
  checking: "FI3750009420041552",
  savings: "FI0950009420041560",
  employer: "FI6350009420041578",
  landlord: "FI3250009420041586",
  cardBill: "FI9550009420041594",
  friend: "FI5250009420041602",
  sister: "FI7350009420041628",
  lender: "FI2450009420041610",
};

const OPENING = { chk: 90_000, sav: 600_000, card: 0 };

const ACCOUNTS = [
  { key: "chk", uid: "sh-chk", hash: "sh-hash-chk", name: "LEHTONEN PEKKA", product: "OP-käyttötili", type: "CACC", iban: IBAN.checking },
  { key: "sav", uid: "sh-sav", hash: "sh-hash-sav", name: "LEHTONEN PEKKA", product: "OP-pikasäästötili", type: "CACC", iban: IBAN.savings },
  { key: "card", uid: "sh-card", hash: "sh-hash-card", name: "LEHTONEN PEKKA", product: "OP Visa Credit", type: "CARD", card: "4929********4242" },
];

/** [merchant, mcc, category, low, high, city] of a card purchase. */
const CARD_SHOPS = [
  ["K-SUPERMARKET LAHTI", "5411", "groceries", 1800, 12_000, "LAHTI"],
  ["S-MARKET TURKU", "5411", "groceries", 2200, 9800, "TURKU"],
  ["LIDL SUOMI KY", "5411", "groceries", 1500, 8000, "TAMPERE"],
  ["PRISMA TAMPERE", "5411", "groceries", 3200, 15_000, "TAMPERE"],
  ["HESBURGER", "5814", "restaurants", 800, 2200, "TURKU"],
  ["RAVINTOLA SAVOY", "5812", "restaurants", 4500, 12_000, "HELSINKI"],
  ["WOLT", "5812", "food_delivery", 1700, 3600, "HELSINKI"],
  ["ALKO", "5921", "alcohol", 1400, 7000, "LAHTI"],
  ["VR", "4112", "transport", 1500, 7000, "HELSINKI"],
  ["NESTE TURKU", "5541", "car", 4800, 9000, "TURKU"],
  ["APTEEKKI ITIS", "5912", "health", 700, 5200, "HELSINKI"],
  ["ZALANDO", "5651", "shopping", 3000, 11_000, "BERLIN"],
  ["IKEA", "5712", "home", 2800, 16_000, "VANTAA"],
  ["FINNKINO", "7832", "entertainment", 1300, 3000, "TURKU"],
  ["TOKMANNI", "5311", "shopping", 1100, 6000, "LAHTI"],
];

/** A small seeded generator (mulberry32). */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayOf = (today, back, day) => {
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 - back, day)).toISOString().slice(0, 10);
};

/**
 * A row as this bank sends it: the message is one line and the payment reference its own field. A reserved row has no
 * booking date and no entry reference, only the day of the purchase and a transaction id.
 */
function toBank(uid, row, n) {
  const out = row.cents < 0;
  const side = out ? "creditor" : "debtor";
  const named = row.party.name ? { [side]: { name: row.party.name } } : {};
  const pending = row.pending === true;
  return {
    ...(pending ? { entry_reference: null, transaction_id: `${uid}-p${String(n).padStart(4, "0")}` } : { entry_reference: `${uid}-${String(n).padStart(4, "0")}` }),
    transaction_amount: { currency: "EUR", amount: (Math.abs(row.cents) / 100).toFixed(2) },
    credit_debit_indicator: out ? "DBIT" : "CRDT",
    status: pending ? "PDNG" : "BOOK",
    ...(pending ? { transaction_date: row.date } : { booking_date: row.date, value_date: row.date }),
    ...named,
    ...(row.party.iban ? { [`${side}_account`]: { iban: row.party.iban } } : {}),
    remittance_information: [row.text],
    reference_number: row.ref ?? null,
    merchant_category_code: row.mcc ?? null,
    bank_transaction_code: row.mcc ? { code: "PMNT", sub_code: "CCRD-POSD" } : { description: out ? "Maksu" : "Talletus" },
  };
}

/**
 * The accounts, the bank's answers about them and the expected category of every booked row, for the day `today`
 * (YYYY-MM-DD). `expected` lists booked rows only; `pending` lists the reserved ones.
 */
export function secondHousehold(today) {
  const random = seeded(20261031);
  const between = (low, high) => low + Math.floor(random() * (high - low + 1));
  const rows = { chk: [], sav: [], card: [] };
  const add = (account, back, day, cents, text, party, expect, extra = {}) => {
    const date = dayOf(today, back, day);
    if (date <= today) rows[account].push({ date, cents, text, party, expect, ...extra });
  };
  const pekka = { name: "LEHTONEN PEKKA" };

  let cardBill = 0;
  for (let back = 7; back >= 0; back--) {
    const month = dayOf(today, back, 1).slice(0, 7);

    add("chk", back, 28, 285_000, `Palkka ${month}`, { name: "ESIMERKKI TYONANTAJA OY", iban: IBAN.employer }, "salary");
    add("chk", back, 3, -78_000, "Vuokra", { name: "ESIMERKKI KIINTEISTOT OY", iban: IBAN.landlord }, "housing", { ref: "4455661" });
    add("chk", back, 8, -between(4000, 9500), "Sähkölasku", { name: "ESIMERKKI ENERGIA OY" }, "utilities", { ref: "9988771" });
    add("chk", back, 10, -2490, "Liittymä", { name: "TELIA FINLAND OYJ" }, "telecom", { ref: "7712345" });
    add("chk", back, 14, -3750, "Vakuutusmaksu", { name: "LAHITAPIOLA" }, "insurance", { ref: "6543217" });
    add("chk", back, 15, -21_000, "Lainan lyhennys", { name: "ESIMERKKIPANKKI OYJ", iban: IBAN.lender }, "loans", { ref: "3141592" });
    add("chk", back, 16, -3900, "Kuukausimaksu", { name: "FITNESS24 SUOMI OY" }, "fitness");
    add("chk", back, 17, -1299, "Verkkomaksu", { name: "NETFLIX INTERNATIONAL B.V." }, "subscriptions", { mcc: "4899" });
    add("chk", back, 18, -990, "Verkkomaksu", { name: "SPOTIFY" }, "subscriptions");
    add("chk", back, 20, -25_000, "Siirto säästötilille", { ...pekka, iban: IBAN.savings }, "transfer");
    add("chk", back, 22, -190, "Palvelumaksu", { name: "ESIMERKKIPANKKI OYJ" }, "fees");
    // money to a person now and then (a steady payee is a series, not a gift: the rules read it as before)
    if (back % 3 !== 1) add("chk", back, 12, -between(1200, 5000), "Pikasiirto", { name: "HEIKKINEN SAARA", iban: IBAN.sister }, "p2p");
    if (back % 2 === 0) add("chk", back, 19, between(1500, 4500), "Pikasiirto", { name: "KOSKINEN JARI", iban: IBAN.friend }, "p2p_in");
    if (back % 2 === 1) add("chk", back, 9, -between(6000, 12_000), "Automaattinosto", {}, "cash", { mcc: "6011" });
    if (back === 5) add("chk", back, 6, 41_000, "Veronpalautus", { name: "VEROHALLINTO" }, "tax_refund", { ref: "20261" });
    // debit card purchases on the checking account: the shop is the payee, the message says how it was paid
    for (let i = 0; i < 5; i++) {
      const [name, mcc, category, low, high] = CARD_SHOPS[between(0, 3)];
      add("chk", back, between(1, 27), -between(low, high), ["Korttiosto", "Visa Debit osto", "Kortti **** 5555"][between(0, 2)], { name }, category, between(0, 9) < 5 ? { mcc } : {});
    }

    if (cardBill > 0) {
      add("chk", back, 5, -cardBill, "Luottokortin lasku", { name: "ESIMERKKIPANKKI OYJ", iban: IBAN.cardBill }, "transfer", { ref: "5678901" });
      add("card", back, 6, cardBill, "Laskun maksu", { ...pekka, iban: IBAN.checking }, "transfer");
    }
    const before = rows.card.length;
    // each purchase is made distinct (day and cents), so a row is found again by its date and amount
    const used = new Set();
    for (let i = 0; i < 14; i++) {
      const [name, mcc, category, low, high, city] = CARD_SHOPS[between(0, CARD_SHOPS.length - 1)];
      const day = between(1, 27);
      let cents = -between(low, high);
      while (used.has(`${day}|${cents}`)) cents -= 1;
      used.add(`${day}|${cents}`);
      // the merchant stands in the message of about half the rows and the bank names no payee; a code is not always there
      const text = `Visa-osto ${name} ${city}`;
      const nameless = between(0, 9) < 5;
      add("card", back, day, cents, nameless ? text : `Korttiosto ${city}`, nameless ? {} : { name }, category, between(0, 9) < 7 ? { mcc } : {});
    }
    cardBill = -rows.card.slice(before).reduce((sum, row) => sum + row.cents, 0);
  }
  // reserved rows: card purchases of the last days that are not booked yet. They carry no category, and no balance
  const pending = [];
  const reserve = (account, daysAgo, cents, text, party, mcc) => {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);
    pending.push({ account, date, cents, text, merchant: party.name ?? text });
    rows[account].push({ date, cents, text, party, pending: true, mcc, expect: null });
  };
  reserve("card", 0, -2390, "Varaus K-SUPERMARKET LAHTI", { name: "K-SUPERMARKET LAHTI" }, "5411");
  reserve("card", 1, -1450, "Varaus HESBURGER TURKU", {}, "5814");
  reserve("chk", 0, -4200, "Varaus NESTE TURKU", { name: "NESTE TURKU" }, "5541");

  // the savings account: what comes from checking, and interest every quarter
  for (let back = 7; back >= 0; back--) {
    add("sav", back, 20, 25_000, "Siirto säästötilille", { ...pekka, iban: IBAN.checking }, "transfer");
    if (back % 3 === 0) add("sav", back, 29, between(300, 800), "Tilin korko", { name: "ESIMERKKIPANKKI OYJ" }, "investment_income");
  }

  const transactions = {};
  const balances = {};
  /** What each account held before its first row: balance = opening + the booked rows, to the cent. */
  const openings = {};
  const expected = [];
  const accounts = ACCOUNTS.map((a) => {
    const history = rows[a.key].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    transactions[a.uid] = history.map((row, n) => toBank(a.uid, row, n)).reverse();
    openings[a.uid] = OPENING[a.key];
    balances[a.uid] = OPENING[a.key] + history.filter((row) => !row.pending).reduce((sum, row) => sum + row.cents, 0);
    for (const row of history) if (!row.pending) expected.push({ account: a.product, date: row.date, cents: row.cents, text: row.text, merchant: row.party.name ?? row.text, category: row.expect });
    return {
      uid: a.uid,
      identification_hash: a.hash,
      account_id: a.card ? { other: { identification: a.card, scheme_name: "CPAN" } } : { iban: a.iban },
      name: a.name,
      product: a.product,
      currency: "EUR",
      cash_account_type: a.type,
      ...(a.card ? { credit_limit: { currency: "EUR", amount: "2500.00" } } : {}),
    };
  });
  return { accounts, transactions, balances, openings, expected, pending };
}
