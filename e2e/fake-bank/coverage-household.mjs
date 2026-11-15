/**
 * A made-up household that leaves three things out, for the coverage notices (e2e/coverage-notices.spec.ts): a checking
 * account with only three months of history, a bill of a credit card that is not connected (the purchases behind it are
 * never seen) and one row in dollars, which the app keeps apart from the euros. Seeded by the day like the others: one
 * day always gives the same rows. `expected` holds the sums the notices must tell, from the rows made here.
 */

const IBAN = {
  checking: "FI6012345600000850",
  cardBill: "FI3312345600000868",
  employer: "FI8312345600000876",
};

const OPENING = 80_000;

/** Day `day` of the month `back` months before the month of `today`. */
const dayOf = (today, back, day) => {
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 - back, day)).toISOString().slice(0, 10);
};

function toBank(uid, row, n) {
  const out = row.cents < 0;
  const side = out ? "creditor" : "debtor";
  return {
    entry_reference: `${uid}-${String(n).padStart(4, "0")}`,
    transaction_amount: { currency: row.currency ?? "EUR", amount: (Math.abs(row.cents) / 100).toFixed(2) },
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

/** The account, the bank's answers about it and the sums the notices must tell, for the day `today` (YYYY-MM-DD). */
export function coverageHousehold(today) {
  const rows = [];
  const add = (back, day, cents, text, party, extra = {}) => {
    const date = dayOf(today, back, day);
    if (date <= today) rows.push({ date, cents, text, party, ...extra });
  };
  const me = { name: "VIRTANEN OSKARI" };
  const bills = [];
  // three complete months before this one, and the part of this one gone by
  for (let back = 3; back >= 0; back--) {
    add(back, 25, 260_000, "PALKKA", { name: "ESIMERKKI TYONANTAJA OY", iban: IBAN.employer });
    add(back, 3, -72_000, "VUOKRA", { name: "ESIMERKKI KIINTEISTOT OY" }, { ref: "4455661" });
    add(back, 9, -(5500 + back * 130), "RUOKAOSTOS", { name: "ESIMERKKI MARKET" }, { mcc: "5411" });
    add(back, 12, -(3200 + back * 90), "KAHVILA", { name: "ESIMERKKI KAHVILA" }, { mcc: "5812" });
    // the card behind this bill is not connected: the bill is the only row the app ever sees of its purchases
    if (back >= 1) {
      const cents = -(41_000 + back * 1700);
      add(back, 5, cents, "LUOTTOKORTIN LASKU", { name: "ESIMERKKIPANKKI OYJ", iban: IBAN.cardBill }, { ref: "135792468" });
      bills.push({ date: dayOf(today, back, 5), cents: -cents });
    }
  }
  // one purchase in dollars, 20,00 USD, in the newest complete month
  add(1, 15, -2000, "ESIMERKKI INC", { name: "ESIMERKKI INC" }, { currency: "USD" });

  const uid = "cov-chk";
  const history = rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const eur = history.filter((r) => (r.currency ?? "EUR") === "EUR");
  const accounts = [{ uid, identification_hash: "cov-hash-chk", account_id: { iban: IBAN.checking }, name: me.name, product: "Käyttötili", currency: "EUR", cash_account_type: "CACC" }];
  const transactions = { [uid]: history.map((row, n) => toBank(uid, row, n)).reverse() };
  const balances = { [uid]: OPENING + eur.reduce((sum, row) => sum + row.cents, 0) };
  const openings = { [uid]: OPENING };
  return { accounts, transactions, balances, openings, expected: { bills, dollars: { cents: 2000, day: dayOf(today, 1, 15) }, firstDay: history[0].date } };
}
