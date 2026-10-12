/**
 * The household the fake bank knows: made up, and built from a seed, so one day always gives the same rows. Rows are
 * kept as { date, cents, text, ... } with money in positive, and turned into the bank's own shape at the end.
 */

const IBAN = {
  checking: "FI2112345600000785",
  savings: "FI1410093000123458",
  joint: "FI9612345600000793",
  mortgage: "FI7412345600000801",
  cardBill: "FI7312345600000819",
  employer: "FI5112345600000827",
  elisa: "FI2912345600000835",
};

/** Cents in the account before the first row. */
const OPENING = { chk: 120_000, sav: 450_000, joint: 40_000, card: 0 };

const ACCOUNTS = [
  { key: "chk", uid: "fb-chk", hash: "fb-hash-chk", name: "MEIKALAINEN MATTI", product: "Käyttötili", type: "CACC", iban: IBAN.checking },
  { key: "sav", uid: "fb-sav", hash: "fb-hash-sav", name: "MEIKALAINEN MATTI", product: "Säästötili", type: "SVGS", iban: IBAN.savings },
  { key: "joint", uid: "fb-joint", hash: "fb-hash-joint", name: "MEIKALAINEN MATTI;KORHONEN ELISA", product: "Yhteistili", type: "CACC", iban: IBAN.joint },
  { key: "card", uid: "fb-card", hash: "fb-hash-card", name: "MEIKALAINEN MATTI", product: "ESIMERKKIPANKKI Luottokortti", type: "CARD", card: "5225********4321" },
];

const SHOPS = ["ESIMERKKI MARKET", "KAUPPA ESIMERKKI"];
const SPENDING = ["ESIMERKKI KAHVILA", "ESIMERKKI RAVINTOLA", "ESIMERKKI VAATE", "ESIMERKKI BENSA", "ESIMERKKI APTEEKKI"];

/** A small seeded generator (mulberry32): the same seed gives the same numbers on every machine. */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Day `day` (1 to 28) of the month `back` months before the month of `today`, as YYYY-MM-DD. */
const dayOf = (today, back, day) => {
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 - back, day)).toISOString().slice(0, 10);
};

/** A row as the bank sends it. `n` is its place in the account's history, which makes the reference stable. */
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

/** The accounts the household has and the bank's answers about them, for the day `today` (YYYY-MM-DD). */
export function household(today) {
  const random = seeded(20261012);
  const between = (low, high) => low + Math.floor(random() * (high - low + 1));
  const pick = (list) => list[between(0, list.length - 1)];
  const rows = { chk: [], sav: [], joint: [], card: [] };
  const add = (account, back, day, cents, text, party, extra = {}) => {
    const date = dayOf(today, back, day);
    if (date <= today) rows[account].push({ date, cents, text, party, ...extra });
  };

  let cardBill = 0;
  // fourteen months, the oldest first
  for (let back = 13; back >= 0; back--) {
    const month = dayOf(today, back, 1).slice(0, 7);
    const me = { name: "MEIKALAINEN MATTI" };

    add("chk", back, 25, 315_000, `PALKKA ${month}`, { name: "ESIMERKKI OY", iban: IBAN.employer });
    add("chk", back, 1, -60_000, "YHTEISTILILLE", { ...me, iban: IBAN.joint });
    add("chk", back, 26, -20_000, "SAASTOON", { ...me, iban: IBAN.savings });
    add("chk", back, 8, -between(7000, 12_000), "SAHKOLASKU", { name: "ESIMERKKI SAHKO OY" });
    add("chk", back, 10, -6400, "VAKUUTUS", { name: "ESIMERKKI VAKUUTUS OY" });
    add("chk", back, 12, -1990, "PUHELINLIITTYMA", { name: "ESIMERKKI TELE OY" });
    for (let i = 0; i < 4; i++) add("chk", back, between(2, 28), -between(800, 6000), "KORTTIOSTO", { name: pick(SPENDING) }, { mcc: "5499" });

    add("sav", back, 26, 20_000, "SAASTOON", { ...me, iban: IBAN.checking });
    if (back % 3 === 0) add("sav", back, 28, between(300, 500), "TILIN KORKO", { name: "ESIMERKKIPANKKI OYJ" });

    // 600,00 from him on the 1st and 400,00 from her on the 2nd pay the mortgage and the groceries
    add("joint", back, 1, 60_000, "KOTITALOUS", { ...me, iban: IBAN.checking });
    add("joint", back, 2, 40_000, "KOTITALOUS", { name: "KORHONEN ELISA", iban: IBAN.elisa });
    add("joint", back, 3, -65_000, "LAINAN LYHENNYS", { name: "ESIMERKKIPANKKI OYJ", iban: IBAN.mortgage }, { ref: "246813579" });
    for (let i = 0; i < 8; i++) add("joint", back, between(2, 28), -between(1200, 5800), "KORTTIOSTO", { name: pick(SHOPS) }, { mcc: "5411" });

    // last month's card purchases are paid from the checking account on the 5th, and the card takes the payment on the 6th
    if (cardBill > 0 && dayOf(today, back, 6) <= today) {
      add("chk", back, 5, -cardBill, "LUOTTOKORTIN LASKU", { name: "ESIMERKKIPANKKI OYJ", iban: IBAN.cardBill }, { ref: "135792468" });
      add("card", back, 6, cardBill, "LASKUN MAKSU", { ...me, iban: IBAN.checking });
    }
    const before = rows.card.length;
    add("card", back, 2, -1299, "ESIMERKKI STREAMING", { name: "ESIMERKKI STREAMING" }, { mcc: "4899" });
    for (let i = 0; i < 10; i++) add("card", back, between(1, 28), -between(600, 14_000), "KORTTIOSTO", { name: pick(SPENDING) }, { mcc: "5812" });
    cardBill = -rows.card.slice(before).reduce((sum, row) => sum + row.cents, 0);
  }

  const transactions = {};
  const balances = {};
  const accounts = ACCOUNTS.map((a) => {
    const history = rows[a.key].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    // newest first, as banks answer
    transactions[a.uid] = history.map((row, n) => toBank(a.uid, row, n)).reverse();
    balances[a.uid] = OPENING[a.key] + history.reduce((sum, row) => sum + row.cents, 0);
    return {
      uid: a.uid,
      identification_hash: a.hash,
      account_id: a.card ? { other: { identification: a.card, scheme_name: "CPAN" } } : { iban: a.iban },
      name: a.name,
      product: a.product,
      currency: "EUR",
      cash_account_type: a.type,
      ...(a.card ? { credit_limit: { currency: "EUR", amount: "3000.00" } } : {}),
    };
  });
  return { accounts, transactions, balances };
}
