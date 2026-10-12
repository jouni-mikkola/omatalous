/**
 * The life-event kit: a steady Nordea household (household.ts) and the events reviewers of 0.7.0 and 0.8.0 found false
 * findings with, one file each in events/. metamorphic.test.ts runs every statement source on the base and on the base
 * plus each event; `pnpm findings --event <id>` prints both. Every false finding a review finds becomes an event or a
 * near miss here first.
 *
 * The rule for allow lists: an event's real outflow or inflow (a deposit, a dearer rent, weekly pay to a babysitter, a
 * trip) may move a spending or income figure, so a statement about that amount is allowed. A statement that names the
 * wrong cause is false, whatever its figure: a step of a contract called a price rise ("hinta nousi"), a yearly payment
 * called money freed ("vapautui"), a weekly payment called a one-off ("kertaosto"), rows not synced called purchases
 * left out ("ostot jääneet pois"). It goes to known.ts, and its entry names the wrong cause.
 */
import type { Household } from "../../../../tools/findings/households.ts";
import { balanceCarried } from "./events/balance-carried.ts";
import { carLoan } from "./events/car-loan.ts";
import { cardChannel } from "./events/card-channel.ts";
import { cardClosed } from "./events/card-closed.ts";
import { cardConnectedLate } from "./events/card-connected-late.ts";
import { cardReplaced } from "./events/card-replaced.ts";
import { creditDrawn } from "./events/credit-drawn.ts";
import { cadenceMonthlyToYearly } from "./events/cadence-monthly-to-yearly.ts";
import { cadenceQuarterlyToMonthly } from "./events/cadence-quarterly-to-monthly.ts";
import { coHolderTransfer } from "./events/co-holder-transfer.ts";
import { daycareHours } from "./events/daycare-hours.ts";
import { debtCollector } from "./events/debt-collector.ts";
import { earlyRepayment } from "./events/early-repayment.ts";
import { employerChange } from "./events/employer-change.ts";
import { holidayAbroad } from "./events/holiday-abroad.ts";
import { interestMirror } from "./events/interest-mirror.ts";
import { largePurchase } from "./events/large-purchase.ts";
import { mobilepayPerson } from "./events/mobilepay-person.ts";
import { moveNewLandlord } from "./events/move-new-landlord.ts";
import { moveSameLandlord } from "./events/move-same-landlord.ts";
import { phoneLine } from "./events/phone-line.ts";
import { refund } from "./events/refund.ts";
import { stoppedAccount } from "./events/stopped-account.ts";
import { syncLag } from "./events/sync-lag.ts";
import { taxRefund } from "./events/tax-refund.ts";
import { unknownLender } from "./events/unknown-lender.ts";
import { withdrawalFees } from "./events/withdrawal-fees.ts";
import { frameOf, type LifeEvent } from "./frame.ts";
import { HISTORY_MONTHS, householdOf, steadyRows, withCardBills } from "./household.ts";

export type { LifeEvent } from "./frame.ts";

/** The day the kit is judged on: a Thursday in the middle of a month. */
export const KIT_TODAY = "2026-10-15";

/**
 * The Poisson seed of the base: of the first 400, the one whose only loud statement is the Spotify question (`alerts
 * forgotten`) and whose change sentences stay furthest under their gates (an eighth of each), so an event that moves a
 * figure a little does not flip a sentence by chance.
 */
export const KIT_SEED = 231;

export const EVENTS: readonly LifeEvent[] = [
  moveSameLandlord,
  moveNewLandlord,
  phoneLine,
  debtCollector,
  interestMirror,
  withdrawalFees,
  cadenceQuarterlyToMonthly,
  cadenceMonthlyToYearly,
  mobilepayPerson,
  syncLag,
  stoppedAccount,
  taxRefund,
  earlyRepayment,
  daycareHours,
  holidayAbroad,
  largePurchase,
  refund,
  cardClosed,
  cardReplaced,
  cardConnectedLate,
  balanceCarried,
  creditDrawn,
  carLoan,
  cardChannel,
  coHolderTransfer,
  employerChange,
  unknownLender,
];

/** The kit's base household (`kit:base`), or the base with `event` applied (`kit:<event id>`). */
export function kitHousehold(event: LifeEvent | null): Household {
  const f = frameOf(KIT_TODAY, HISTORY_MONTHS);
  const steady = steadyRows(KIT_SEED, "poisson", KIT_TODAY).map((t) => event?.move?.(t, f) ?? t);
  const charges = [...steady, ...(event?.add(f) ?? [])];
  // the event's own rows are never dropped: a new contract may have the old one's text
  const all = withCardBills(charges, KIT_TODAY).filter((t) => !event?.drop || t.id.startsWith(`${event.id}-`) || !event.drop(t, f));
  return householdOf(`kit:${event?.id ?? "base"}`, KIT_TODAY, all);
}
