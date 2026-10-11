/**
 * Lapset: the municipal day-care fee beside the statutory maximum. The fee follows income, family size and care
 * hours, and the bank rows cannot tell these apart, so the area makes no finding: its check states the August change
 * and the change of the maximum, and the household reads its fee decision. Only a municipality's fee is compared: a
 * private provider sets its own prices.
 */
import type { AnalysisTx } from "../../analysis/context.ts";
import { formatEur } from "../../analysis/format.ts";
import { fold } from "../../merchant.ts";
import { FACTS, factFrom, factOn } from "../facts/index.ts";
import type { Area, AreaInput, AreaResult, Check } from "../types.ts";

const KIND = "daycare";
const FACT = "daycare_max_fee";

const DAYCARE = /(?<![A-Z])(?:[A-Z]*PAIVAKOTI[A-Z]*|[A-Z]*PAIVAHOITO[A-Z]*|VARHAISKASVATUS[A-Z]*)(?![A-Z])/;
const MUNICIPALITY = /(?<![A-Z])(?:KAUPUNKI|KUNTA|STAD|KOMMUN)(?![A-Z])/;

/** A day-care payment to a municipality: a `kids` row whose payee is a city or municipality. */
function isMunicipalDaycare(t: AnalysisTx): boolean {
  if (t.isTransfer || t.category !== "kids" || t.amountCents >= 0) return false;
  const payee = fold(`${t.merchant} ${t.counterparty ?? ""}`);
  return MUNICIPALITY.test(payee) && (t.mcc === "8351" || DAYCARE.test(fold(`${payee} ${t.description ?? ""}`)));
}

interface Charge {
  date: string;
  cents: number;
}

/** One charge per booking day: two children's fees on one invoice day add up, as the recurring series count them. */
function chargesOf(rows: readonly AnalysisTx[]): Charge[] {
  const byDate = new Map<string, Charge>();
  for (const t of rows) {
    const c = byDate.get(t.bookingDate) ?? { date: t.bookingDate, cents: 0 };
    c.cents += -t.amountCents;
    byDate.set(t.bookingDate, c);
  }
  return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
}

/** The same fee, within 3 % and 50 cents, as the recurring series compare charges. */
const sameFee = (x: number, y: number) => Math.abs(x - y) < 50 || Math.abs(x - y) < 0.03 * Math.max(x, y);

const pct = new Intl.NumberFormat("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = (share: number) => `${pct.format(share * 100)}\u00a0%`;

/**
 * The August change of one fee as the check's hint, or null without one: the old fee is the last charge before
 * 1.8 (settled: the one before it agrees), the new one the first charge from 1.9 to 5.10 in a complete month, so
 * billing in advance and in arrears both read the new fee.
 */
function changeOf(rows: readonly AnalysisTx[], year: number, end: string, statutory: number): string | null {
  const charges = chargesOf(rows);
  const old = charges.filter((c) => c.date < `${year}-08-01`);
  const fresh = charges.find((c) => c.date >= `${year}-09-01` && c.date <= `${year}-10-05` && c.date <= end);
  const last = old[old.length - 1];
  if (!fresh || !last || old.length < 2 || !sameFee(last.cents, old[old.length - 2]!.cents) || sameFee(last.cents, fresh.cents)) return null;
  const rise = fresh.cents / last.cents - 1;
  const verb = rise > 0 ? "nousi" : "laski";
  const sign = rise > 0 ? "" : "\u2212";
  return (
    `Maksu ${verb} elokuussa ${formatEur(last.cents)} → ${formatEur(fresh.cents)} (${sign}${percent(Math.abs(rise))}). ` +
    `Enimmäismaksu nousi ${percent(statutory)}. Jos tulot tai hoitoaika eivät muuttuneet, tarkista maksupäätös.`
  );
}

function assess(a: AreaInput): AreaResult {
  const { ctx, today, end } = a;
  const groups = new Map<string, AnalysisTx[]>();
  for (const t of ctx.txs) {
    if (!isMunicipalDaycare(t)) continue;
    const key = `${t.accountId}\u0000${t.merchant}`;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  if (!groups.size) return { findings: [], checks: [] };

  const check: Check = { id: `kids:${KIND}`, label: "Päivähoitomaksun nousu", status: "clear" };
  // the latest August whose new fee has been paid in a complete month: September, or a few days into October
  const year = Number(end.slice(0, 4)) - (end.slice(5, 7) < "09" ? 1 : 0);
  const before = factFrom(FACTS, FACT, `${year}-07-31`);
  const after = factFrom(FACTS, FACT, `${year}-08-01`);
  // the old row is past its end today and read for its own time; the new one must still be in force
  if (!before || !after || after.validFrom !== `${year}-08-01` || factOn(FACT, today) !== after) return { findings: [], checks: [check] };
  const statutory = after.value / before.value - 1;
  for (const rows of groups.values()) {
    const hint = changeOf(rows, year, end, statutory);
    if (hint) return { findings: [], checks: [{ ...check, hint }] };
  }
  return { findings: [], checks: [check] };
}

export const kids: Area = { id: "kids", label: "Lapset", assess };
