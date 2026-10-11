import { type AccountType, addDays, addMonths, daysInMonth, monthOf, type RawTransaction, weekdayOf } from "@banking/core";
import type { FinanceRepo } from "./db/finance-repo.ts";
import type { SettingsRepo } from "./db/settings-repo.ts";
import { reprocess } from "./services/enrich.ts";
import { stableId } from "./platform/ids.ts";
import { ingestTransactions } from "./services/ingest.ts";

/**
 * Deterministic, realistic demo data: a Finnish household with a checking
 * account, a savings account and a Nordea Gold credit card: salary, rent,
 * bills, subscriptions (two price increases, one cancelled, one new, two video services at once),
 * groceries, Wolt habit, car financing from Nordea Rahoitus, the Gold bill
 * paid to Nordea Rahoitus, monthly fund savings at Nordnet, savings
 * transfers, one credit-line draw to checking, MobilePay and refunds.
 */

export interface DemoAccount {
  id: string;
  name: string;
  iban: string | null;
  type: AccountType;
  /** Balance today (bank's view), so balance history can be reconstructed. */
  balanceCents: number | null;
  transactions: RawTransaction[];
}

const CHECKING_IBAN = "FI2112345600000785";
const SAVINGS_IBAN = "FI1410093000123458";

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemoData(today: string, months = 14): DemoAccount[] {
  const rand = rng(42);
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

  const checking: RawTransaction[] = [];
  const card: RawTransaction[] = [];
  const savings: RawTransaction[] = [];
  const cardByMonth = new Map<string, number>();

  const add = (
    list: RawTransaction[],
    date: string,
    cents: number,
    counterparty: string | null,
    description: string | null,
    extra: Partial<RawTransaction> = {},
  ) => {
    if (date > today) return;
    const status = list === card && date >= addDays(today, -1) ? "pending" : "booked";
    list.push({
      externalId: null,
      bookingDate: date,
      valueDate: date,
      amountCents: cents,
      currency: "EUR",
      status,
      counterparty,
      counterpartyIban: null,
      description,
      reference: null,
      mcc: null,
      ...extra,
    });
    if (list === card && cents < 0) cardByMonth.set(monthOf(date), (cardByMonth.get(monthOf(date)) ?? 0) - cents);
  };
  const day = (month: string, d: number) => `${month}-${String(Math.min(d, daysInMonth(month))).padStart(2, "0")}`;
  const workday = (date: string) => {
    let d = date;
    while (weekdayOf(d) > 4) d = addDays(d, -1);
    return d;
  };

  const endMonth = monthOf(today);
  const startMonth = addMonths(endMonth, -(months - 1));
  for (let m = startMonth, i = 0; m <= endMonth; m = addMonths(m, 1), i++) {
    const monthsAgo = months - 1 - i;
    const winter = ["01", "02", "03", "11", "12"].includes(m.slice(5));

    // ── checking account: income, housing, bills ──
    add(checking, workday(day(m, 25)), 395000, "ACME OY", "PALKKA");
    add(checking, day(m, 2), -105000, "SATO OYJ", "VUOKRA");
    add(checking, day(m, 15), -between(winter ? 70 : 32, winter ? 110 : 55), "HELEN OY", "SÄHKÖLASKU");
    add(checking, day(m, 20), -2990, "ELISA OYJ", "E-LASKU");
    if (["01", "04", "07", "10"].includes(m.slice(5))) add(checking, day(m, 5), -14230, "IF VAHINKOVAKUUTUS OY", "VAKUUTUSMAKSU");
    add(checking, day(m, 26), -30000, "MATTI MEIKÄLÄINEN", "SÄÄSTÖÖN", { counterpartyIban: SAVINGS_IBAN });
    add(savings, day(m, 26), 30000, "MATTI MEIKÄLÄINEN", "SÄÄSTÖÖN", { counterpartyIban: CHECKING_IBAN });
    if (rand() < 0.5) add(checking, day(m, 8 + Math.floor(rand() * 15)), -between(10, 40), "LIISA VIRTANEN", "MOBILEPAY");
    if (rand() < 0.4) add(checking, day(m, 3 + Math.floor(rand() * 20)), between(8, 30), "LIISA VIRTANEN", "MOBILEPAY");
    if (m.slice(5) === "04") add(checking, day(m, 12), 41250, "VEROHALLINTO", "VERONPALAUTUS");
    // car financing (Nordea Rahoitus) and monthly fund saving (Nordnet)
    add(checking, day(m, 5), -28900, "NORDEA RAHOITUS SUOMI OY", "OSAMAKSU AUTO SOPIMUS 4471");
    add(checking, day(m, 6), -15000, "NORDNET BANK AB", "KUUKAUSISÄÄSTÖ RAHASTO");
    if (rand() < 0.3) add(checking, day(m, 27), -between(10, 30), "VEIKKAUS OY", "VEIKKAUS");
    // one month the household borrowed from the Gold card to checking
    if (monthsAgo === 6) {
      add(card, day(m, 18), -80000, null, "LUOTON SIIRTO OMALLE TILILLE");
      add(checking, day(m, 18), 80000, "NORDEA RAHOITUS SUOMI OY", "LUOTON SIIRTO");
    }

    // ── credit card: subscriptions ──
    add(card, day(m, 1), -6470, null, "HSL HELSINKI FI", { mcc: "4111" });
    add(card, day(m, 1), -5900, null, "ELIXIA KAMPPI HELSINKI", { mcc: "7997" });
    add(card, day(m, 12), -1199, null, "PAYPAL *SPOTIFY 35314369001 STOCKHOLM SE");
    add(card, day(m, 7), monthsAgo <= 2 ? -1799 : -1599, null, "NETFLIX.COM LOS GATOS NL", { mcc: "4899" });
    // Optimoi's demo findings: software that got dearer once (62,99 to 74,99), and a second video service beside Netflix
    add(card, day(m, 14), monthsAgo <= 6 ? -7499 : -6299, null, "ADOBE *CREATIVE CLOUD DUBLIN IE", { mcc: "5734" });
    add(card, day(m, 20), -1199, null, "HBO MAX AMSTERDAM NL", { mcc: "4899" });
    add(card, day(m, 3), -99, null, "APPLE.COM/BILL ITUNES.COM IE");
    add(card, day(m, 18), -1299, null, "APPLE.COM/BILL ITUNES.COM IE");
    if (monthsAgo >= 4) add(card, day(m, 22), -999, null, "DISNEY PLUS AMSTERDAM NL");
    if (monthsAgo <= 2) add(card, day(m, 5), -2300, null, "OPENAI *CHATGPT SUBSCR SAN FRANCISCO US");

    // ── credit card: everyday spending ──
    const groceries = ["K-MARKET KAMPPI HELSINKI", "K-SUPERMARKET HERTTONIEMI", "S-MARKET SÖRNÄINEN", "PRISMA ITIS HELSINKI", "LIDL HELSINKI-KALLIO", "ALEPA KALLIO"];
    for (let d = 1; d <= daysInMonth(m); d++) {
      const date = day(m, d);
      const wd = weekdayOf(date);
      if (rand() < (wd >= 4 ? 0.75 : 0.42)) add(card, date, -between(6, wd === 5 ? 110 : 55), null, pick(groceries), { mcc: "5411" });
      if (rand() < (wd >= 4 ? 0.32 : 0.14)) add(card, date, -between(17, 44), null, "WOLT HELSINKI FI", { mcc: "5814" });
      if (rand() < 0.18) add(card, date, -between(4.5, 9.5), null, pick(["ESPRESSO HOUSE KAMPPI", "ROBERTS COFFEE CITY", "FAZER CAFE KLUUVI"]), { mcc: "5814" });
      if (rand() < 0.07) add(card, date, -between(24, 85), null, pick(["RAVINTOLA SAVOTTA HELSINKI", "RAVINTOLA LUCKIEFUN'S", "BISTRO O MAT HELSINKI", "HESBURGER KAMPPI"]), { mcc: "5812" });
      if (rand() < 0.06) add(card, date, -between(50, 82), null, pick(["NESTE EXPRESS VANTAA", "ST1 KEHÄ III VANTAA", "ABC VANTAA"]), { mcc: "5542" });
      if (rand() < 0.035) add(card, date, -between(7, 38), null, "YLIOPISTON APTEEKKI HELSINKI", { mcc: "5912" });
      if (rand() < 0.02) add(card, date, -between(35, 130), null, "ZALANDO SE BERLIN DE", { mcc: "5651" });
      if (rand() < 0.012) add(card, date, -between(25, 260), null, pick(["VERKKOKAUPPA.COM HELSINKI", "IKEA VANTAA", "CLAS OHLSON HELSINKI"]), { mcc: "5732" });
      if (rand() < 0.02) add(card, date, -between(12, 26), null, "FINNKINO TENNISPALATSI", { mcc: "7832" });
      if (rand() < 0.03) add(card, date, -between(9, 28), null, "BOLT.EU/O/2405", { mcc: "4121" });
      if (rand() < 0.03) add(card, date, -between(14, 45), null, "ALKO KAMPPI HELSINKI", { mcc: "5921" });
    }
    if (rand() < 0.6) add(card, day(m, 16), -between(28, 42), null, "PARTURI-KAMPAAMO SAKSET HELSINKI", { mcc: "7230" });
    if (m.slice(5) === "06") add(card, day(m, 14), -38900, null, "FINNAIR OYJ HELSINKI-VANTAA", { mcc: "3005" });
    if (m.slice(5) === "06") add(card, day(m, 15), -24600, null, "BOOKING.COM AMSTERDAM NL", { mcc: "7011" });
    if (monthsAgo === 5) add(card, day(m, 21), 5995, null, "ZALANDO SE BERLIN DE", { mcc: "5651" });

    // ── last month's card bill is paid from checking on the 10th ──
    const prev = addMonths(m, -1);
    const bill = cardByMonth.get(prev);
    if (bill && prev >= startMonth) {
      // Nordea Gold's lender is Nordea Rahoitus Suomi Oy
      add(checking, day(m, 10), -bill, "NORDEA RAHOITUS SUOMI OY", "NORDEA GOLD LASKU");
      add(card, day(m, 10), bill, "NORDEA RAHOITUS SUOMI OY", "MAKSU, KIITOS");
    }
  }
  const balance = (list: RawTransaction[], start: number) => list.filter((t) => t.status === "booked").reduce((sum, t) => sum + t.amountCents, start);

  return [
    { id: "checking", name: "Käyttötili (demo)", iban: CHECKING_IBAN, type: "checking", balanceCents: balance(checking, 185000), transactions: checking },
    { id: "card", name: "Nordea Gold (demo)", iban: null, type: "credit_card", balanceCents: balance(card, 0), transactions: card },
    { id: "savings", name: "Säästötili (demo)", iban: SAVINGS_IBAN, type: "savings", balanceCents: balance(savings, 420000), transactions: savings },
  ];
}

/** Replaces the user's previous demo data with a fresh set ending today. */
export async function loadDemoData(repo: FinanceRepo, settings: SettingsRepo, today: string): Promise<{ accounts: number; transactions: number }> {
  await repo.deleteProviderData("demo");
  let transactions = 0;
  const accounts = generateDemoData(today);
  for (const a of accounts) {
    // ids are per user, so several members can load demo data side by side
    const id = `demo-${stableId(`${repo.userId}|${a.id}`)}`;
    await repo.upsertAccount({
      id,
      connectionId: null,
      provider: "demo",
      externalId: null,
      identity: stableId(`${repo.userId}|${a.id}`),
      name: a.name,
      iban: a.iban,
      currency: "EUR",
      type: a.type,
    });
    const r = await ingestTransactions(repo, id, a.transactions, "demo", { replacePending: true });
    if (a.balanceCents !== null) await repo.setAccountBalance(id, a.balanceCents, new Date().toISOString());
    transactions += r.inserted;
  }
  await reprocess(repo, settings);
  return { accounts: accounts.length, transactions };
}
