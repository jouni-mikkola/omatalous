/**
 * "Miksi?": the rows a figure of the first page or Raportit adds up, each with the reasons it counts so. Derived on every
 * request over the viewer's own view, with a collector the decision points fill; nothing is stored. The answer is core's
 * `Explanation` as it is: ids, days and cents, no names (the page names a row from the list it already reads).
 */
import { createContext, createWhy, enrichTransactions, explain, type Explanation, type FigureId, isKnownCategory } from "@banking/core";
import { NotFound, UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { type Scope, scopeWithReasons } from "./analysis.ts";
import { industryMap } from "./enrich.ts";

/** The figures the page opens a "Miksi?" for. */
const EXPLAINED = [
  "spend.month",
  "spend.category",
  "income.month",
  "income.earned",
  "yli_jai.month",
  "usual.spend",
  "usual.income",
  "share.part",
] as const satisfies readonly FigureId[];
type ExplainedFigure = (typeof EXPLAINED)[number];

export const isExplained = (value: string): value is ExplainedFigure => (EXPLAINED as readonly string[]).includes(value);

interface ExplainRequest {
  figure: ExplainedFigure;
  scope: Scope;
  range: { from: string; to: string };
  /** Keys of the accounts the figure is restricted to; each must be an account the viewer may read in the scope. */
  accountIds?: readonly string[];
  category?: string;
  /** `share.part`: the row whose part is told. */
  rowId?: string;
}

/** The most accounts a request may name. */
export const MAX_ACCOUNTS = 50;

export async function explainFigure(s: Services, userId: string, req: ExplainRequest): Promise<Explanation> {
  if (req.figure === "spend.category" && (!req.category || !isKnownCategory(req.category))) throw new UserError("Tuntematon kategoria.");
  // a usual level is of the whole view; a part is of one row
  if ((req.figure === "usual.spend" || req.figure === "usual.income") && req.accountIds) throw new UserError("Tuntematon raportti.");
  if (req.figure === "share.part" && !req.rowId) throw new UserError("Tuntematon raportti.");
  const why = createWhy(req.scope);
  const { ctx: scoped, accounts, shares } = await scopeWithReasons(s, userId, req.scope, why, req.figure === "share.part");
  let ctx = scoped;
  // a member explains only what they may read: an account outside their view is not found, as it is nowhere else
  if (req.accountIds?.some((id) => !accounts.some((a) => a.id === id))) throw new NotFound("Tiliä ei löydy.");
  // the row of a part is one of the viewer's view, so another member's row is not found; the account must have users to share it
  let row = req.figure === "share.part" ? ctx.txs.find((t) => t.id === req.rowId) : undefined;
  // a row whose part of the viewer is 0 is left out of the view's sums, but it has a part to tell: nobody's money of the viewer's
  if (req.figure === "share.part" && !row && req.rowId && shares.get(req.rowId)?.cents === 0) {
    const stored = (await s.finance(userId).allTransactions()).find((t) => t.id === req.rowId);
    if (stored) {
      ctx = createContext([{ ...stored, amountCents: 0, wholeCents: stored.amountCents }], accounts, s.today());
      row = ctx.txs[0];
    }
  }
  if (req.figure === "share.part" && !row) throw new NotFound("Tapahtumaa ei löydy.");
  const use = row ? accounts.find((a) => a.id === row.accountId)?.use : undefined;
  if (req.figure === "share.part" && (!use || use.users.length < 2)) throw new UserError("Tuntematon raportti.");
  // the category of a row is stored; running the pipeline again over copies of the viewer's own rows gives the reasons for it
  const repo = s.finance(userId);
  const [txs, own, rules, industries] = await Promise.all([repo.allTransactions(), repo.listAccounts(), repo.listRules(), industryMap(repo)]);
  enrichTransactions(
    txs.map((t) => ({ ...t })),
    own,
    rules,
    industries,
    { memberId: userId, roles: await repo.payerRoles() },
    why,
    s.today(),
  );
  const answer = explain(req.figure, ctx, { view: req.scope, range: req.range, accountIds: req.accountIds, category: req.category, why, rowId: req.rowId, use, viewerId: userId });
  if (answer.check.kind === "sum" && answer.check.diffCents !== 0) console.warn(`explain: ${req.figure} differs`);
  return answer;
}
