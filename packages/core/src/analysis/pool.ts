import { isWhole } from "../account-use.ts";
import type { BalanceInput } from "../types.ts";

/**
 * The pool of a view: the one value that Tulos and Käytettävissä both speak for. It holds every account of the view that
 * carries daily money, the household's own and the joint ones, each at the viewer's part (ADR 0016). Savings,
 * investment, loan and card accounts are outside it: money reaches them only by a flow that crosses the pool's boundary.
 * The balances arrive already cut to the viewer's part (`partCents`, as the server's own view gives them), so the pool
 * adds them as they are: cutting them again would weigh a part twice and round each account on its own, and the
 * members' pools would no longer add up to the household's.
 *
 * Decision: what the household can spend today and what stayed of the month are one pool, so a figure that follows
 * fewer accounts, or deducts a debt the pool does not pay, is a different figure under the same name.
 */
export interface Pool {
  ids: ReadonlySet<string>;
  /** "part": some account is counted at less than its whole; "all": every account is counted whole. */
  kind: "all" | "part";
  /** What the pool holds, each account at the viewer's part; an account with no known balance adds nothing. */
  cents: number;
}

/** An account is in the pool when it is a checking account (a joint one included) of which the viewer has some part. */
export function poolOf(balances: readonly BalanceInput[]): Pool {
  const inPool = balances.filter((b) => b.type === "checking" && (!b.part || b.part.to > b.part.from));
  return {
    ids: new Set(inPool.map((b) => b.id)),
    kind: inPool.some((b) => b.part && !isWhole(b.part)) ? "part" : "all",
    cents: inPool.reduce((sum, b) => sum + (b.balanceCents ?? 0), 0),
  };
}
