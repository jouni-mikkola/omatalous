/**
 * Card statement rows: what a member typed in from a statement to say what one card bill paid for. This is the one
 * place that writes them and the one that reads them for a view. The rules are core's (`statement-explain.ts`); what is
 * checked here is what only the stored row and the request can say: whose bill it is, that it is a booked card bill, the
 * period, the sum against the bill as stored, duplicates and overlap, and the size.
 */
import {
  compileRules,
  categorize,
  fold,
  isExplainableBill,
  normalizeMerchant,
  periodProblem,
  isRealDay,
  STATEMENT_MAX_BYTES,
  STATEMENT_MAX_ROW_CENTS,
  STATEMENT_MAX_ROWS,
  STATEMENT_TEXT_MAX,
  type Part,
  type StatementBill,
} from "@banking/core";
import { isEuro } from "../connectors/balance-sign.ts";
import { accountKey } from "../db/household-repo.ts";
import type { StoredAccount, StoredTransaction } from "../db/rows.ts";
import { NotFound, UserError } from "../platform/errors.ts";
import { stableId } from "../platform/ids.ts";
import { strictObject } from "../platform/validate.ts";
import type { Services } from "./context.ts";

/** A refusal the page tells apart by `code`; `detail` is what the page needs to say more (the excess, the bill a row is already under). */
export class StatementRefusal extends UserError {
  constructor(
    message: string,
    readonly status: 409 | 422 | 429,
    readonly code: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

interface StatementInput {
  periodFrom: string;
  periodTo: string;
  statementCents: number | null;
  rows: { day: string; cents: number; text: string }[];
}

const bad = (message: string) => new UserError(message);

/** The request body, shaped: only a period, the statement's sum and rows of a day, a sum and a text. Anything else is refused. */
export function parseStatement(body: unknown): StatementInput {
  const input = strictObject(body, ["periodFrom", "periodTo", "statementCents", "rows"] as const);
  const { periodFrom, periodTo, statementCents, rows } = input;
  if (typeof periodFrom !== "string" || typeof periodTo !== "string") throw bad("Virheellinen jakso.");
  if (statementCents !== undefined && statementCents !== null && (!Number.isSafeInteger(statementCents) || (statementCents as number) <= 0 || (statementCents as number) > STATEMENT_MAX_ROW_CENTS)) throw bad("Virheellinen summa.");
  if (!Array.isArray(rows) || !rows.length) throw bad("Rivejä ei ole.");
  if (rows.length > STATEMENT_MAX_ROWS) throw new StatementRefusal("Rivejä on liikaa.", 422, "too_many_rows", { max: STATEMENT_MAX_ROWS });
  let bytes = 0;
  const out = rows.map((r: unknown) => {
    const { day, cents, text } = strictObject(r, ["day", "cents", "text"] as const);
    if (typeof day !== "string" || typeof text !== "string" || typeof cents !== "number" || !Number.isSafeInteger(cents) || cents === 0 || Math.abs(cents) > STATEMENT_MAX_ROW_CENTS) throw bad("Virheellinen rivi.");
    const clean = text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").trim();
    if (!clean || Array.from(clean).length > STATEMENT_TEXT_MAX) throw new StatementRefusal("Rivin teksti on tyhjä tai liian pitkä.", 422, "bad_row");
    bytes += Buffer.byteLength(clean);
    return { day, cents, text: clean };
  });
  if (bytes > STATEMENT_MAX_BYTES) throw new StatementRefusal("Rivit ovat liian suuret.", 422, "too_large", { max: STATEMENT_MAX_BYTES });
  return { periodFrom, periodTo, statementCents: (statementCents as number | null | undefined) ?? null, rows: out };
}

/** The key of a row for finding it again: its day, sum and text, and which of the same three it is within the statement. */
function rowKeysOf(rows: readonly { day: string; cents: number; text: string }[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.day}|${r.cents}|${fold(r.text)}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return stableId(`${base}|${occurrence}`);
  });
}

/** Writes one bill's statement: the whole set of rows replaces what was there. The bill must be the user's own booked card bill. */
export async function saveStatement(s: Services, userId: string, billId: string, input: StatementInput): Promise<void> {
  const repo = s.finance(userId);
  const bill = await repo.getTransaction(billId);
  if (!bill) throw new NotFound("Laskua ei löydy.");
  const account = await repo.getAccount(bill.accountId);
  if (bill.status !== "booked") throw new StatementRefusal("Lasku ei ole vielä kirjattu.", 409, "not_booked");
  if (!account || !isExplainableBill(bill, account.type)) throw new StatementRefusal("Tämä ei ole korttilasku.", 409, "not_a_card_bill");
  if (!isEuro(bill.currency)) throw new StatementRefusal("Vain euromääräinen lasku käy.", 422, "not_euro");
  const problem = periodProblem(input.periodFrom, input.periodTo, bill.bookingDate);
  if (problem) throw new StatementRefusal("Jakso ei sovi laskuun.", 422, "bad_period", { problem });
  for (const r of input.rows) {
    if (!isRealDay(r.day) || r.day < input.periodFrom || r.day > input.periodTo) throw new StatementRefusal("Rivin päivä on jakson ulkopuolella.", 422, "day_out_of_period", { day: r.day });
  }
  const whole = -bill.amountCents;
  const sum = input.rows.reduce((n, r) => n + r.cents, 0);
  if (sum < 0) throw new StatementRefusal("Rivien summa on negatiivinen.", 422, "negative_sum", { sumCents: sum });
  if (sum > whole) throw new StatementRefusal("Rivien summa on yli laskun.", 422, "over_bill", { excessCents: sum - whole });
  const key = accountKey(account);
  const keys = rowKeysOf(input.rows);
  const held = await repo.rowKeyHolders(key, keys, billId);
  if (held.size) throw new StatementRefusal("Rivi on jo toisella laskulla.", 409, "duplicate_elsewhere", { billId: [...held.values()][0] });
  // after the duplicates: a row typed under two bills is told as that, and the period only when no row is the cause
  const other = await repo.overlappingBill(key, input.periodFrom, input.periodTo, billId);
  if (other) throw new StatementRefusal("Jakso osuu saman tilin toiseen laskuun.", 422, "period_overlap", { billId: other });
  await repo.saveStatement(
    { billId, accountKey: key, periodFrom: input.periodFrom, periodTo: input.periodTo, statementCents: input.statementCents },
    input.rows.map((r, i) => ({ id: stableId(`${billId}|${keys[i]}`), day: r.day, cents: r.cents, text: r.text, rowKey: keys[i]! })),
    s.now().toISOString(),
  );
  await syncStatementState(s, userId);
}

/** Takes a bill's statement away: the bill counts whole again. */
export async function removeStatement(s: Services, userId: string, billId: string): Promise<void> {
  if (!(await s.finance(userId).deleteStatement(billId, s.now().toISOString()))) throw new NotFound("Erittelyä ei löydy.");
}

/**
 * Sets aside what the context says is not read for a reason that can pass (the bank covers the period, the bill is no card
 * bill now, it is not booked), and attaches again what is read. Nothing is deleted. Runs once per write (a save, an undo) and
 * after a reprocess, never on a read: the context is built once and nothing here changes what it was built from, so it cannot
 * call itself.
 */
export async function syncStatementState(s: Services, userId: string): Promise<void> {
  const repo = s.finance(userId);
  const stored = await repo.statementBills();
  if (!stored.length) return;
  const { ctx } = await s.analysis.get(s, userId, "own");
  const at = s.now().toISOString();
  for (const st of stored) {
    const state = ctx.statements.get(st.billId);
    if (!state) continue;
    if (state.read) {
      if (st.detachedAt) await repo.setStatementDetached(st.billId, null, null);
    } else if (state.reason === "covered" || state.reason === "not_card_bill" || state.reason === "not_booked") {
      if (st.detachedReason !== state.reason) await repo.setStatementDetached(st.billId, at, state.reason);
    }
  }
}

/** What the page shows of the user's statements: each with whether its rows count and why not, the explained sum and what the bill leaves. */
export async function statementsView(s: Services, userId: string): Promise<unknown[]> {
  const repo = s.finance(userId);
  const { ctx } = await s.analysis.get(s, userId, "own");
  const bills = new Map((await repo.allTransactions()).map((t) => [t.id, t]));
  return (await repo.statementBills()).map((st) => {
    const bill = bills.get(st.billId);
    const explained = st.rows.reduce((n, r) => n + r.cents, 0);
    const state = ctx.statements.get(st.billId);
    return {
      billId: st.billId,
      periodFrom: st.periodFrom,
      periodTo: st.periodTo,
      statementCents: st.statementCents,
      billCents: bill ? -bill.amountCents : null,
      explainedCents: explained,
      restCents: bill ? -bill.amountCents - explained : null,
      // "erotus": what the statement says against what the rows come to, and against the bill; the figures use the bill
      differenceCents: st.statementCents === null ? null : st.statementCents - explained,
      statementVsBillCents: st.statementCents === null || !bill ? null : st.statementCents + bill.amountCents,
      read: state?.read ?? false,
      reason: state && !state.read ? state.reason : null,
      detached: st.detachedAt ? { at: st.detachedAt, reason: st.detachedReason } : null,
      rows: st.rows.map(({ day, cents, text }) => ({ day, cents, text })),
    };
  });
}

/**
 * The statements a view reads: those of the owners of the accounts in it, for the bills whose row is in `txs` and belongs to
 * the member who wrote the statement. A row's category is its writer's rules'. `parts` is the viewer's part of each account.
 */
export async function statementsInView(s: Services, accounts: readonly StoredAccount[], txs: readonly StoredTransaction[], parts: ReadonlyMap<string, Part>): Promise<StatementBill[]> {
  const owners = [...new Set(accounts.map((a) => a.userId))];
  const billOf = new Map(txs.map((t) => [t.id, t]));
  const out: StatementBill[] = [];
  for (const owner of owners) {
    const stored = (await s.finance(owner).statementBills()).filter((st) => billOf.get(st.billId)?.userId === owner);
    if (!stored.length) continue;
    const rules = compileRules(await s.finance(owner).listRules());
    for (const st of stored) {
      const part = parts.get(billOf.get(st.billId)!.accountId);
      out.push({
        billId: st.billId,
        periodFrom: st.periodFrom,
        periodTo: st.periodTo,
        ...(part ? { part } : {}),
        rows: st.rows.map((r) => ({
          id: r.id,
          day: r.day,
          cents: r.cents,
          text: r.text,
          // read as a purchase whatever its sign: a refund takes its shop's category in core
          category: categorize({ merchant: normalizeMerchant(null, r.text), counterparty: null, description: r.text, mcc: null, amountCents: -Math.abs(r.cents) }, rules, accounts).category,
        })),
      });
    }
  }
  return out;
}
