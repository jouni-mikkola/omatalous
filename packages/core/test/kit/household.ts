/**
 * A steady Nordea household of 30 months: two adults and a child in a rented flat in Helsinki with a mortgage on a
 * cottage. Pay on the 25th (the Friday before when it is a weekend) with holiday pay in June, rent, a loan instalment,
 * the day-care fee eleven months a year, a seasonal electricity bill, a phone, a newspaper, two streaming services,
 * home insurance every quarter, a monthly move to savings with yearly interest, and card spending whose visits and
 * tickets follow a noise model, with fewer groceries and more restaurants each July. The Gold card's bill for the
 * month before is paid from checking on the 10th. Nothing in it changes: every change is a life event (events/*.ts).
 */
import { addDays, daysInMonth, monthOf } from "../../src/dates.ts";
import { NO_INPUTS, type Transaction } from "../../src/types.ts";
import { byDateAndId, type Household } from "../../../../tools/findings/households.ts";
import { ACCOUNTS, banking, frameOf, IBAN, rows } from "./frame.ts";
import { noise, type NoiseModel } from "./noise.ts";

/** Card shops by habit: visits a month, mean ticket, the share of visits in July, the texts Nordea shows and the MCC. */
const HABITS: readonly { lambda: number; meanCents: number; july: number; texts: readonly string[]; mcc: string }[] = [
  { lambda: 16, meanCents: 4800, july: 0.6, texts: ["K-CITYMARKET HELSINKI RUOHOLAHTI", "S-MARKET KALLIO HELSINKI", "LIDL HELSINKI-SORNAINEN"], mcc: "5411" },
  { lambda: 3, meanCents: 3100, july: 1, texts: ["WOLT HELSINKI FI"], mcc: "5814" },
  { lambda: 2, meanCents: 4500, july: 1.5, texts: ["RAVINTOLA SAVOTTA HELSINKI", "HESBURGER KAMPPI"], mcc: "5812" },
  { lambda: 6, meanCents: 680, july: 0.5, texts: ["ESPRESSO HOUSE KAMPPI", "ROBERTS COFFEE CITY"], mcc: "5814" },
  { lambda: 2, meanCents: 6800, july: 1.3, texts: ["NESTE EXPRESS HELSINKI", "ST1 HELSINKI MALMI"], mcc: "5542" },
  { lambda: 1, meanCents: 1900, july: 1, texts: ["YLIOPISTON APTEEKKI HELSINKI"], mcc: "5912" },
  { lambda: 0.7, meanCents: 5500, july: 1, texts: ["ZALANDO SE BERLIN DE", "KAPPAHL HELSINKI"], mcc: "5651" },
];

export const HISTORY_MONTHS = 30;
export const RENT_CENTS = 105_000;
export const PAY_CENTS = 352_000;
/** The fee of the reviewer's case in duties.test.ts. */
export const DAYCARE_CENTS = 27_990;
const SAVINGS_START_CENTS = 800_000;

/** The Nordea Gold bill: each month's card charges paid from checking on the 10th of the next month. */
export const BILL_TEXTS = { chk: "NORDEA GOLD LASKU", card: "MAKSU, KIITOS" } as const;

/** A steady household judged on `today`, its card spending drawn from `seed` and `model`. */
export function steadyHousehold(seed: number, model: NoiseModel, today: string, name = `steady:${model}:${seed}`): Household {
  return householdOf(name, today, withCardBills(steadyRows(seed, model, today), today));
}

/** The household's rows before the card bills (`withCardBills`), so an event's card rows land on the right bill. */
export function steadyRows(seed: number, model: NoiseModel, today: string): Transaction[] {
  const f = frameOf(today, HISTORY_MONTHS);
  const n = noise(seed, model);
  const { out, add } = rows("s", today);
  let savings = SAVINGS_START_CENTS;
  for (const m of f.months) {
    const july = m.endsWith("-07");
    add({ date: banking(f.on(m, 25), addDays), cents: PAY_CENTS, counterparty: "ACME OY", description: "PALKKA" });
    if (m.endsWith("-06")) add({ date: banking(f.on(m, 25), addDays), cents: 176_000, counterparty: "ACME OY", description: "LOMARAHA" });
    add({ date: f.on(m, 2), cents: -RENT_CENTS, counterparty: "SATO OYJ", description: "VUOKRA 4471" });
    add({ date: f.on(m, 5), cents: -61_240, counterparty: "NORDEA BANK ABP", description: "LAINANLYHENNYS 1234567", iban: IBAN.loan });
    // Helsinki charges the day-care fee for eleven months: July is free
    if (!july) add({ date: f.on(m, 8), cents: -DAYCARE_CENTS, counterparty: "HELSINGIN KAUPUNKI", description: "VARHAISKASVATUSMAKSU" });
    const winter = ["01", "02", "03", "11", "12"].includes(m.slice(5));
    add({ date: f.on(m, 12), cents: -n.jitter(winter ? 11_500 : 4_500, 0.15), counterparty: "HELEN OY", description: "SÄHKÖLASKU" });
    add({ date: f.on(m, 18), cents: -3290, counterparty: "SANOMA MEDIA FINLAND OY", description: "HELSINGIN SANOMAT DIGI" });
    add({ date: f.on(m, 20), cents: -1990, counterparty: "ELISA OYJ", description: "E-LASKU" });
    if (["01", "04", "07", "10"].includes(m.slice(5))) add({ date: f.on(m, 5), cents: -14_230, counterparty: "IF VAHINKOVAKUUTUS OY", description: "VAKUUTUSMAKSU" });
    add({ date: f.on(m, 26), cents: -30_000, counterparty: "MATTI MEIKÄLÄINEN", description: "OMA SIIRTO", iban: IBAN.sav });
    add({ date: f.on(m, 26), cents: 30_000, counterparty: "MATTI MEIKÄLÄINEN", description: "OMA SIIRTO", iban: IBAN.chk, account: "sav" });
    savings += 30_000;
    if (m.endsWith("-12")) {
      const interest = Math.round(savings * 0.01);
      add({ date: f.on(m, 31), cents: interest, description: "KORKO", account: "sav" });
      add({ date: f.on(m, 31), cents: -Math.round(interest * 0.3), description: "LÄHDEVERO", account: "sav" });
    }
    add({ date: f.on(m, 12), cents: -1199, description: "PAYPAL *SPOTIFY 35314369001 STOCKHOLM SE", account: "card" });
    add({ date: f.on(m, 14), cents: -1599, description: "NETFLIX.COM LOS GATOS NL", mcc: "4899", account: "card" });
    for (const h of HABITS) {
      const count = n.visits(h.lambda * (july ? h.july : 1));
      for (let v = 0; v < count; v++) {
        const date = f.on(m, 1 + Math.floor(n.next() * daysInMonth(m)));
        add({ date, cents: -n.ticket(h.meanCents), description: h.texts[Math.floor(n.next() * h.texts.length)]!, mcc: h.mcc, account: "card" });
      }
    }
  }
  return out;
}

/** The rows with each month's card bill paid on the 10th of the next. */
export function withCardBills(txs: readonly Transaction[], today: string): Transaction[] {
  const f = frameOf(today, HISTORY_MONTHS);
  const charged = new Map<string, number>();
  for (const t of txs) if (t.accountId === "card" && t.amountCents < 0) charged.set(monthOf(t.bookingDate), (charged.get(monthOf(t.bookingDate)) ?? 0) - t.amountCents);
  const { out, add } = rows("bill", today);
  for (const [i, m] of f.months.entries()) {
    const bill = i > 0 ? charged.get(f.months[i - 1]!) : undefined;
    if (!bill) continue;
    add({ date: f.on(m, 10), cents: -bill, counterparty: "NORDEA RAHOITUS SUOMI OY", description: BILL_TEXTS.chk });
    add({ date: f.on(m, 10), cents: bill, counterparty: "NORDEA RAHOITUS SUOMI OY", description: BILL_TEXTS.card, account: "card" });
  }
  return [...txs, ...out];
}

/** The rows as a household: sorted as the server reads them, with balances on `today`. */
export function householdOf(name: string, today: string, txs: Transaction[]): Household {
  const sum = (account: string) => txs.filter((t) => t.accountId === account).reduce((s, t) => s + t.amountCents, 0);
  return {
    name,
    today,
    txs: byDateAndId(txs),
    accounts: ACCOUNTS,
    balances: [
      { id: "chk", name: "Käyttötili", type: "checking", balanceCents: 240_000, ownerName: null, balanceAt: today },
      { id: "sav", name: "Säästötili", type: "savings", balanceCents: SAVINGS_START_CENTS + sum("sav"), ownerName: null, balanceAt: today },
      { id: "card", name: "Nordea Gold", type: "credit_card", balanceCents: sum("card"), ownerName: null, balanceAt: today },
      { id: "loan", name: "Asuntolaina", type: "loan", balanceCents: null, ownerName: null, balanceAt: today },
    ],
    rules: [],
    inputs: NO_INPUTS,
    values: {},
    industry: new Map(),
  };
}
