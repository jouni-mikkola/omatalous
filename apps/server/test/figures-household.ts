/**
 * A made-up household for the test that reads each shared figure through every page's route (figures-routes.test.ts):
 * a few rows a month, each of a kind the figures count differently. Own transfers to a savings account, a fund saving,
 * a loan payment, a card's bill paid from the checking account, a shop's refund in the month after the purchase and
 * one in the same month, friends paying their shares of a dinner,
 * money from and to people, cash, a pending card purchase in the running month and a row whose category the user set.
 * `cardSince` is the first month the card's own rows are there: before it the purchases are only its bills, as when a
 * card is connected later. Made-up names; the IBANs are the kit's examples.
 */
import { addMonths, dateIn, monthOf } from "../../../packages/core/src/dates.ts";
import type { AccountType, RawTransaction } from "../../../packages/core/src/types.ts";
import { IBAN } from "../../../packages/core/test/kit/frame.ts";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import type { setupApp } from "./helpers.ts";

export const FIGURES_TODAY = "2026-10-15";
const FIRST_MONTH = "2026-01";

type App = Awaited<ReturnType<typeof setupApp>>;

interface Row {
  account: "chk" | "sav" | "card";
  date: string;
  cents: number;
  counterparty: string;
  description?: string;
  iban?: string;
  mcc?: string;
  pending?: true;
}

const ACCOUNTS: { id: Row["account"]; name: string; iban: string | null; type: AccountType }[] = [
  { id: "chk", name: "Käyttötili", iban: IBAN.chk, type: "checking" },
  { id: "sav", name: "Säästötili", iban: IBAN.sav, type: "savings" },
  { id: "card", name: "Esimerkki Gold", iban: null, type: "credit_card" },
];

function rowsOf(cardSince: string): Row[] {
  const out: Row[] = [];
  const add = (r: Row) => out.push(r);
  const today = FIGURES_TODAY;
  const running = monthOf(today);
  for (let m = FIRST_MONTH; m <= running; m = addMonths(m, 1)) {
    const on = (day: number) => dateIn(m, day);
    const due = (day: number) => on(day) <= today;
    // the card's purchases; the filter at the end drops those before `cardSince`, so their months have the bill alone
    const buy = (day: number, cents: number, counterparty: string, mcc: string) => due(day) && add({ account: "card", date: on(day), cents, counterparty, mcc });
    if (due(1)) add({ account: "chk", date: on(1), cents: 320_000, counterparty: "ESIMERKKI OY", description: "PALKKA" });
    if (due(2)) add({ account: "chk", date: on(2), cents: -95_000, counterparty: "ASUNTO OY ESIMERKKI", description: "VUOKRA" });
    if (due(3)) {
      add({ account: "chk", date: on(3), cents: -20_000, counterparty: "MAIJA MEIKÄLÄINEN", description: "OMA SIIRTO", iban: IBAN.sav });
      add({ account: "sav", date: on(3), cents: 20_000, counterparty: "MAIJA MEIKÄLÄINEN", description: "OMA SIIRTO", iban: IBAN.chk });
    }
    if (due(8)) add({ account: "chk", date: on(8), cents: -10_000, counterparty: "NORDNET BANK AB", description: "RAHASTOSÄÄSTÖ" });
    if (due(12)) add({ account: "chk", date: on(12), cents: -2990, counterparty: "PUHELIN ESIMERKKI OYJ", description: "E-LASKU" });
    if (due(15)) add({ account: "chk", date: on(15), cents: -45_000, counterparty: "NORDEA BANK ABP", description: "LAINANMAKSU 1234567" });
    if (due(20)) add({ account: "chk", date: on(20), cents: -(5_500 + (Number(m.slice(5)) % 4) * 700), counterparty: "SÄHKÖ ESIMERKKI OY", description: "SÄHKÖLASKU" });
    for (const day of [4, 11, 18, 25]) buy(day, -4_200 - day * 10, "K-MARKET ESIMERKKI", "5411");
    buy(9, -2_600, "RAVINTOLA PIENI", "5812");
    buy(23, -2_400, "RAVINTOLA PIENI", "5812");
    // a card's bill pays the purchases of the month before: a transfer when the card's rows hold them, a bill of a card with no rows when not
    const before = addMonths(m, -1);
    if (before >= FIRST_MONTH && due(14)) {
      const cents = [4, 11, 18, 25].reduce((s, d) => s + 4_200 + d * 10, 0) + 5_000;
      add({ account: "chk", date: on(14), cents: -cents, counterparty: "ESIMERKKI RAHOITUS OY", description: "ESIMERKKI GOLD LASKU" });
      if (before >= cardSince) add({ account: "card", date: on(14), cents, counterparty: "ESIMERKKI RAHOITUS OY", description: "MAKSU, KIITOS" });
    }
  }
  // August: a purchase whose refund comes in September; September: a purchase refunded in part in the same month
  add({ account: "chk", date: "2026-08-10", cents: -8_000, counterparty: "URHEILUKAUPPA ESIMERKKI OY", mcc: "5941" });
  add({ account: "chk", date: "2026-09-12", cents: 8_000, counterparty: "URHEILUKAUPPA ESIMERKKI OY", description: "PALAUTUS" });
  add({ account: "chk", date: "2026-09-05", cents: -12_000, counterparty: "VERKKOKAUPPA ESIMERKKI OY", mcc: "5732" });
  add({ account: "chk", date: "2026-09-20", cents: 4_000, counterparty: "VERKKOKAUPPA ESIMERKKI OY", description: "HYVITYS" });
  // a dinner of 120 € and two friends paying a third each the day after
  add({ account: "chk", date: "2026-09-26", cents: -12_000, counterparty: "RAVINTOLA ISO OY", mcc: "5812" });
  add({ account: "chk", date: "2026-09-27", cents: 4_000, counterparty: "PEKKA VIRTANEN", description: "MOBILEPAY" });
  add({ account: "chk", date: "2026-09-27", cents: 4_000, counterparty: "LIISA LAINE", description: "MOBILEPAY" });
  // people and cash
  add({ account: "chk", date: "2026-09-07", cents: 5_000, counterparty: "MATTI MEIKÄLÄINEN", description: "LAHJA" });
  add({ account: "chk", date: "2026-09-16", cents: -3_000, counterparty: "KALLE KORHONEN", description: "MOBILEPAY" });
  add({ account: "chk", date: "2026-09-21", cents: -6_000, counterparty: "OTTO", description: "KÄTEISNOSTO" });
  // the running month: a card purchase still pending, and a shop's refund in the same month
  add({ account: "card", date: "2026-10-14", cents: -3_500, counterparty: "K-MARKET ESIMERKKI", mcc: "5411", pending: true });
  add({ account: "chk", date: "2026-10-06", cents: -9_000, counterparty: "VERKKOKAUPPA ESIMERKKI OY", mcc: "5732" });
  add({ account: "chk", date: "2026-10-13", cents: 9_000, counterparty: "VERKKOKAUPPA ESIMERKKI OY", description: "PALAUTUS" });
  return out.filter((r) => r.account !== "card" || r.date >= dateIn(cardSince, 1));
}

/** Loads the household for the signed-in admin and sets one row's category by hand, as Tapahtumat does. */
export async function loadFiguresHousehold(app: App, cardSince = FIRST_MONTH): Promise<void> {
  const repo = app.s.finance(app.adminId);
  const rows = rowsOf(cardSince);
  for (const a of ACCOUNTS) {
    await repo.upsertAccount({ id: a.id, connectionId: null, provider: "csv", externalId: null, identity: null, name: a.name, iban: a.iban, currency: "EUR", type: a.type });
    const raws = rows.filter((r) => r.account === a.id).map(
      (r): RawTransaction => ({
        externalId: null, bookingDate: r.date, valueDate: null, amountCents: r.cents, currency: "EUR", status: r.pending ? "pending" : "booked",
        counterparty: r.counterparty, counterpartyIban: r.iban ?? null, description: r.description ?? null, reference: null, mcc: r.mcc ?? null,
      }),
    );
    await ingestTransactions(repo, a.id, raws, "csv");
    await repo.setAccountBalance(a.id, a.id === "chk" ? 250_000 : a.id === "sav" ? 400_000 : -60_000, `${FIGURES_TODAY}T08:00:00.000Z`);
  }
  await reprocess(repo, app.s.settings);
  // the user moves the second dinner of September from restaurants to groceries
  const listed = (await app.admin.call("GET", "/api/transactions?from=2026-09-23&to=2026-09-23")).body.items as { id: string; merchant: string }[];
  const dinner = listed.find((t) => t.merchant.toUpperCase().includes("RAVINTOLA PIENI"));
  if (!dinner) throw new Error("figures household: the dinner of 23.9. is missing");
  const set = await app.admin.call("PATCH", `/api/transactions/${dinner.id}`, { category: "groceries" });
  if (set.status !== 200) throw new Error(`figures household: the category was not set (${set.status})`);
}
