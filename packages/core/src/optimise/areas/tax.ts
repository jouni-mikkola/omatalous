/**
 * Verot: the household deduction (kotitalousvähennys). Work done at home and paid to a business, summed by the year it
 * was paid in, against the deduction in force. A payment to a person never counts: only rows `isBusinessRow` accepts
 * (a card purchase, an e-invoice, a payee with a company form) can be work from a company in the prepayment register.
 * A row counts in the year of its booking date only, so one payment is never in two years.
 */
import { type AnalysisTx, netPurchase } from "../../analysis/context.ts";
import { formatEur } from "../../analysis/format.ts";
import { businessMerchants, deductibleWorkOf, isBusinessRow, isMobilePay, ledgersWithPayeeAccounts, mccKind } from "../../industry.ts";
import { fold } from "../../merchant.ts";
import { findingId, MAX_ROWS } from "../common.ts";
import { type Fact, factOn, proposedFact } from "../facts/index.ts";
import type { Area, AreaInput, AreaResult, CalcLine, Check, FindingDraft, Weakness } from "../types.ts";
import { isBuildingWorkText, isCleaningWorkText } from "../../wording.ts";

const KIND = "household_deduction";
/** Under this much paid in a year the deduction is at most a few euros after the 150 € deductible. */
const PAID_GATE_CENTS = 30_000;
/** Work whose labour share is not known lies between these; the middle is the estimate. */
const OTHER_SHARE = { low: 0.5, mid: 0.75, high: 1 } as const;


type Work = "cleaning" | "other";

/**
 * The kind of work a business row is, or null when it is none the deduction covers. The register's industry decides
 * first (TOL 81.2 cleaning, 81.3 yard work, 43 building trades), then the card code (7349, 780, 1520-1799), since a
 * shop named for renovation sells materials. Only a home row with neither is read for words naming the work.
 */
function workOf(t: AnalysisTx, industry: ReadonlyMap<string, string>): Work | null {
  const tol = (industry.get(t.merchant) ?? "").replace(/\D/g, "");
  if (tol) return deductibleWorkOf(tol);
  if (t.mcc) {
    const kind = mccKind(t.mcc);
    return kind === "cleaning" ? "cleaning" : kind === "building" ? "other" : null;
  }
  if (t.category !== "home") return null;
  const text = fold(`${t.merchant} ${t.counterparty ?? ""} ${t.description ?? ""}`);
  if (isCleaningWorkText(text)) return "cleaning";
  if (isBuildingWorkText(text)) return "other";
  return null;
}

/** The payment years shown: this year, and last year until the end of May while the tax return can still change. */
function yearsOf(today: string): number[] {
  const year = Number(today.slice(0, 4));
  return today.slice(5) <= "05-31" ? [year - 1, year] : [year];
}

/** The fact in force today that also covered the whole payment year; null hides the year. */
function factFor(id: string, year: number, today: string): Fact | null {
  const f = factOn(id, today);
  return f && f.validFrom <= `${year}-01-01` && (!f.validTo || `${year}-12-31` <= f.validTo) ? f : null;
}

const pct = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });
const eur = (cents: number) => formatEur(cents, false);

const ESTIMATE: Weakness = { id: "estimate", reason: "Laskujen työn osuutta ei tiedetä." };

function assess(a: AreaInput): AreaResult {
  const { ctx, today, end } = a;
  const cards = new Set(ctx.accounts.filter((acc) => acc.type === "credit_card").map((acc) => acc.id));
  const shops = businessMerchants(ctx.txs, ledgersWithPayeeAccounts(ctx.txs));
  const findings: FindingDraft[] = [];

  for (const year of yearsOf(today)) {
    const rate = factFor("household_deduction_rate", year, today);
    const deductible = factFor("household_deduction_deductible", year, today);
    const cap = factFor("household_deduction_cap", year, today);
    if (!rate || !deductible || !cap) continue;
    const rows: AnalysisTx[] = [];
    const sums = { cleaning: 0, other: 0 };
    for (const t of ctx.txs) {
      // complete months only: a year in progress counts up to the last complete month
      if (t.isTransfer || !t.bookingDate.startsWith(`${year}-`) || t.bookingDate > end) continue;
      const paid = netPurchase(t);
      // a MobilePay payment is to a person even when it was booked as a card purchase
      if (paid <= 0 || isMobilePay({ counterparty: t.counterparty, description: `${t.description ?? ""} ${t.merchant}` }) || !isBusinessRow(t, cards, shops)) continue;
      const work = workOf(t, a.industry);
      if (!work) continue;
      rows.push(t);
      sums[work] += paid;
    }
    const paid = sums.cleaning + sums.other;
    if (paid < PAID_GATE_CENTS) continue;

    const deduction = (share: number, r: Fact, c: Fact) => Math.min(c.value, Math.round((r.value / 100) * (sums.cleaning + sums.other * share)) - deductible.value);
    const low = deduction(OTHER_SHARE.low, rate, cap);
    const mid = deduction(OTHER_SHARE.mid, rate, cap);
    const high = deduction(OTHER_SHARE.high, rate, cap);
    // nothing left after the deductible; a mid over the gate always leaves the low above zero
    if (low <= 0) continue;

    const calc: CalcLine[] = [{ label: `Maksettu yrityksille ${year}`, value: eur(paid) }];
    if (sums.cleaning) calc.push({ label: "Siivous ja pihatyöt, työn osuus 100\u00a0%", value: eur(sums.cleaning) });
    if (sums.other) calc.push({ label: "Muut työt, työn osuus 50–100\u00a0%", value: eur(sums.other) });
    calc.push(
      { label: rate.label, value: `${pct.format(rate.value)}\u00a0%` },
      { label: deductible.label, value: eur(deductible.value) },
      { label: cap.label, value: eur(cap.value) },
    );
    if (sums.other) calc.push({ label: "Vähennys, vaihteluväli", value: `${eur(low).replace(/\s€$/, "")}–${eur(high)}` });
    calc.push({ label: sums.other ? "Vähennys, työn osuus 75\u00a0%" : "Vähennys", value: eur(mid) });
    const proposedRate = proposedFact("household_deduction_rate", today);
    const proposedCap = proposedFact("household_deduction_cap", today);
    const covers = (f: Fact) => f.validFrom <= `${year}-01-01` && (!f.validTo || `${year}-12-31` <= f.validTo);
    if (proposedRate && proposedCap && covers(proposedRate) && covers(proposedCap)) {
      const ifPassed = deduction(OTHER_SHARE.mid, proposedRate, proposedCap);
      calc.push({ label: `Jos esitys hyväksytään (${pct.format(proposedRate.value)}\u00a0%, enintään ${eur(proposedCap.value)})`, value: eur(Math.max(0, ifPassed)) });
    }

    const merchants = [...new Set(rows.map((t) => t.merchant))].sort();
    findings.push({
      id: findingId("tax", KIND, String(year)),
      area: "tax",
      kind: KIND,
      subject: String(year),
      title: `Kotitalousvähennys ${eur(mid)} vuodelta ${year}. Yrityksille maksettu ${eur(paid)} töistä, jotka voivat oikeuttaa vähennykseen.`,
      // the running year's pre-filled return arrives next spring
      action:
        year === Number(today.slice(0, 4))
          ? `Tarkista keväällä ${year + 1} esitäytetystä veroilmoituksesta, että vähennys on mukana, ja lisää se OmaVerossa, jos ei ole.`
          : "Tarkista, että vähennys on esitäytetyssä veroilmoituksessa, ja lisää se OmaVerossa, jos ei ole.",
      effort: "tunti",
      euros: {
        lowCents: low,
        midCents: mid,
        highCents: high,
        assumption: sums.other
          ? "Työn osuus on siivouksessa ja pihatöissä 100\u00a0% ja muissa töissä 50–100\u00a0% laskusta, arviossa 75\u00a0%."
          : "Laskelmassa oletetaan, että siivous- ja pihatyölaskut ovat kokonaan työtä.",
      },
      decideBy: null,
      weaknesses: [ESTIMATE],
      shared: false,
      calc,
      rows: rows.slice(-MAX_ROWS).map((t) => t.id),
      struck: [],
      // per year: last year's and this year's deductions are separate money and both count in the headline
      claims: merchants.map((m) => `merchant:${m}:${year}`),
      measure: { kind: "none", keys: [] },
      facts: [rate.id, deductible.id, cap.id],
    });
  }

  const check: Check = { id: `tax:${KIND}`, label: "Kotitalousvähennys", status: findings.length ? "finding" : "clear" };
  return { findings, checks: [check] };
}

export const tax: Area = { id: "tax", label: "Verot", assess };
