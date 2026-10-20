/**
 * Households of banks other than Nordea (G1 §4: the kit was Nordea-shaped). Made-up names; each bank's own wording.
 * `pnpm findings --golden` and the quiet test judge all three.
 */
import type { Household } from "../../../../../tools/findings/households.ts";
import { danskeFamily } from "./danske-family.ts";
import { opCouple } from "./op-couple.ts";
import { sPankkiSingle } from "./s-pankki-single.ts";

export function bankHouseholds(): Household[] {
  return [opCouple(), sPankkiSingle(), danskeFamily()];
}
