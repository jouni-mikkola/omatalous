/**
 * Loans rows: a 900 € mortgage payment to the own loan account on the 5th, and a credit card with four purchases a
 * week apart, the bill paid on the 25th and 15 € of interest on the 28th. The hit has a margin of 1,10 % over 12
 * month Euribor, 15 000 € saved and 30 000 € on checking, so the card's debt was always covered.
 */
import { createContext } from "../../../src/analysis/context.ts";
import { addDays, addMonths } from "../../../src/dates.ts";
import type { InputValues, LoanReference } from "../../../src/optimise/types.ts";
import { bufferReport } from "../../../src/reports/buffer.ts";
import type { Account, BalanceInput, Transaction } from "../../../src/types.ts";
import { baseRows, enrich, type Frame, type Part, type PartHousehold } from "../household.ts";

const LOAN: Account = { id: "l-loan", name: "Asuntolaina", iban: "FI5512345600000123", currency: "EUR", type: "loan" };
const CARD: Account = { id: "l-card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
const SHOPS = ["Tokmanni", "Clas Ohlson", "Motonet", "Biltema"];

interface Rows {
  mortgage: boolean;
  card: boolean;
  /** Card interest every month; without it the card only has purchases and bills. */
  interest: boolean;
}

function rows(frame: Frame, o: Rows): Transaction[] {
  const out: Transaction[] = [];
  const add = (p: Partial<Transaction> & Pick<Transaction, "bookingDate" | "amountCents" | "merchant">) => {
    if (p.bookingDate > frame.today) return;
    out.push({
      id: `l-${String(out.length).padStart(5, "0")}`,
      accountId: "h-chk",
      currency: "EUR",
      status: "booked",
      counterparty: null,
      counterpartyIban: null,
      description: null,
      mcc: null,
      category: "other",
      categorySource: "default",
      isTransfer: false,
      ...p,
    });
  };
  let lastInterest = 0;
  for (const [i, month] of [...frame.months, addMonths(frame.months[frame.months.length - 1]!, 1)].entries()) {
    const on = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
    if (o.mortgage) add({ bookingDate: on(5), amountCents: -90000, merchant: "Nordea", description: "ASUNTOLAINA", counterpartyIban: LOAN.iban });
    if (!o.card) continue;
    let purchases = 0;
    for (const [k, d] of [2, 9, 16, 23].entries()) {
      const shop = SHOPS[(i + k) % SHOPS.length]!;
      const amount = 3000 + ((i * 7 + k * 13) % 9) * 500;
      purchases += amount;
      add({ bookingDate: on(d), amountCents: -amount, merchant: shop, description: shop.toUpperCase(), accountId: CARD.id });
    }
    // the bill pays the month's purchases and last month's interest, so the card's debt stays where it was
    const bill = purchases + lastInterest;
    add({ bookingDate: on(25), amountCents: -bill, merchant: "Luottokortti", description: "LUOTTOKORTIN LASKU" });
    add({ bookingDate: on(25), amountCents: bill, merchant: "Luottokortti", description: "MAKSU KIITOS", accountId: CARD.id });
    lastInterest = o.interest ? 1500 : 0;
    if (o.interest) add({ bookingDate: on(28), amountCents: -1500, merchant: "Luottokorko", description: "LUOTTOKORKO", accountId: CARD.id });
  }
  return out;
}

const balance = (frame: Frame, id: string, name: string, type: Account["type"], cents: number): BalanceInput => ({
  id,
  name,
  type,
  balanceCents: cents,
  ownerName: null,
  balanceAt: addDays(frame.today, -1),
});

const loanRate = (frame: Frame, marginBp: number, reference: LoanReference): InputValues => ({ loan_rate: { value: { marginBp, reference }, asOf: addDays(frame.today, -30) } });

/** A household with the mortgage, savings of `sav` cents and the rate given. */
function mortgaged(frame: Frame, o: Rows & { marginBp: number; reference: LoanReference; sav: number }): PartHousehold {
  return {
    txs: rows(frame, o),
    accounts: o.card ? [LOAN, CARD] : [LOAN],
    balances: [
      balance(frame, LOAN.id, LOAN.name, "loan", -15000000),
      ...(o.card ? [balance(frame, CARD.id, CARD.name, "credit_card", -120000)] : []),
      balance(frame, "h-chk", "Käyttötili", "checking", 3000000),
      balance(frame, "h-sav", "Säästötili", "savings", o.sav),
    ],
    values: loanRate(frame, o.marginBp, o.reference),
  };
}

/** Usual spending of the base with these rows, as the buffer report counts it. */
function usualWith(frame: Frame, txs: readonly Transaction[], accounts: readonly Account[]): number {
  const all = [...frame.accounts, ...accounts];
  const sorted = [...baseRows(frame), ...txs].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || (a.id < b.id ? -1 : 1));
  return bufferReport(createContext(enrich(sorted, all), all, frame.today), []).usualSpendCents!;
}

export const hit: Part["hit"] = (frame) => mortgaged(frame, { mortgage: true, card: true, interest: true, marginBp: 110, reference: "euribor_12", sav: 1500000 });

export const nearMiss: Part["nearMiss"] = (frame) => {
  const plain = { mortgage: true, card: false, interest: false };
  // savings of three months of spending and 1 900 €, at a margin under the offers' top
  const excess = mortgaged(frame, { ...plain, marginBp: 60, reference: "euribor_12", sav: 0 });
  const sav = 3 * usualWith(frame, excess.txs, excess.accounts!) + 190000;
  excess.balances = excess.balances!.map((b) => (b.id === "h-sav" ? { ...b, balanceCents: sav } : b));
  return [
    // 0,9 %: 0,1 points over the offers' top; the savings stay within three months of spending
    mortgaged(frame, { ...plain, marginBp: 90, reference: "euribor_12", sav: 300000 }),
    // a fixed rate is neither compared nor prepaid
    mortgaged(frame, { ...plain, marginBp: 150, reference: "fixed", sav: 1500000 }),
    excess,
    // card interest every month, but the checking account of the base never held the card's debt at both ends of one
    { txs: rows(frame, { mortgage: false, card: true, interest: true }), accounts: [CARD], balances: [balance(frame, CARD.id, CARD.name, "credit_card", -120000)] },
  ];
};

export const neutralValues: InputValues = { loan_rate: { value: { marginBp: 60, reference: "euribor_12" }, asOf: "2025-10-20" } };
