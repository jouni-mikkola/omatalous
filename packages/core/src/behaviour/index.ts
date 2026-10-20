/**
 * How the household behaves with money, counted by week and month: food ordered home, grocery visits, gambling stakes.
 * One pass over `ctx.txs`; the counting reads the analysis context and nothing else (R1 §4.1), so a rule change is
 * felt on the next run. Cached per context, as the reports are.
 */
import { type AnalysisContext, type AnalysisTx, netPurchase, paidToPerson } from "../analysis/context.ts";
import { type DeliveryBehaviour, deliveryOf, isMarket } from "./delivery.ts";
import { type GamblingBehaviour, gamblingOf, isStake } from "./gambling.ts";
import { type GroceriesBehaviour, Shops } from "./groceries.ts";
import { Counter, coverGate, windowsOf } from "./week.ts";

/** A purchase: a row that cost something in the end and is no payment to a person. Refunds and shares are already off. */
export const isPurchase = (t: AnalysisTx): boolean => !t.isTransfer && netPurchase(t) > 0 && !paidToPerson(t);

interface Behaviour {
  delivery: DeliveryBehaviour;
  groceries: GroceriesBehaviour;
  gambling: GamblingBehaviour;
}

/** The shortest interval of a recurring charge that is a fee, not an order. */
const FEE_DAYS = 25;

const cache = new WeakMap<AnalysisContext, Behaviour>();

export function behaviourOf(ctx: AnalysisContext): Behaviour {
  let found = cache.get(ctx);
  if (!found) cache.set(ctx, (found = compute(ctx)));
  return found;
}

function compute(ctx: AnalysisContext): Behaviour {
  const w = windowsOf(ctx);
  // a fee is a monthly or rarer charge of one equal sum (a subscription series); equal weekly orders of one meal are orders still
  const fees = new Set<string>();
  for (const s of ctx.recurring) if (s.kind === "subscription" && s.intervalDays >= FEE_DAYS) for (const id of s.transactionIds) fees.add(id);
  const isDeliveryPurchase = (t: AnalysisTx) => t.category === "food_delivery" && isPurchase(t) && !fees.has(t.id);
  const isOrder = (t: AnalysisTx) => isDeliveryPurchase(t) && !isMarket(t);
  const isGroceryPurchase = (t: AnalysisTx) => (t.category === "groceries" || isMarket(t)) && isPurchase(t);
  const orders = new Counter(w);
  const stakes = new Counter(w);
  const shops = new Shops(w);
  const payers = { delivery: new Set<string>(), groceries: new Set<string>(), gambling: new Set<string>() };
  const active = new Set<string>();
  const today = ctx.todayDay;
  for (const t of ctx.txs) {
    if (t.day < w.fromDay || t.day > today) continue;
    const recent = t.day >= w.payersFrom;
    if (recent) active.add(t.accountId);
    if (isStake(t)) {
      if (recent) payers.gambling.add(t.accountId);
      stakes.add(t.day, -t.amountCents, t.id);
    } else if (isGroceryPurchase(t)) {
      if (recent) payers.groceries.add(t.accountId);
      shops.add(t.day, t, netPurchase(t));
    } else if (isOrder(t)) {
      if (recent) payers.delivery.add(t.accountId);
      orders.add(t.day, netPurchase(t), t.id);
    }
  }
  return {
    delivery: deliveryOf(orders, w, coverGate(ctx, payers.delivery, active), isDeliveryPurchase),
    groceries: shops.result(coverGate(ctx, payers.groceries, active), isGroceryPurchase),
    gambling: gamblingOf(stakes, w, coverGate(ctx, payers.gambling, active)),
  };
}
