/**
 * Income events that are not a level: a new source, a windfall against last year (holiday pay, other pay, a tax
 * refund) and residual tax paid in instalments. H-insights candidates 3, 4 and 17.
 */
import { addDays, dayNumber, fromDayNumber } from "../dates.ts";
import { fold } from "../merchant.ts";
import type { IsoDate } from "../types.ts";
import { type AnalysisTx, historyCovers } from "./context.ts";
import { formatFiDate } from "./format.ts";
import { INCOME_TYPES, type IncomeType, payerKey } from "./income.ts";
import { COUNT_INESSIVE, eur, type IncomeBase, type IncomeChange, inessive, isKela, passes, shortDate } from "./income-series.ts";

const NEW_SOURCE_DAYS = 92;
const NEVER_NEW: ReadonlySet<IncomeType> = new Set(["tax_refund", "holiday_pay", "other_pay", "persons", "refunds"]);

export function newSources(b: IncomeBase, skip: ReadonlySet<string>): IncomeChange[] {
  const byPayer = new Map<string, AnalysisTx[]>();
  for (const t of b.rows) {
    const type = b.types.get(t.id)!;
    if (NEVER_NEW.has(type) || t.amountCents <= 0) continue;
    const key = `${isKela(type) ? "kela" : type}|${payerKey(t)}`;
    const list = byPayer.get(key);
    if (list) list.push(t);
    else byPayer.set(key, [t]);
  }
  const out: IncomeChange[] = [];
  const endDay = dayNumber(b.end);
  for (const [key, rows] of byPayer) {
    const first = rows[0]!;
    if (skip.has(payerKey(first)) || endDay - first.day > NEW_SOURCE_DAYS || !historyCovers(b.ctx, addDays(first.bookingDate, -182))) continue;
    const total = rows.reduce((s, t) => s + t.amountCents, 0);
    const months = Math.min(3, Math.max(1, Math.ceil((endDay - first.day + 1) / 30.44)));
    const big = b.usualMonthlyCents !== null && total >= b.usualMonthlyCents * 0.1;
    if ((rows.length < 2 && !big) || !passes(b, total / 3)) continue;
    out.push({
      id: `income:new:${key}`,
      kind: "new_source",
      type: b.types.get(first.id)!,
      payer: first.merchant,
      title: `Uusi tulo: ${first.merchant}, ${eur(total)} ${months === 1 ? "kuukaudessa" : `${COUNT_INESSIVE[months]} kuussa`}`,
      detail: rows.length === 1 ? `Yksi maksu ${formatFiDate(first.bookingDate)}.` : `${rows.length} maksua ${formatFiDate(first.bookingDate)} alkaen.`,
      monthlyCents: Math.round(total / 3),
      yearlyCents: Math.round((total / 3) * 12),
      txIds: rows.map((t) => t.id),
    });
  }
  return out;
}

const WINDFALL_TYPES: readonly IncomeType[] = ["holiday_pay", "other_pay", "tax_refund"];
const WINDFALL_DAYS = 60;

export function windfalls(b: IncomeBase): IncomeChange[] {
  const out: IncomeChange[] = [];
  const endDay = dayNumber(b.end);
  for (const type of WINDFALL_TYPES) {
    const of = b.rows.filter((t) => b.types.get(t.id) === type && t.amountCents > 0);
    const recent = of.filter((t) => endDay - t.day <= WINDFALL_DAYS);
    const label = INCOME_TYPES[type].label;
    if (recent.length) {
      const total = recent.reduce((s, t) => s + t.amountCents, 0);
      const last = recent[recent.length - 1]!;
      const before = of.filter((t) => Math.abs(last.day - 365 - t.day) <= 75);
      const knows = historyCovers(b.ctx, fromDayNumber(last.day - 365 - 75));
      const prior = before.reduce((s, t) => s + t.amountCents, 0);
      const detail = before.length ? `Viime vuonna ${eur(prior)} ${inessive(before[before.length - 1]!.bookingDate)}.` : knows ? "Viime vuonna samaan aikaan ei vastaavaa." : `${last.merchant}, ${recent.length} ${recent.length === 1 ? "maksu" : "maksua"}.`;
      if (!passes(b, total / 12)) continue;
      out.push({ id: `income:windfall:${type}:${last.bookingDate}`, kind: "windfall", type, payer: last.merchant, title: `${label} ${eur(total)} tuli ${shortDate(last.bookingDate)}`, detail, monthlyCents: Math.round(total / 12), yearlyCents: total, txIds: recent.map((t) => t.id) });
      continue;
    }
    // in spring, last summer's holiday pay: when it came and how much
    const month = Number(b.end.slice(5, 7));
    if (type !== "holiday_pay" || month < 3 || month > 5) continue;
    const lastYear = String(Number(b.end.slice(0, 4)) - 1);
    const summer = of.filter((t) => t.bookingDate.startsWith(lastYear) && t.bookingDate.slice(5, 7) >= "05" && t.bookingDate.slice(5, 7) <= "08");
    if (!summer.length) continue;
    const total = summer.reduce((s, t) => s + t.amountCents, 0);
    if (!passes(b, total / 12)) continue;
    const first = summer[0]!;
    out.push({ id: `income:windfall-ahead:${lastYear}`, kind: "windfall_ahead", type, payer: first.merchant, title: `Lomaraha viime vuonna ${eur(total)} ${inessive(first.bookingDate)}`, detail: `${first.merchant}, ${formatFiDate(first.bookingDate)}.`, monthlyCents: Math.round(total / 12), yearlyCents: total, txIds: summer.map((t) => t.id) });
  }
  return out;
}

const RESIDUAL_WORDS = /(?<![A-Z])(?:JAANNOSVERO|OMAVERO)(?![A-Z])/;
const TAX_OFFICE = /(?<![A-Z])VEROHALLINTO(?![A-Z])/;
/** Property tax, car tax and prepayments go to the same payee and are not residual tax. */
const OTHER_TAX = /(?<![A-Z])(?:KIINTEISTOVERO|AUTOVERO|AJONEUVOVERO|ENNAKKOVERO|PERINTOVERO|LAHJAVERO|VARAINSIIRTOVERO)(?![A-Z])/;

/** The tax year whose residual tax a row pays: August to December of the year, or January after it. */
const taxSeason = (d: IsoDate) => (d.slice(5, 7) >= "08" ? Number(d.slice(0, 4)) : d.slice(5, 7) === "01" ? Number(d.slice(0, 4)) - 1 : null);

export function residualTax(b: IncomeBase): IncomeChange | null {
  const seasons = new Map<number, AnalysisTx[]>();
  for (const t of b.ctx.txs) {
    if (t.bookingDate > b.end || t.amountCents >= 0 || t.category !== "taxes") continue;
    const text = fold(`${t.merchant} ${t.counterparty ?? ""} ${t.description ?? ""}`);
    const season = taxSeason(t.bookingDate);
    if (season === null || OTHER_TAX.test(text) || !(RESIDUAL_WORDS.test(text) || TAX_OFFICE.test(text))) continue;
    const list = seasons.get(season);
    if (list) list.push(t);
    else seasons.set(season, [t]);
  }
  const sumOf = (season: number) => {
    const rows = seasons.get(season) ?? [];
    const worded = rows.filter((t) => RESIDUAL_WORDS.test(fold(`${t.merchant} ${t.description ?? ""}`)));
    // with only a reference: two payments to Verohallinto about two months apart
    const paired = rows.filter((t) => rows.some((o) => o !== t && Math.abs(Math.abs(o.day - t.day) - 61) <= 10));
    const used = worded.length ? worded : paired;
    return { rows: used, cents: -used.reduce((s, t) => s + t.amountCents, 0) };
  };
  const latest = [...seasons.keys()].sort().pop();
  if (latest === undefined) return null;
  const now = sumOf(latest);
  const lastRow = now.rows[now.rows.length - 1];
  if (!lastRow || now.cents < 10000 || dayNumber(b.end) - lastRow.day > 120) return null;
  const prev = sumOf(latest - 1);
  const knows = historyCovers(b.ctx, `${latest - 1}-08-01`);
  const parts = COUNT_INESSIVE[Math.min(now.rows.length, 4)] ?? `${now.rows.length}`;
  const detail = prev.cents >= 10000 ? `Toinen vuosi peräkkäin, viime vuonna ${eur(prev.cents)}.` : knows ? "Viime vuonna ei jäännösveroa." : `Viimeinen erä ${formatFiDate(lastRow.bookingDate)}.`;
  return {
    id: `income:residual-tax:${latest}`,
    kind: "residual_tax",
    type: null,
    payer: lastRow.merchant,
    title: `Jäännösveroa ${eur(now.cents)} ${parts} erässä`,
    detail,
    monthlyCents: -Math.round(now.cents / 12),
    yearlyCents: now.cents,
    txIds: now.rows.map((t) => t.id),
  };
}

/** Every change that passed its gate, largest monthly effect first. `today`: the view ends today, so pay can be late. */
