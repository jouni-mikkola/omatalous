/**
 * What a company's TOL industry code (and a card's merchant code) means for a household: the prefix tables behind
 * the register's category (`categoryForIndustry`). The register uses two code sets while companies move over: TOL 2008
 * ("TOIMI3") and TOL 2025 ("TOIMI4", based on NACE Rev. 2.1). Most prefixes mean the same in both; where they differ
 * there is a table per set.
 */

export type IndustryCodeSet = "TOL2008" | "TOL2025";

/** A code set the register answers in and this file has a table for; a stored one is checked before use. */
export const isIndustryCodeSet = (v: unknown): v is IndustryCodeSet => v === "TOL2008" || v === "TOL2025";

/**
 * What the register's class 77.11 gives: car rental AND car leasing share it, and the sum alone does not tell them
 * apart. Not a category of its own: the pipeline files the rows in a monthly run of equal sums (`monthlyRunRows`)
 * under Autoleasing, any other under travel (`hireCategory`), as it files a dealer's by the sum (`dealerCategory`).
 */
export const CAR_HIRE = "car_hire";
export const hireCategory = (steady: boolean) => (steady ? "leasing" : "travel");

/** Prefix → category. `null` stops the search: the industry is too broad to say (wholesale, finance). */
type PrefixTable = Readonly<Record<string, string | null>>;

const COMMON: PrefixTable = {
  "1071": "groceries", // bakeries
  "35": "utilities",
  "36": "utilities",
  "37": "utilities",
  "38": "utilities",
  "41": "home",
  "42": null,
  "43": "home",
  "46": null,
  "4711": "groceries",
  "4719": "shopping", // TOL 2008 department stores
  "4712": "shopping", // TOL 2025 department stores
  "472": "groceries",
  "4725": "alcohol",
  "4726": "shopping",
  "473": "car",
  "474": "home",
  "475": "home",
  "476": "shopping",
  "477": "shopping",
  "4773": "health",
  "4774": "health",
  "4775": "personal_care",
  "4776": "home",
  "479": "shopping",
  "491": "transport",
  "493": "transport",
  "4934": "entertainment", // TOL 2025 ski lifts
  "4942": "home", // removals
  "50": "travel",
  "51": "travel",
  "5221": "car", // parking, towing, roads
  "5223": "travel",
  "5232": "transport", // TOL 2025 ride booking
  "55": "travel",
  "56": "restaurants",
  "564": "food_delivery", // TOL 2025 delivery platforms
  "5811": "shopping",
  "581": "subscriptions",
  "5821": "entertainment",
  "5829": "subscriptions",
  "59": "entertainment",
  "60": "subscriptions",
  "61": "telecom",
  "62": "subscriptions",
  "63": "subscriptions",
  "64": null,
  "6419": "loans", // banks; not on a card purchase (categorize-bank-rows.ts)
  "6491": "leasing", // financial leasing: the lessor of a car on a household's monthly payment
  "6492": "loans", // other credit granting
  "65": "insurance",
  "66": null,
  "68": "housing",
  "75": "pets",
  "7711": CAR_HIRE,
  "7751": "travel",
  "7721": "entertainment",
  "79": "travel",
  "80": "home",
  "81": "home",
  "8291": "collection",
  "84": "taxes",
  "85": "education",
  "8510": "kids",
  "8551": "fitness",
  "86": "health",
  "87": "health",
  "88": "health",
  "8891": "kids",
  "90": "entertainment",
  "91": "entertainment",
  "92": "gambling",
  "931": "fitness",
  "932": "entertainment",
  "941": "memberships",
  "942": "memberships",
  "9491": "gifts_donations",
  "9492": "gifts_donations",
  "9499": "memberships",
  "951": "home",
  "952": "home",
  "9601": "home", // TOL 2008 laundry
  "9602": "personal_care",
  "9604": "personal_care",
  "961": "home", // TOL 2025 laundry
  "962": "personal_care",
  "9691": "home",
};

const ONLY: Readonly<Record<IndustryCodeSet, PrefixTable>> = {
  TOL2008: {
    "45": "car",
    "451": "vehicle_purchase", // sale of motor vehicles: the row's sum tells the car from its upkeep (`dealerCategory`)
    "4765": "kids", // toys
    "47764": "pets",
    "47783": "health", // opticians
    "47595": "shopping", // musical instruments, not household goods
    "52211": "transport", // bus stations
    "47784": "kids", // prams and baby goods
    "478": "shopping", // market stalls
    "4781": "groceries",
  },
  TOL2025: {
    "4764": "kids", // toys
    "47763": "pets",
    "4671": "vehicle_purchase", // wholesale of motor vehicles
    "478": "car", // vehicle and parts retail
    "4781": "vehicle_purchase", // retail sale of motor vehicles
    "953": "car", // vehicle repair
    "52211": null, // road freight terminals: nothing a household pays
  },
};

/** What a TOL code says about spending at the company, or null when it says nothing useful. */
export function categoryForIndustry(code: string, codeSet: IndustryCodeSet): string | null {
  if (!/^\d{2,5}$/.test(code)) return null;
  for (let len = code.length; len >= 2; len--) {
    const prefix = code.slice(0, len);
    const own = ONLY[codeSet][prefix];
    if (own !== undefined) return own;
    const common = COMMON[prefix];
    if (common !== undefined) return common;
  }
  return null;
}

/** What a TOL code says about an electricity bill: 35.14 trade, 35.13 distribution, "other" for another trade. Null for 35 or another 35.1 code, which say nothing. */
export function electricityRoleOf(code: string): "seller" | "network" | "other" | null {
  if (code.startsWith("3514")) return "seller";
  if (code.startsWith("3513")) return "network";
  return code === "35" || code.startsWith("351") ? null : "other";
}

/** Work the household deduction covers, by TOL code: 81.2 cleaning and 81.3 yard work are labour, 43 building trades carry materials too. */
export function deductibleWorkOf(code: string): "cleaning" | "other" | null {
  return code.startsWith("812") || code.startsWith("813") ? "cleaning" : code.startsWith("43") ? "other" : null;
}

/** What a card code says beyond its category, for the views that split one further (Optimoi's car, tax and kids areas). */
type MccKind = "parking" | "charging" | "car_service" | "fuel" | "cleaning" | "building" | "child_care";
const MCC_KINDS: ReadonlyArray<readonly [number, number, MccKind]> = [
  [7523, 7523, "parking"],
  [5552, 5552, "charging"],
  [7531, 7549, "car_service"],
  [5541, 5542, "fuel"],
  [7349, 7349, "cleaning"],
  [780, 780, "cleaning"],
  [1520, 1799, "building"],
  [8351, 8351, "child_care"],
];
export function mccKind(mcc: string | null): MccKind | null {
  const code = mcc ? Number(mcc) : Number.NaN;
  return MCC_KINDS.find(([lo, hi]) => code >= lo && code <= hi)?.[2] ?? null;
}
