/**
 * The themes: the main classes of spending, one level above the categories. A household thinks in them (what the car
 * took in a year, what food takes a month), and a category alone does not say it: the car's insurance is a row of
 * Vakuutukset and its tax a row of Verot. `themeOf` gives every row that counts in Menot one theme and one line inside
 * it, so the themes of a period add up to its Menot to the cent.
 *
 * A theme holds whole categories, each a line under the category's label. One theme also takes rows out of other
 * categories by their words: Auto has the car's insurance, the vehicle tax, the car's finance and a lease, and its
 * lines say what a car row was for (`carLineOf`). Money back counts where the payment it takes back counts.
 *
 * Not told yet, since no word list names them: home insurance and property tax, which are housing, and the premium of
 * a pet insurer. Such a row stays in the theme of its category.
 */
import { type AnalysisContext, type AnalysisTx, netPurchase } from "./analysis/context.ts";
import { getCategory } from "./categories.ts";
import { mccKind } from "./industry.ts";
import { fold } from "./merchant.ts";
import { isCarFinanceText, isCarInsuranceText, isCarServiceText, isChargingText, isFuelText, isInspectionText, isLeaseText, isParkingText, isVehicleTaxText } from "./wording.ts";

export type CarLine = "fuel" | "charging" | "parking" | "service" | "inspection" | "insurance" | "tax" | "finance" | "lease" | "other" | "purchase";

const textOf = (t: AnalysisTx) => fold(`${t.merchant} ${t.counterparty ?? ""} ${t.description ?? ""}`);

/** What a car row was for, or null for a row that is not about the car. A row counts on one line only. */
export function carLineOf(t: AnalysisTx): CarLine | null {
  const text = textOf(t);
  const mcc = mccKind(t.mcc);
  if (isLeaseText(text) || t.category === "leasing") return "lease";
  if (t.category === "insurance") return isCarInsuranceText(text) ? "insurance" : null;
  if (t.category === "taxes") return isVehicleTaxText(text) ? "tax" : null;
  if (t.category === "loans") return isCarFinanceText(text) ? "finance" : null;
  if (t.category !== "car") return t.category === "vehicle_purchase" ? "purchase" : null;
  if (mcc === "parking" || isParkingText(text)) return "parking";
  if (mcc === "charging" || isChargingText(text)) return "charging";
  if (isInspectionText(text)) return "inspection";
  if (mcc === "car_service" || isCarServiceText(text)) return "service";
  if (mcc === "fuel" || isFuelText(text)) return "fuel";
  return "other";
}

type ThemeId = "housing" | "food" | "car" | "transport" | "kids" | "pets" | "health" | "media" | "shopping" | "education" | "leisure" | "insurance" | "taxes" | "loans" | "other";

interface ThemeLine {
  /** A category's id, or in Auto what the row was for (`CarLine`). Unique inside its theme. */
  id: string;
  heading: string;
}

interface Theme {
  id: ThemeId;
  heading: string;
  /** In the order a page lists them. */
  lines: readonly ThemeLine[];
}

/** Where a row counts: a theme of `THEMES` and one of its lines. */
interface Placement {
  theme: ThemeId;
  line: string;
}

/** Auton osto: the category of a car bought. Its rows are the line of that name. */
const CAR_PURCHASE = "vehicle_purchase";

/** The lines of Auto, in the order a page lists them. A car bought is the last: it is no running cost. */
const CAR_LINES: Readonly<Record<CarLine, string>> = {
  fuel: "Polttoaine",
  charging: "Sähkölataus",
  parking: "Pysäköinti",
  service: "Huolto ja renkaat",
  inspection: "Katsastus",
  insurance: "Liikenne- ja autovakuutus",
  tax: "Ajoneuvovero",
  finance: "Rahoitus",
  lease: "Leasing",
  other: "Muut",
  purchase: "Auton osto",
};

/** Whole categories as lines, each under its label. */
const labelled = (...categories: string[]): ThemeLine[] => categories.map((id) => ({ id, heading: getCategory(id).label }));

/**
 * The themes in the order a page lists them, each with its lines. Every category that holds spending is a line of
 * one theme. Liikkuminen has the car's categories as lines for the household that has no theme Auto (`themeOf`).
 */
export const THEMES: readonly Theme[] = [
  { id: "housing", heading: "Asuminen", lines: labelled("housing", "mortgage", "utilities") },
  { id: "food", heading: "Ruoka", lines: labelled("groceries", "restaurants", "food_delivery", "alcohol") },
  { id: "car", heading: "Auto", lines: Object.entries(CAR_LINES).map(([id, heading]) => ({ id, heading })) },
  { id: "transport", heading: "Liikkuminen", lines: [...labelled("transport", "car", "leasing"), { id: CAR_PURCHASE, heading: CAR_LINES.purchase }] },
  { id: "kids", heading: "Lapset", lines: labelled("kids") },
  { id: "pets", heading: "Lemmikit", lines: labelled("pets") },
  { id: "health", heading: "Terveys ja hyvinvointi", lines: labelled("health", "fitness", "personal_care") },
  { id: "media", heading: "Viestintä ja tilaukset", lines: labelled("telecom", "subscriptions") },
  { id: "shopping", heading: "Ostokset", lines: labelled("shopping", "home") },
  { id: "education", heading: "Koulutus", lines: labelled("education") },
  { id: "leisure", heading: "Vapaa-aika", lines: labelled("entertainment", "travel", "gambling", "gifts_donations") },
  { id: "insurance", heading: "Vakuutukset", lines: labelled("insurance") },
  { id: "taxes", heading: "Verot ja maksut", lines: labelled("taxes", "memberships", "fees") },
  { id: "loans", heading: "Lainat ja luotot", lines: labelled("loans", "student_loan", "interest", "collection") },
  { id: "other", heading: "Raha-asiat", lines: labelled("cash", "p2p", "card_bill", "other") },
];

/** Where the rows of a category count when no words take them elsewhere. Kategoriat groups the categories by it too. */
export const BY_CATEGORY: ReadonlyMap<string, Placement> = new Map(
  THEMES.filter((theme) => theme.id !== "car").flatMap((theme) => theme.lines.map((line) => [line.id, { theme: theme.id, line: line.id }] as const)),
);
/** A category the table does not know: `getCategory` gives such an id the group Muut. */
const REST: Placement = { theme: "other", line: "other" };

/** Without the household's answer the theme Auto needs this many fuel or charging purchases in the window. */
const AUTO_PURCHASES = 6;

/** What is known of the household's cars. */
interface CarsKnown {
  /** How many cars the household says it has, null until it has said. */
  answer: number | null;
  /** The fuel and charging purchases of the window looked at (`fuelPurchases`): they stand in for the answer. */
  purchases: number;
}

/** How many of the rows are a purchase of fuel or of charging. One that came back whole is none, and neither is the money back. */
export function fuelPurchases(rows: readonly AnalysisTx[]): number {
  return rows.filter((t) => netPurchase(t) > 0 && ["fuel", "charging"].includes(carLineOf(t) ?? "")).length;
}

const takenBack = new WeakMap<AnalysisContext, ReadonlyMap<string, AnalysisTx>>();

/**
 * The row whose words say where `t` counts: the payment that money back takes back (`moneyIn`), else the row itself.
 * The payments are looked up once per context, among all its rows: a payment is often outside the period of its refund.
 */
function countedAs(ctx: AnalysisContext, t: AnalysisTx): AnalysisTx {
  const paid = ctx.returns.get(t.id);
  if (!paid) return t;
  let payments = takenBack.get(ctx);
  if (!payments) {
    const ids = new Set(ctx.returns.values());
    takenBack.set(ctx, (payments = new Map(ctx.txs.filter((x) => ids.has(x.id)).map((x) => [x.id, x]))));
  }
  return payments.get(paid)!;
}

/**
 * The theme and the line a row counts in. Every row has one of each, so the rows of a period that count in Menot
 * (`spend`) add up by theme to its Menot. Money back has the theme and line of the payment it takes back, and lowers
 * them in the month it arrives, as it lowers the payment's category.
 *
 * The theme Auto misleads a household that has no car and buys fuel now and then (a hire car, a moped, a station's
 * shop). So Auto exists when the household says it has a car, and before it has said, when the window holds
 * `AUTO_PURCHASES` purchases of fuel or charging. Without Auto a row stays in the theme of its category: the car's
 * own categories are lines of Liikkuminen, its insurance is on Vakuutukset, its tax on Verot ja maksut and its finance
 * on Lainat ja luotot.
 */
export function themeOf(ctx: AnalysisContext, row: AnalysisTx, cars: CarsKnown): Placement {
  const t = countedAs(ctx, row);
  if (cars.answer === null ? cars.purchases >= AUTO_PURCHASES : cars.answer > 0) {
    const line = carLineOf(t);
    if (line) return { theme: "car", line };
  }
  return BY_CATEGORY.get(t.category) ?? REST;
}
