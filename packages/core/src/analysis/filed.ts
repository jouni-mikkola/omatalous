import { addDays, addMonthsToDate } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import { type AnalysisContext, netSpend, spendRows } from "./context.ts";
import { toDayRange } from "./period.ts";

/**
 * What was spent over 12 months and how much of it was put in a category without asking the user. `share` and
 * `userShare` are parts of `totalCents` (0 to 1): `share` the part a rule or a guess filed, `userShare` what the user
 * answered. `guessShare` is a part of the filed `cents` (0 to 1): how much of what was filed is a guess.
 */
export interface FiledWithoutAsking {
  share: number;
  guessShare: number;
  userShare: number;
  /** The cents behind `share`. */
  cents: number;
  totalCents: number;
}

/**
 * The part of the money that went out over the 12 months up to `to` (from the day after the same day a year before)
 * that was put in a category without asking the user. The rows are those of `spendRows`, what each cost in the end
 * (refunds taken off), a pending row once: no transfer (the bill of a connected card is one), no saving, no money in.
 * A row the user answered is the user's (`userShare`). A row left in Muut menot by any source, and a card bill whose
 * purchases are not in the data, are in the total and not filed. The rest is filed, and a row filed by a register code
 * or a trade word (`industry`) is a guess too. Null when nothing was spent.
 */
export function filedWithoutAsking(ctx: AnalysisContext, to: IsoDate = ctx.today): FiledWithoutAsking | null {
  let total = 0;
  let filed = 0;
  let guess = 0;
  let user = 0;
  for (const t of spendRows(ctx, toDayRange({ from: addDays(addMonthsToDate(to, -12), 1), to }))) {
    if (t.isTransfer) continue;
    const cents = netSpend(t);
    if (cents <= 0) continue;
    total += cents;
    if (t.categorySource === "user") user += cents;
    else if (t.categorySource === "default" || t.category === "other" || t.category === "card_bill") continue;
    else {
      filed += cents;
      if (t.categorySource === "industry") guess += cents;
    }
  }
  if (total === 0) return null;
  return { share: filed / total, guessShare: filed ? guess / filed : 0, userShare: user / total, cents: filed, totalCents: total };
}
