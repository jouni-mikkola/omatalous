/**
 * Merchant category codes (ISO 18245) → category, for card transactions.
 * Single codes come before the broad ranges they sit in.
 */
const MCC_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [742, 742, "pets"], // veterinary
  [780, 780, "home"], // landscaping
  [1520, 1799, "home"], // contractors: building, plumbing, electrical
  [4784, 4784, "car"], // tolls and bridge fees
  [4829, 4829, "p2p"], // money transfer
  [5047, 5047, "health"], // medical and optical equipment
  [5122, 5122, "health"], // drugs
  [5641, 5641, "kids"], // children's wear
  [5921, 5921, "alcohol"],
  [5945, 5945, "kids"], // toys & games
  [5975, 5976, "health"], // hearing aids, orthopaedic goods
  [5992, 5992, "home"], // florists
  [5995, 5995, "pets"], // pet shops
  [6051, 6051, "investments"], // quasi-cash, crypto
  [6211, 6211, "investments"], // securities brokers
  [6513, 6513, "housing"], // real estate agents and rentals
  [7210, 7211, "home"], // laundry
  [7230, 7230, "personal_care"], // beauty & barber
  [7298, 7298, "personal_care"], // health & beauty spas
  [7342, 7342, "home"], // pest control
  [7349, 7349, "home"], // cleaning
  [7911, 7911, "fitness"], // dance studios
  [7941, 7941, "fitness"], // sports clubs
  [7992, 7992, "fitness"], // golf courses
  [7995, 7995, "gambling"],
  [7997, 7997, "fitness"], // clubs, gyms
  [8211, 8299, "education"],
  [8351, 8351, "kids"], // child care
  [8398, 8398, "gifts_donations"], // charities
  [8641, 8641, "memberships"], // civic and social associations
  [8661, 8661, "gifts_donations"], // religious organisations
  [8675, 8675, "memberships"], // automobile associations
  [8699, 8699, "memberships"], // membership organisations, unions
  [3000, 3350, "travel"], // airlines
  [3351, 3500, "travel"], // car rental
  [3501, 3999, "travel"], // hotels
  [4011, 4131, "transport"],
  [4411, 4411, "travel"],
  [4511, 4582, "travel"],
  [4722, 4722, "travel"],
  [4784, 4789, "transport"],
  [4812, 4816, "telecom"],
  [4899, 4899, "subscriptions"],
  [4900, 4900, "utilities"],
  [5045, 5065, "home"],
  [5172, 5172, "car"],
  [5200, 5261, "home"],
  [5300, 5399, "shopping"],
  [5411, 5499, "groceries"],
  [5511, 5599, "car"],
  [5600, 5699, "shopping"],
  [5712, 5735, "home"],
  [5811, 5814, "restaurants"],
  [5815, 5818, "subscriptions"],
  [5912, 5912, "health"],
  [5940, 5999, "shopping"],
  [6010, 6011, "cash"],
  [6300, 6399, "insurance"],
  [7011, 7011, "travel"],
  [7512, 7512, "travel"],
  [7523, 7549, "car"],
  [7800, 7999, "entertainment"],
  [8011, 8099, "health"],
  [9211, 9399, "taxes"],
];

export function categoryForMcc(mcc: string | null): string | null {
  const code = mcc ? Number.parseInt(mcc, 10) : Number.NaN;
  if (!Number.isFinite(code)) return null;
  for (const [lo, hi, category] of MCC_RANGES) {
    if (code >= lo && code <= hi) return category;
  }
  return null;
}
