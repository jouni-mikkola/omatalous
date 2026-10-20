/**
 * How much of a rise in spending prices explain: the owner of the price split (ADR 0004). The other part is what the
 * household bought more. Prices are the consumer price index of the COICOP class the money was spent on, bundled as
 * dated facts (`optimise/facts/cpi.ts`), so a period whose months have no valid index row tells nothing.
 */
import { CPI_CLASS_NAMES, CPI_FACTS, CPI_SOURCE } from "../optimise/facts/cpi.ts";
import { type Fact, factFrom } from "../optimise/facts/index.ts";
import type { IsoDate } from "../types.ts";

/**
 * The COICOP 2018 class whose prices a category's spending follows. A category that mixes classes with prices of their
 * own (rent and vastike, clothes and other shopping, travel, children) has none and is never split; neither has one
 * whose spending is a contract or a single purchase (leasing, a car).
 */
export const CATEGORY_COICOP: Readonly<Record<string, string>> = {
  groceries: "01",
  restaurants: "11.1.1",
  food_delivery: "11.1",
  alcohol: "02.1",
  utilities: "04.5",
  home: "05",
  transport: "07.3",
  car: "07.2",
  telecom: "08.3",
  health: "06",
  fitness: "09.4.6",
  personal_care: "13.1.3",
  pets: "09.3.2",
  education: "10",
  insurance: "12.1",
  fees: "12.2.2",
};

/** Spending of one period: the money and the months (YYYY-MM) it was spent in. */
interface PricePeriod {
  cents: number;
  months: readonly string[];
}

export interface PriceSplit {
  /** The COICOP 2018 class and its Finnish name. */
  coicop: string;
  className: string;
  /** The mean index points (2025=100) of each period's months. */
  baseIndex: number;
  currentIndex: number;
  /** `currentIndex / baseIndex - 1`. */
  priceChange: number;
  baseMonths: string[];
  currentMonths: string[];
  /** The rise the split is of: the current spending less the base. */
  changeCents: number;
  /** What the base period's purchases would cost more at the current prices. */
  priceCents: number;
  /** The rest of the rise: more bought, or dearer things bought. `priceCents + quantityCents === changeCents`. */
  quantityCents: number;
  source: Fact["source"];
  verifiedAt: IsoDate;
}

const BY_ID = new Map<string, Fact[]>();
for (const f of CPI_FACTS) BY_ID.set(f.id, [...(BY_ID.get(f.id) ?? []), f]);

/** The mean index of `coicop` over `months`, or null when one of them has no valid row on `today`. */
function meanIndex(coicop: string, months: readonly string[], today: IsoDate): { value: number; verifiedAt: IsoDate } | null {
  let sum = 0;
  let verifiedAt = "";
  for (const month of months) {
    const id = `cpi_index:${coicop}:${month}`;
    const f = factFrom(BY_ID.get(id) ?? [], id, today);
    if (!f) return null;
    sum += f.value;
    if (f.verifiedAt > verifiedAt) verifiedAt = f.verifiedAt;
  }
  return { value: sum / months.length, verifiedAt };
}

/**
 * The rise from `base` to `current` in the class `coicop`, split into the part prices explain and the rest. Null when
 * there is no class (a category not in `CATEGORY_COICOP`), the spending did not rise, the base is nothing, the class has
 * no series or a month of either period has no valid index. The price part is the base spending at the change of the
 * index, so the parts add up to the rise to the cent.
 */
export function priceSplit(coicop: string | null | undefined, base: PricePeriod, current: PricePeriod, today: IsoDate): PriceSplit | null {
  const className = coicop ? CPI_CLASS_NAMES.get(coicop) : undefined;
  if (!coicop || !className || base.cents <= 0 || current.cents <= base.cents || !base.months.length || !current.months.length) return null;
  const before = meanIndex(coicop, base.months, today);
  const now = meanIndex(coicop, current.months, today);
  if (!before || !now) return null;
  const priceChange = now.value / before.value - 1;
  const changeCents = current.cents - base.cents;
  // a fall of prices with a rise of spending: all of the rise and more is what was bought
  const priceCents = Math.round(base.cents * priceChange);
  return {
    coicop,
    className,
    baseIndex: before.value,
    currentIndex: now.value,
    priceChange,
    baseMonths: [...base.months],
    currentMonths: [...current.months],
    changeCents,
    priceCents,
    quantityCents: changeCents - priceCents,
    source: CPI_SOURCE,
    verifiedAt: now.verifiedAt > before.verifiedAt ? now.verifiedAt : before.verifiedAt,
  };
}
