/**
 * A made-up household for the tests that hold the sums of a page to the flows of the same rows (merchant-sums-invariant,
 * csv-export-invariant). Aino has a checking account, a savings account, a card, a loan account and a joint account she
 * shares with Eero, who has a checking account of his own. Two months, August and September 2026, hold one of each kind
 * of row the sums treat differently: a refund in the month of the purchase and one in the month after, a card whose
 * statement is paid from the checking account, the rows of a loan account, money moved to a savings account and to a
 * fund, and the rows of a joint account that each of the two counts at its half. Made-up names; the IBANs are the kit's examples.
 */
import { type AccountType, type RawTransaction, seriesMarkSubject } from "@banking/core";
import { IBAN } from "../../../packages/core/test/kit/frame.ts";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { type Client, setupApp } from "./helpers.ts";

export const AUGUST = { from: "2026-08-01", to: "2026-08-31" } as const;
export const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" } as const;
export const BOTH_MONTHS = { from: AUGUST.from, to: SEPTEMBER.to } as const;

const AINO = "MEIKALAINEN AINO";
const EERO = "KORHONEN EERO";

type Member = Client & { id: string };
type App = Awaited<ReturnType<typeof setupApp>>;
export type SumsHousehold = App & { aino: Member; eero: Member; /** The merchant of the bill Aino marked as no recurring bill. */ wrongBill: string };

const raw = (bookingDate: string, euros: number, counterparty: string | null, extra: Partial<RawTransaction> = {}): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description: null, reference: null, mcc: null, ...extra,
});

const OWN_TRANSFER = { description: "OMA SIIRTO" };

/** A bill of three months that the app finds as a recurring one and Aino marks as wrong. */
const WRONG_BILL = "VOIMA ESIMERKKI OY";

const CHECKING = [
  raw("2026-07-10", -45, WRONG_BILL, { description: "LASKU" }),
  raw("2026-08-10", -45, WRONG_BILL, { description: "LASKU" }),
  raw("2026-09-10", -45, WRONG_BILL, { description: "LASKU" }),
  raw("2026-08-02", 2400, "TYÖNANTAJA OY", { description: "PALKKA" }),
  raw("2026-08-05", -60, "KAUPPA OY", { mcc: "5411" }),
  raw("2026-08-08", -100, "NORDNET BANK AB", { description: "RAHASTOSÄÄSTÖ" }),
  raw("2026-08-10", -80, "URHEILUKAUPPA ESIMERKKI OY", { mcc: "5941" }),
  raw("2026-08-14", -200, "MAIJA MEIKÄLÄINEN", { ...OWN_TRANSFER, counterpartyIban: IBAN.sav }),
  raw("2026-08-20", -40, "RAVINTOLA ESIMERKKI", { mcc: "5812" }),
  raw("2026-09-02", 2400, "TYÖNANTAJA OY", { description: "PALKKA" }),
  raw("2026-09-05", -60, "KAUPPA OY", { mcc: "5411" }),
  raw("2026-09-08", 15, "KAUPPA OY", { mcc: "5411" }),
  raw("2026-09-08", -100, "NORDNET BANK AB", { description: "RAHASTOSÄÄSTÖ" }),
  raw("2026-09-09", -12.34, "TUNTEMATON PUOTI 123"),
  raw("2026-09-12", 80, "URHEILUKAUPPA ESIMERKKI OY", { description: "PALAUTUS" }),
  raw("2026-09-14", -200, "MAIJA MEIKÄLÄINEN", { ...OWN_TRANSFER, counterpartyIban: IBAN.sav }),
  raw("2026-09-14", -67.5, "ESIMERKKI RAHOITUS OY", { description: "ESIMERKKI GOLD LASKU" }),
  raw("2026-09-15", -300, null, { description: "Lainanlyhennys", counterpartyIban: IBAN.loan }),
];
const SAVINGS = [
  raw("2026-08-14", 200, "MAIJA MEIKÄLÄINEN", { ...OWN_TRANSFER, counterpartyIban: IBAN.chk }),
  raw("2026-09-14", 200, "MAIJA MEIKÄLÄINEN", { ...OWN_TRANSFER, counterpartyIban: IBAN.chk }),
];
const CARD = [
  raw("2026-08-04", -42.5, "K-MARKET ESIMERKKI", { mcc: "5411" }),
  raw("2026-08-18", -25, "KAHVILA ESIMERKKI", { mcc: "5814" }),
  raw("2026-09-04", -50, "K-MARKET ESIMERKKI", { mcc: "5411" }),
  raw("2026-09-14", 67.5, "ESIMERKKI RAHOITUS OY", { description: "MAKSU, KIITOS" }),
];
const LOAN = [raw("2026-09-16", 300, null, { description: "Lyhennys" }), raw("2026-09-30", -12, null, { description: "Korko" })];
/** Amounts down to the cent, so that a half of each is a rounding. */
const JOINT = [
  raw("2026-08-03", -84.37, "YHTEINEN KAUPPA", { mcc: "5411" }),
  raw("2026-09-01", 3000.01, "ESIMERKKI OY", { description: "PALKKA" }),
  raw("2026-09-03", -60, "YHTEINEN KAUPPA", { mcc: "5411" }),
  raw("2026-09-05", -733.33, "ASUNTO OY ESIMERKKI"),
  raw("2026-09-07", -0.01, "YHTEINEN KAUPPA", { mcc: "5411" }),
  raw("2026-09-14", 15.99, "YHTEINEN KAUPPA", { mcc: "5411" }),
  raw("2026-09-20", -20, "TUNTEMATON PUOTI 123"),
];
const EERO_OWN = [raw("2026-09-10", -45, "EERON KAUPPA", { mcc: "5411" })];

async function link(s: App["s"], userId: string, id: string, holder: string | null, type: AccountType, iban: string | null) {
  await s.finance(userId).upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: null, identity: `idn-${id}`, name: id, holder, iban, currency: "EUR", type });
}

/** Aino linked the five accounts and Eero his own; the joint account is shared with Eero and each uses half of it. */
export async function loadSumsHousehold(): Promise<SumsHousehold> {
  const app = await setupApp();
  const eero: Member = await app.member("eero", "Eero");
  const aino: Member = Object.assign(app.admin, { id: app.adminId });
  const repo = app.s.finance(aino.id);
  await link(app.s, aino.id, "chk", null, "checking", IBAN.chk);
  await link(app.s, aino.id, "sav", null, "savings", IBAN.sav);
  await link(app.s, aino.id, "card", null, "credit_card", null);
  await link(app.s, aino.id, "loan", null, "loan", IBAN.loan);
  await link(app.s, aino.id, "joint", `${AINO}, ${EERO}`, "checking", null);
  await link(app.s, eero.id, "eero-own", EERO, "checking", null);
  for (const [id, rows] of [["chk", CHECKING], ["sav", SAVINGS], ["card", CARD], ["loan", LOAN], ["joint", JOINT]] as const) await ingestTransactions(repo, id, rows, "enablebanking");
  await reprocess(repo, app.s.settings);
  const eerosRepo = app.s.finance(eero.id);
  await ingestTransactions(eerosRepo, "eero-own", EERO_OWN, "enablebanking");
  await reprocess(eerosRepo, app.s.settings);
  expectOk((await aino.call("PUT", `/api/accounts/joint/shares/${eero.id}`)).status, "share");
  expectOk((await aino.call("PUT", "/api/accounts/joint/use", { users: [{ userId: aino.id, weight: 1 }, { userId: eero.id, weight: 1 }] })).status, "use");
  // the pages leave a bill marked as wrong out of what recurs; the rows stay, so the sums over them do not change
  const found = ((await aino.call("GET", "/api/recurring")).body.series as Series[]).filter((x) => x.merchant.toLowerCase().includes("voima"));
  if (found.length !== 1) throw new Error(`sums household: ${found.length} series of the bill, wanted one`);
  expectOk((await aino.call("PUT", "/api/marks", { subject: `not-recurring:${seriesMarkSubject(found[0]!).slice("series:".length)}`, mark: "dismissed" })).status, "mark");
  return { ...app, aino, eero, wrongBill: found[0]!.merchant };
}

type Series = Parameters<typeof seriesMarkSubject>[0] & { merchant: string };

function expectOk(status: number, what: string): void {
  if (status !== 200) throw new Error(`sums household: ${what} answered ${status}`);
}
