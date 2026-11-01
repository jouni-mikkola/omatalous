/**
 * One household of 24 complete months that every area's `hit` joins: a plain base (pay, groceries, a phone bill,
 * a monthly move to savings) and each part's rows on top. The invariants run over it here, O10's household test
 * checks that every area hits on it and that each near miss stays quiet. The base and the joining are in
 * `household-kit.ts`, which the parts import.
 */
import type { AreaId, InputValues } from "../../src/optimise/types.ts";
import * as bank from "./parts/bank.ts";
import * as car from "./parts/car.ts";
import * as electricity from "./parts/electricity.ts";
import * as food from "./parts/food.ts";
import * as habits from "./parts/habits.ts";
import * as housing from "./parts/housing.ts";
import * as insurance from "./parts/insurance.ts";
import * as kids from "./parts/kids.ts";
import * as loans from "./parts/loans.ts";
import * as savings from "./parts/savings.ts";
import * as seasons from "./parts/seasons.ts";
import * as subscriptions from "./parts/subscriptions.ts";
import * as tax from "./parts/tax.ts";
import { FRAME, type Frame, type Household, joinHousehold, type Part } from "./household-kit.ts";

export const PARTS: Readonly<Record<AreaId, Part>> = { loans, savings, subscriptions, bank, electricity, housing, insurance, food, habits, seasons, tax, kids, car };

/** Every part's hit on the base. */
export function household(frame: Frame = FRAME): Household {
  return joinHousehold(Object.values(PARTS).map((p) => p.hit(frame)), frame);
}

/** Every part's neutral inputs together. */
export function neutralValues(): InputValues {
  return Object.values(PARTS).reduce<InputValues>((all, p) => ({ ...all, ...p.neutralValues }), {});
}
