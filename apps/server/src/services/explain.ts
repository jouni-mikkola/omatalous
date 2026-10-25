/**
 * "Miksi?": the rows a figure of the first page, Raportit or Laskut adds up, each with the reasons it counts so. Derived on every
 * request over the viewer's own view, with a collector the decision points fill; nothing is stored. The answer is core's
 * `Explanation` with the name and category of each row it names (`rows`), the same the viewer's list of rows shows, so the
 * panel needs no list of its own; no description, counterparty or account number.
 */
import { cancelledSubjects, createContext, createWhy, enrichTransactions, explain, type Explanation, explainLoan, explainNow, type FigureId, isKnownCategory, isLoanFigure, isOneLoan, type LoanFigureId } from "@banking/core";
import { NotFound, UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { requestInputs, type Scope, scopeWithReasons } from "./analysis.ts";
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
  "bills.paid",
  "bills.coming",
  "bills.missing",
  "bills.due",
  "bills.fixed",
  "bills.subs",
  "holdings.accounts",
  "ahead.free",
  "ahead.pay",
  "loans.total",
  "loans.interest",
  "loans.payments",
  "holdings.loans",
  "loan.balance",
  "loan.interest",
  "loan.payment",
  "loan.monthly",
] as const satisfies readonly FigureId[];

/** Today's figures (explain/now.ts): of the dashboard's own run, so they take no range, account or category. */
const NOW = new Set<string>(["holdings.accounts", "ahead.free", "ahead.pay"]);
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
  /** `loan.*`: the loan, as the Lainat report names it (`parseLoanRef`). */
  loanId?: string;
}

/** The most accounts a request may name. */
export const MAX_ACCOUNTS = 50;

/** A row the answer names: what the viewer's list of rows calls it. */
interface NamedRow {
  id: string;
  merchant: string;
  category: string;
}

/** The ids of the rows an answer names: its lines, the lines of each month of a median, and the purchase a return points at. */
function namedIds(e: Explanation): Set<string> {
  const ids = new Set<string>();
  const add = (x: Explanation) => {
    for (const l of x.lines) {
      ids.add(l.id);
      for (const r of l.why) if (r.rule === "return.wallet") ids.add(String(r.purchase));
    }
  };
  add(e);
  if (e.method?.kind === "median") for (const v of e.method.values) if (v.explain) add(v.explain);
  return ids;
}

export async function explainFigure(s: Services, userId: string, req: ExplainRequest): Promise<Explanation & { rows: NamedRow[] }> {
  if (NOW.has(req.figure)) return explainToday(s, userId, req);
  if (isLoanFigure(req.figure)) return explainLoans(s, userId, req.figure, req);
  if (req.loanId) throw new UserError("Tuntematon raportti.");
  if (req.figure === "spend.category" && (!req.category || !isKnownCategory(req.category))) throw new UserError("Tuntematon kategoria.");
  // a usual level and a figure of Laskut are of the whole view; a part is of one row
  if ((req.figure === "usual.spend" || req.figure === "usual.income" || req.figure.startsWith("bills.")) && req.accountIds) throw new UserError("Tuntematon raportti.");
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
  // a figure of Laskut leaves out what the viewer marked as cancelled and the plans that are over, as the page does
  const cancelled = req.figure.startsWith("bills.") ? cancelledSubjects((await requestInputs(s, userId, accounts)).inputs, ctx.today) : undefined;
  const answer = explain(req.figure, ctx, { view: req.scope, range: req.range, accountIds: req.accountIds, category: req.category, cancelled, why, rowId: req.rowId, use, viewerId: userId });
  if (answer.check.kind === "sum" && answer.check.diffCents !== 0) console.warn(`explain: ${req.figure} differs`);
  // a part names the users of the account, which the page has; every other line is a row of the view
  const ids = req.figure === "share.part" ? new Set<string>() : namedIds(answer);
  const rows = ctx.txs.filter((t) => ids.has(t.id)).map((t): NamedRow => ({ id: t.id, merchant: t.merchant, category: t.category }));
  return { ...answer, rows };
}

/**
 * Käytettävissä, Tilien saldo and the pay the window waits for, from the same cached context and inputs as the dashboard, so the
 * basis is of the figure the page shows. A pay is a row of the view and is named as rows are; an account or a coming
 * payment is named by core.
 */
async function explainToday(s: Services, userId: string, req: ExplainRequest): Promise<Explanation & { rows: NamedRow[] }> {
  if (req.accountIds || req.category || req.rowId) throw new UserError("Tuntematon raportti.");
  const { ctx, accounts } = await s.analysis.get(s, userId, req.scope);
  const { balances, inputs } = await requestInputs(s, userId, accounts);
  const { explanation, names } = explainNow(req.figure as "holdings.accounts" | "ahead.free" | "ahead.pay", ctx, balances, inputs);
  const ids = new Set(explanation.lines.map((l) => l.id));
  const rows = ctx.txs.filter((t) => ids.has(t.id)).map((t): NamedRow => ({ id: t.id, merchant: t.merchant, category: t.category }));
  return { ...explanation, rows: [...names, ...rows] };
}

/**
 * The loan figures of Lainat and Varallisuus, from the same context and inputs as /reports and the dashboard, so the basis
 * is of the figure the page shows. The loans are those of the viewer's view (`requestInputs`), as the report lists them:
 * a loan outside it is not found. Core names every line.
 */
async function explainLoans(s: Services, userId: string, figure: LoanFigureId, req: ExplainRequest): Promise<Explanation & { rows: NamedRow[] }> {
  if (req.accountIds || req.category || req.rowId || isOneLoan(figure) !== (req.loanId !== undefined)) throw new UserError("Tuntematon raportti.");
  const { ctx, accounts } = await s.analysis.get(s, userId, req.scope);
  const { balances, inputs } = await requestInputs(s, userId, accounts);
  const answer = explainLoan(figure, ctx, balances, inputs, req.loanId);
  if (!answer) throw new NotFound("Lainaa ei löydy.");
  if (answer.explanation.check.kind === "sum" && answer.explanation.check.diffCents !== 0) console.warn(`explain: ${figure} differs`);
  return { ...answer.explanation, rows: answer.names };
}
