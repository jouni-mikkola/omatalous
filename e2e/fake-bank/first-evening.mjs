/**
 * The household of the "first evening" check: a made-up couple's checking account, savings account and credit card, a year
 * (12 months) of rows, each with the category a reader of the row expects. The people, the employer and the IBANs are made up;
 * the shops and services are real trade names, because the rules read those. The check (e2e/first-evening/) compares what
 * the app made of every row with `expect` here, by value.
 *
 * Like household.mjs it is seeded: one day always gives the same rows. Rows are { date, cents, text, party, expect, ... }
 * with money signed (negative = out).
 */

/** The months of rows: a year, what a household has when it first links a bank (Enable Banking gives more). */
const MONTHS = 12;

const IBAN = {
  checking: "FI3812345600001119",
  savings: "FI6012345600001127",
  employer: "FI2712345600001135",
  landlord: "FI8912345600001143",
  cardBill: "FI4412345600001151",
  friend: "FI1512345600001168",
  kela: "FI9012345600001176",
  tax: "FI5812345600001184",
};

const OPENING = { chk: 150_000, sav: 800_000, card: 0 };

const ACCOUNTS = [
  { key: "chk", uid: "fe-chk", hash: "fe-hash-chk", name: "VIRTANEN VEERA", product: "Käyttötili", type: "CACC", iban: IBAN.checking },
  { key: "sav", uid: "fe-sav", hash: "fe-hash-sav", name: "VIRTANEN VEERA", product: "Säästötili", type: "SVGS", iban: IBAN.savings },
  { key: "card", uid: "fe-card", hash: "fe-hash-card", name: "VIRTANEN VEERA", product: "ESIMERKKIPANKKI Luottokortti", type: "CARD", card: "5225********7788" },
];

/** [merchant, mcc, category, low, high] of a card purchase: what the household buys with its cards now and then. */
const CARD_SHOPS = [
  ["K-MARKET KAMPPI", "5411", "groceries", 1500, 9500],
  ["S-MARKET HERTTONIEMI", "5411", "groceries", 2000, 11_000],
  ["LIDL SUOMI KY", "5411", "groceries", 1800, 8500],
  ["PRISMA ITAKESKUS", "5411", "groceries", 3000, 14_000],
  ["HESBURGER", "5814", "restaurants", 900, 2400],
  ["RAVINTOLA NOKKA", "5812", "restaurants", 3500, 9500],
  ["ESPRESSO HOUSE", "5814", "restaurants", 400, 1100],
  ["WOLT", "5812", "food_delivery", 1800, 3800],
  ["ALKO", "5921", "alcohol", 1500, 6500],
  ["HELSINGIN SEUDUN LIIKENNE HSL", "4111", "transport", 300, 5800],
  ["VR", "4112", "transport", 1200, 6000],
  ["NESTE KAMPPI", "5541", "car", 4500, 8500],
  ["ABC LAAJASALO", "5541", "car", 3500, 7500],
  ["APTEEKKI ITIS", "5912", "health", 800, 4500],
  ["ZALANDO", "5651", "shopping", 3500, 12_000],
  ["H&M HENNES MAURITZ", "5651", "shopping", 2500, 8000],
  ["TOKMANNI", "5311", "shopping", 1200, 5500],
  ["VERKKOKAUPPA.COM", "5732", "home", 2500, 25_000],
  ["IKEA", "5712", "home", 2500, 18_000],
  ["MUSTI JA MIRRI", "5995", "pets", 1800, 6500],
  ["KAMPAAMO HIUSTALO", "7230", "personal_care", 4500, 9000],
  ["SYNSAM OPTIIKKA", "8043", "health", 9000, 26_000],
  ["EASYPARK", "7523", "car", 300, 1500],
  ["BOLT RIDES", "4121", "transport", 900, 2600],
  ["FINNAIR", "4511", "travel", 12_000, 38_000],
  ["BOOKING.COM", "7011", "travel", 15_000, 42_000],
  ["KANSALAISOPISTO", "8220", "education", 3000, 9000],
  ["SEPPALA", "5651", "shopping", 2500, 9000],
  ["CITYMARKET HERTTONIEMI", "5411", "groceries", 2500, 12_000],
  ["WILLA AJOKORTTI", "5812", "restaurants", 1500, 4200],
  ["KOTIPIZZA", "5812", "restaurants", 1800, 3600],
  ["FOODORA", "5812", "food_delivery", 1900, 3900],
  ["FINNKINO", "7832", "entertainment", 1400, 3200],
  ["VEIKKAUS", "7995", "gambling", 500, 2500],
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

function toBank(uid, row, n) {
  const out = row.cents < 0;
  const side = out ? "creditor" : "debtor";
  return {
    entry_reference: `${uid}-${String(n).padStart(4, "0")}`,
    transaction_amount: { currency: "EUR", amount: (Math.abs(row.cents) / 100).toFixed(2) },
    credit_debit_indicator: out ? "DBIT" : "CRDT",
    status: "BOOK",
    booking_date: row.date,
    value_date: row.date,
    [side]: { name: row.party.name },
    ...(row.party.iban ? { [`${side}_account`]: { iban: row.party.iban } } : {}),
    remittance_information: [row.text],
    reference_number: row.ref ?? null,
    merchant_category_code: row.mcc ?? null,
    bank_transaction_code: { code: "PMNT", sub_code: row.mcc ? "CCRD-POSD" : out ? "ICDT-ESCT" : "RCDT-ESCT" },
  };
}

/** The accounts, the bank's answers about them and the expected category of every row, for the day `today` (YYYY-MM-DD). */
export function firstEvening(today) {
  const random = seeded(20261030);
  const between = (low, high) => low + Math.floor(random() * (high - low + 1));
  const rows = { chk: [], sav: [], card: [] };
  const add = (account, back, day, cents, text, party, expect, extra = {}) => {
    const date = dayOf(today, back, day);
    if (date <= today) rows[account].push({ date, cents, text, party, expect, ...extra });
  };
  const veera = { name: "VIRTANEN VEERA" };

  let cardBill = 0;
  for (let back = MONTHS - 1; back >= 0; back--) {
    const month = dayOf(today, back, 1).slice(0, 7);

    add("chk", back, 25, 312_000, `PALKKA ${month}`, { name: "ESIMERKKI OY", iban: IBAN.employer }, "salary");
    add("chk", back, 2, -92_000, `VUOKRA ${month}`, { name: "ESIMERKKI ASUNNOT OY", iban: IBAN.landlord }, "housing", { ref: "1234561" });
    add("chk", back, 9, -between(5500, 9500), "SAHKOLASKU", { name: "HELEN OY" }, "utilities");
    add("chk", back, 11, -2990, "LIITTYMA", { name: "ELISA OYJ" }, "telecom");
    add("chk", back, 12, -2490, "NETTILIITTYMA", { name: "DNA OYJ" }, "telecom");
    add("chk", back, 15, -4850, "KOTIVAKUUTUS", { name: "IF VAKUUTUS" }, "insurance");
    add("chk", back, 16, -3900, "JASENMAKSU", { name: "FITNESS24 SUOMI OY" }, "fitness");
    add("chk", back, 18, -1299, "SUORAMAKSU", { name: "NETFLIX INTERNATIONAL B.V." }, "subscriptions", { mcc: "4899" });
    add("chk", back, 19, -1099, "SUORAMAKSU", { name: "SPOTIFY" }, "subscriptions", { mcc: "5815" });
    add("chk", back, 27, -30_000, "SAASTOON", { ...veera, iban: IBAN.savings }, "transfer");
    add("chk", back, 28, -150, "TILINHOITOMAKSU", { name: "ESIMERKKIPANKKI OYJ" }, "fees");
    if (back % 3 === 1) add("chk", back, 20, -between(9000, 14_000), "AUTOVERO", { name: "VEROHALLINTO", iban: IBAN.tax }, "taxes");
    if (back === 4) add("chk", back, 7, 38_000, "VEROJEN PALAUTUS", { name: "VEROHALLINTO", iban: IBAN.tax }, "tax_refund");
    add("chk", back, 3, -18_900, "LAINAN ERA", { name: "NORDEA RAHOITUS SUOMI OY" }, "loans", { ref: "7788991" });
    add("chk", back, 28, -20_000, "KUUKAUSISAASTO", { name: "NORDNET BANK AB" }, "investments");
    add("chk", back, 10, -between(1800, 3200), "VESILASKU", { name: "HSY HELSINGIN SEUDUN YMPARISTOPALVELUT" }, "utilities");
    if (back % 3 === 2) add("chk", back, 22, -2500, "LAHJOITUS", { name: "UNICEF SUOMI" }, "gifts_donations");
    if (back % 2 === 1) add("chk", back, 24, between(2000, 8000), "MATKALASKU", { name: "ESIMERKKI OY", iban: IBAN.employer }, "reimbursements");
    if (back % 2 === 0) add("chk", back, 17, between(2000, 6000), "MOBILEPAY", { name: "VIRTANEN JAAKKO" }, "p2p_in");
    add("chk", back, 7, 14_800, "LAPSILISA", { name: "KELA", iban: IBAN.kela }, "benefits");
    add("chk", back, 5, -between(1500, 6000), "MOBILEPAY", { name: "VIRTANEN JAAKKO" }, "p2p");
    if (back % 2 === 0) add("chk", back, 13, -between(5000, 10_000), "NOSTO AUTOMAATILTA", { name: "AUTOMAATTINOSTO" }, "cash", { mcc: "6011" });
    if (back === 2) add("chk", back, 21, -22_000, "PAIVAKOTI", { name: "ESIMERKKI PAIVAKOTI OY" }, "kids");

    if (cardBill > 0) {
      add("chk", back, 5, -cardBill, "LUOTTOKORTIN LASKU", { name: "ESIMERKKIPANKKI OYJ", iban: IBAN.cardBill }, "transfer", { ref: "246801357" });
      add("card", back, 6, cardBill, "LASKUN MAKSU", { ...veera, iban: IBAN.checking }, "transfer");
    }
    const before = rows.card.length;
    // each purchase is made distinct (day and cents), so a row is found again by its date and amount
    const used = new Set();
    for (let i = 0; i < 24; i++) {
      const [name, mcc, category, low, high] = CARD_SHOPS[between(0, CARD_SHOPS.length - 1)];
      const day = between(1, 28);
      let cents = -between(low, high);
      while (used.has(`${day}|${cents}`)) cents -= 1;
      used.add(`${day}|${cents}`);
      // banks word card rows differently, and a card row does not always carry the merchant category code
      const text = ["KORTTIOSTO", `OSTO ${name}`, `Visa-osto ${name} HELSINKI`][between(0, 2)];
      add("card", back, day, cents, text, { name }, category, between(0, 9) < 6 ? { mcc } : {});
    }
    cardBill = -rows.card.slice(before).reduce((sum, row) => sum + row.cents, 0);
  }
  // the savings account: what comes from checking, and interest every quarter
  for (let back = MONTHS - 1; back >= 0; back--) {
    add("sav", back, 27, 30_000, "SAASTOON", { ...veera, iban: IBAN.checking }, "transfer");
    if (back % 3 === 0) add("sav", back, 29, between(400, 900), "TILIN KORKO", { name: "ESIMERKKIPANKKI OYJ" }, "investment_income");
  }

  const transactions = {};
  const balances = {};
  /** What each account held before its first row: balance = opening + the rows, to the cent. */
  const openings = {};
  const expected = [];
  const accounts = ACCOUNTS.map((a) => {
    const history = rows[a.key].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    transactions[a.uid] = history.map((row, n) => toBank(a.uid, row, n)).reverse();
    openings[a.uid] = OPENING[a.key];
    balances[a.uid] = OPENING[a.key] + history.reduce((sum, row) => sum + row.cents, 0);
    for (const row of history) expected.push({ account: a.product, date: row.date, cents: row.cents, text: row.text, merchant: row.party.name, category: row.expect });
    return {
      uid: a.uid,
      identification_hash: a.hash,
      account_id: a.card ? { other: { identification: a.card, scheme_name: "CPAN" } } : { iban: a.iban },
      name: a.name,
      product: a.product,
      currency: "EUR",
      cash_account_type: a.type,
      ...(a.card ? { credit_limit: { currency: "EUR", amount: "4000.00" } } : {}),
    };
  });
  return { accounts, transactions, balances, openings, expected };
}
