import { serviceOf } from "../merchant.ts";
import { isUnnamedMobilePay } from "../mobilepay.ts";
import { returnClassOf } from "../returns.ts";
import type { Transaction } from "../types.ts";
import type { Reason, RuleId, WhyCollector } from "./types.ts";

const NONE: readonly Reason[] = Object.freeze([]);

/** An empty collector of one view: the reasons by row id, in the order the decision points gave them. */
export function createWhy(view: WhyCollector["view"]): WhyCollector {
  const byId = new Map<string, Reason[]>();
  return {
    view,
    add(id, reason) {
      const list = byId.get(id);
      if (list) list.push(reason);
      else byId.set(id, [reason]);
    },
    drop(id, rule) {
      const list = byId.get(id);
      if (list) byId.set(id, list.filter((r) => r.rule !== rule));
    },
    of: (id) => byId.get(id) ?? NONE,
  };
}

/** The reason a refund or a payment paid back is matched to its purchase (`matchReturns`): called before the rows take the purchase's category. */
export function whyReturns(why: WhyCollector, rows: readonly Transaction[], returns: ReadonlyMap<string, string>, ownIbans: ReadonlySet<string>, byUserRule: ReadonlySet<string>): void {
  const byId = new Map(rows.map((t) => [t.id, t]));
  for (const [id, purchaseId] of returns) {
    const refund = byId.get(id)!;
    const purchase = byId.get(purchaseId)!;
    // MobilePay money that names no sender is told by `whyWallet`
    if (isUnnamedMobilePay(refund)) continue;
    // by what the purchase was: money sent to a person coming back, a person paying a share of a business's bill, a shop's refund
    const rule: RuleId = purchase.category === "p2p" ? "return.person" : returnClassOf(refund, ownIbans, byUserRule.has(id)) === "share" ? "return.share" : "return.shop";
    why.add(id, { rule, purchase: purchaseId });
  }
}

/**
 * The reasons of MobilePay money that names no sender and went against a purchase: the matched rows (`returns`) and the
 * rows answered as shares (`answered`: row id to purchase id, null when none was found). The row says which purchase it
 * paid a share of, the purchase what came back. Called after the roles, with the finished rows.
 */
export function whyWallet(why: WhyCollector, rows: readonly Transaction[], returns: ReadonlyMap<string, string>, answered: ReadonlyMap<string, string | null>): void {
  const byId = new Map(rows.map((t) => [t.id, t]));
  const back = new Map<string, { cents: number; count: number }>();
  const pair = (id: string, purchaseId: string) => {
    why.add(id, { rule: "return.wallet", purchase: purchaseId, day: byId.get(purchaseId)!.bookingDate });
    const sum = back.get(purchaseId) ?? { cents: 0, count: 0 };
    back.set(purchaseId, { cents: sum.cents + byId.get(id)!.amountCents, count: sum.count + 1 });
  };
  for (const [id, purchaseId] of returns) if (isUnnamedMobilePay(byId.get(id)!)) pair(id, purchaseId);
  for (const [id, purchaseId] of answered) {
    if (purchaseId) pair(id, purchaseId);
    else why.add(id, { rule: "share.open" });
  }
  for (const [purchaseId, sum] of back) why.add(purchaseId, { rule: "share.back", ...sum });
}

/** Where each row's final category came from. A transfer, a card bill and a matched return say it with their own reasons. */
export function whyCategories(why: WhyCollector, rows: readonly Transaction[], byUserRule: ReadonlySet<string>): void {
  for (const t of rows) {
    const service = serviceOf(t.counterparty, t.description);
    if (service) why.add(t.id, { rule: "via.service", service });
    if (t.category === "card_bill") continue;
    switch (t.categorySource) {
      case "user":
        why.add(t.id, { rule: "category.hand" });
        break;
      case "rule":
        why.add(t.id, byUserRule.has(t.id) ? { rule: "category.own_rule" } : { rule: "category.builtin", source: "rule" });
        break;
      case "mcc":
      case "merchant":
      case "industry":
      case "default":
        why.add(t.id, { rule: "category.builtin", source: t.categorySource });
        break;
      default:
    }
  }
}
