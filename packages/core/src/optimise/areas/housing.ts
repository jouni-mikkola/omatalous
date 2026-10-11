/**
 * Asuminen: a housing charge that rose more than the benchmark for the kind of home. The rise is the household's own
 * (`priceRiseItems`, the detector of the overview's price insight); the benchmark only says how much of it is usual:
 * the hoitovastike survey for apartment blocks and terraced houses, the rent index for rented homes, none for a
 * detached house or a right-of-occupancy home. Left out: district heat in the vastike, water and waste (no lever),
 * cost per m² (age, heating and company loans decide it).
 */
import type { AnalysisContext } from "../../analysis/context.ts";
import { formatEur, formatFiDate } from "../../analysis/format.ts";
import { MAX_HOUSING_STEP_TENTHS, priceRiseItems, stepTenths } from "../../analysis/insights/prices.ts";
import { addDays } from "../../dates.ts";
import type { IsoDate } from "../../types.ts";
import { findingId, yearlyAt } from "../common.ts";
import { type Fact, factOn } from "../facts/index.ts";
import { valueOf } from "../inputs.ts";
import type { Area, AreaInput, Check, FindingDraft, HousingType, Weakness } from "../types.ts";

/** A vastike or a rent changes once a year: two years keep last year's rise in view. */
const RISE_DAYS = 730;
/** The area's gate: 3 percentage points over the benchmark, in tenths. */
const GATE_TENTHS = 30;
/** A new housing payee this close before the rise, or after it, may be a new home: the rise is not compared. */
const NEW_PAYEE_DAYS = 365;

const LABEL = "Asumismenojen nousu";

const pct = new Intl.NumberFormat("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pctText = (tenths: number) => `${pct.format(tenths / 10)}\u00a0%`;
const pointsText = (tenths: number) => `${pct.format(tenths / 10)} prosenttiyksikköä`;
const tenthsOf = (f: Fact) => Math.round(f.value * 10);

const quarterOf = (date: IsoDate) => `${date.slice(0, 4)}Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

interface Benchmark {
  /** The figure the euros are counted against, and the higher and lower one for the range. */
  mid: Fact;
  high: Fact;
  low: Fact;
  owner: boolean;
}

/** The benchmark of a rise on `date` for the kind of home, or null when there is none for that time. */
function benchmarkOf(type: HousingType, date: IsoDate, today: IsoDate): Benchmark | null {
  if (type === "kerrostalo" || type === "rivitalo") {
    const year = date.slice(0, 4);
    const own = factOn(`hoitovastike_rise:${type}:${year}`, today);
    const other = factOn(`hoitovastike_rise:${type === "kerrostalo" ? "rivitalo" : "kerrostalo"}:${year}`, today);
    if (!own || !other) return null;
    const [low, high] = own.value <= other.value ? [own, other] : [other, own];
    return { mid: own, high, low, owner: true };
  }
  if (type === "vuokra") {
    const q = quarterOf(date);
    const all = factOn(`rent_index_yoy:${q}`, today);
    const free = factOn(`rent_index_yoy_free:${q}`, today);
    const ara = factOn(`rent_index_yoy_ara:${q}`, today);
    if (!all || !free || !ara) return null;
    const sorted = [all, free, ara].sort((x, y) => x.value - y.value);
    return { mid: all, high: sorted[2]!, low: sorted[0]!, owner: false };
  }
  return null;
}

/** First spending row per housing payee, so a payee that appeared near the rise can be told apart. */
function housingPayeesFirstSeen(ctx: AnalysisContext): Map<string, IsoDate> {
  const first = new Map<string, IsoDate>();
  for (const t of ctx.txs) if (!t.isTransfer && t.category === "housing" && t.spend > 0 && !first.has(t.merchant)) first.set(t.merchant, t.bookingDate);
  return first;
}

function check(status: Check["status"], hint?: string, input?: string): Check {
  return { id: "housing:rise", label: LABEL, status, ...(hint ? { hint } : {}), ...(input ? { input } : {}) };
}

function assess(a: AreaInput): { findings: FindingDraft[]; checks: Check[] } {
  const { ctx, today, end } = a;
  const moved = valueOf(a.values, "moved_on", today);
  const firstSeen = housingPayeesFirstSeen(ctx);
  const candidates = priceRiseItems(ctx, end, RISE_DAYS).filter(({ series: s }) => {
    if (s.category !== "housing") return false;
    // the old price must be one this home was charged: the series starts after the move
    if (moved && s.firstDate <= moved) return false;
    const since = addDays(s.priceChange!.date, -NEW_PAYEE_DAYS);
    return ![...firstSeen].some(([m, d]) => m !== s.merchant && d > since && d <= end);
  });
  const all = candidates.map((item) => ({ item, riseT: stepTenths(item.series.priceChange!) }));
  // one step over 10 % is a move, a new flat or a loan share, never a rise to act on (the price insight's rule too)
  const rises = all.filter((r) => r.riseT <= MAX_HOUSING_STEP_TENTHS);
  const step = all.length > rises.length ? check(moved ? "no_data" : "needs_input", moved ? "Nousu on yli 10\u00a0% kerralla, joten sitä ei verrata." : "Jos muutitte, lisää muuttopäivä.", moved ? undefined : "moved_on") : null;
  if (!rises.some((r) => r.riseT >= GATE_TENTHS)) return { findings: [], checks: [step ?? check("clear")] };
  const type = valueOf(a.values, "housing_type", today);
  if (!type) return { findings: [], checks: [check("needs_input", "Valitse asumismuoto, niin nousua verrataan kyselyyn tai vuokraindeksiin.", "housing_type")] };
  if (type === "omakotitalo" || type === "asumisoikeus") return { findings: [], checks: [check("no_data", "Asumismuodolle ei ole vertailutietoa.")] };

  const findings: FindingDraft[] = [];
  let missing = false;
  for (const { item, riseT } of rises) {
    const s = item.series;
    const { fromCents, toCents, date } = s.priceChange!;
    const b = benchmarkOf(type, date, today);
    if (!b) {
      missing = true;
      continue;
    }
    const excess = riseT - tenthsOf(b.mid);
    if (excess < GATE_TENTHS) continue;
    const oldYearly = yearlyAt(s, fromCents);
    const euros = (f: Fact) => Math.round((oldYearly * (riseT - tenthsOf(f))) / 1000);
    const weaknesses: Weakness[] = b.owner
      ? [
          { id: "estimate", reason: "Rahoitusvastike tai korjaus voi selittää nousun." },
          { id: "sample", reason: "Vertailuluku on kyselyn keskiarvo." },
        ]
      : [{ id: "estimate", reason: "Vuokrasopimuksen korotusehto voi selittää nousun." }];
    const basis = b.owner
      ? `${type === "kerrostalo" ? "Kerrostalojen" : "Rivitalojen"} hoitovastikkeet nousivat vuonna ${date.slice(0, 4)} keskimäärin ${pctText(tenthsOf(b.mid))}.`
      : `Vuokraindeksin vuosimuutos oli samalla neljänneksellä ${pctText(tenthsOf(b.mid))}.`;
    const ranges = [b.mid, ...[b.low, b.high].filter((f) => f !== b.mid)];
    findings.push({
      id: findingId("housing", "rise", s.id),
      area: "housing",
      kind: "rise",
      subject: s.id,
      title: `${s.merchant}: ${formatEur(fromCents)} → ${formatEur(toCents)} ${formatFiDate(date)} alkaen, nousua ${pctText(riseT)}. ${basis}`,
      action: b.owner ? "Tarkista vastikkeen nousu: pyydä isännöitsijältä erittely nousun syystä." : "Tarkista korotuksen peruste vuokrasopimuksesta.",
      effort: "minuutteja",
      euros: {
        lowCents: euros(b.high),
        midCents: euros(b.mid),
        highCents: euros(b.low),
        assumption: b.owner ? "Jos maksu olisi noussut kyselyn keskiarvon verran." : "Jos vuokra olisi noussut vuokraindeksin verran.",
      },
      decideBy: null,
      weaknesses,
      // owners decide a vastike together at the yhtiökokous; a tenant's rent is the tenant's own contract
      shared: b.owner,
      calc: [
        { label: "Maksunsaaja", value: s.merchant },
        { label: "Maksu ennen", value: formatEur(fromCents) },
        { label: `Maksu ${formatFiDate(date)} alkaen`, value: formatEur(toCents) },
        { label: "Nousu", value: pctText(riseT) },
        ...ranges.map((f) => ({ label: f.label, value: pctText(tenthsOf(f)) })),
        { label: "Maksut ennen nousua vuodessa", value: formatEur(oldYearly, false) },
        { label: `Nousu yli vertailun ${pointsText(excess)} × ${formatEur(oldYearly, false)}`, value: formatEur(euros(b.mid), false) },
      ],
      rows: s.transactionIds.slice(-60),
      struck: [],
      claims: [`series:${s.id}`],
      measure: { kind: "series", keys: [s.id], perYear: Math.max(1, Math.round(oldYearly / fromCents)) },
      facts: [...new Set(ranges.map((f) => f.id))],
    });
  }
  if (findings.length) return { findings, checks: [check("finding")] };
  return { findings, checks: [missing ? check("no_data", "Vertailutietoa ei ole nousun ajalta.") : (step ?? check("clear"))] };
}

export const housing: Area = { id: "housing", label: "Asuminen", assess };
