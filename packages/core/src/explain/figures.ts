/** The figure that is not a sum of the rows of a range: a part of one joint-account row. It says what it is; no weight or guess goes unnamed. */
import { billCents, partCents, partOf } from "../account-use.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import type { ExplainArgs, Explanation, FigureId, Line, Reason } from "./types.ts";

const sumLines = (lines: readonly Line[]): number => lines.reduce((s, l) => s + l.cents, 0);

/** Whether a part got more than its exact share, `whole * (to - from) / of`: the cent nobody could share went to it. */
const gotTheCent = (whole: number, cents: number, part: { from: number; to: number; of: number }): boolean => Math.abs(cents) * part.of > Math.abs(whole) * (part.to - part.from);

/**
 * `share.part`: what one row of a joint account counts for the viewing user. A row of a traced account says whose money
 * its parts were (`part.source`) and cuts only the unknown parts (`part.use`): the lines are the reasons the collector
 * holds for it, and the check recomputes the viewer's cents from them. Any other row is cut by the weights: one line per
 * user, each with its part (`part.use`, and `rounding.cent` where the part got the cent that could not be shared), and the check adds
 * every user's part up to the bank's amount. Cents are in the bank's sign.
 */
export function explainShare(ctx: AnalysisContext, args: ExplainArgs): Explanation {
  const figure: FigureId = "share.part";
  if (!args.rowId || !args.use) throw new Error("explain: share.part needs a row and the use of its account");
  const t = ctx.txs.find((x) => x.id === args.rowId);
  if (!t) throw new Error("explain: no such row");
  const whole = billCents(t);
  const reasons = args.why?.of(t.id) ?? [];
  if (reasons.some((r) => r.rule === "part.source")) {
    const lines = reasons.map((r, i): Line => ({ id: `${t.id}#${i}`, day: t.bookingDate, cents: r.rule === "part.source" && !r.mine ? 0 : Number(r.cents), whole, why: [r] }));
    return { figure, kind: "share", cents: t.amountCents, lines, check: { kind: "recompute", diffCents: t.amountCents - sumLines(lines) } };
  }
  const lines = args.use.users.map((u): Line => {
    const part = partOf(args.use!, u.userId);
    const cents = partCents(whole, part);
    const rounding: Reason[] = gotTheCent(whole, cents, part) ? [{ rule: "rounding.cent" }] : [];
    return { id: `u:${u.userId ?? "-"}`, day: t.bookingDate, cents, whole, why: [{ rule: "part.use", from: part.from, to: part.to, of: part.of }, ...rounding] };
  });
  const mine = lines.find((l) => l.id === `u:${args.viewerId ?? "-"}`);
  return { figure, kind: "share", cents: mine?.cents ?? 0, lines, check: { kind: "recompute", diffCents: whole - sumLines(lines) } };
}
