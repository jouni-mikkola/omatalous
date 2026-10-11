/**
 * All financial data access for ONE user. Every query is filtered by the
 * user id given to the constructor, and every insert stores it, so services
 * holding a FinanceRepo cannot read or change another user's data by mistake.
 * Cross-user reads (household view) go through HouseholdRepo instead.
 *
 * The SQL lives in the modules of db/finance/, one per concern, all over the same `{ db, userId }` context. This
 * class only builds them and hands each call to its module, so callers keep one object and one set of methods. A
 * new method goes into its module first, then here. Docs sit on the module's method.
 */
import type { AccountType, CategoryRule, ExpectedBill, MarkKind, Transaction } from "@banking/core";
import { AccountsRepo, type NewAccount } from "./finance/accounts.ts";
import { ConnectionsRepo } from "./finance/connections.ts";
import type { FinanceContext } from "./finance/context.ts";
import { ExpectedBillsRepo } from "./finance/expected-bills.ts";
import { MarksRepo } from "./finance/marks.ts";
import { MerchantsRepo } from "./finance/merchants.ts";
import { RulesRepo } from "./finance/rules.ts";
import { SyncRunsRepo } from "./finance/sync-runs.ts";
import { type TransactionFilter, TransactionListRepo } from "./finance/transaction-list.ts";
import { TransactionsRepo } from "./finance/transactions.ts";
import type { Connection, StoredTransaction, SyncRun } from "./rows.ts";
import type { Db, Statement } from "./types.ts";

export { WRITE_CHUNK } from "./finance/context.ts";
export type { NewAccount } from "./finance/accounts.ts";
export type { MerchantHistory, MerchantSummary, UncategorisedMerchant } from "./finance/merchants.ts";
export type { TransactionFilter } from "./finance/transaction-list.ts";
export { bankSignature, type StoredParty, searchText } from "./finance/transactions.ts";

export class FinanceRepo {
  private readonly accounts: AccountsRepo;
  private readonly connections: ConnectionsRepo;
  private readonly transactions: TransactionsRepo;
  private readonly list: TransactionListRepo;
  private readonly merchants: MerchantsRepo;
  private readonly rules: RulesRepo;
  private readonly marks: MarksRepo;
  private readonly syncRuns: SyncRunsRepo;
  private readonly expectedBills: ExpectedBillsRepo;

  constructor(
    db: Db,
    readonly userId: string,
  ) {
    const ctx: FinanceContext = { db, userId };
    this.accounts = new AccountsRepo(ctx);
    this.connections = new ConnectionsRepo(ctx);
    this.transactions = new TransactionsRepo(ctx);
    this.list = new TransactionListRepo(ctx);
    this.rules = new RulesRepo(ctx);
    this.merchants = new MerchantsRepo(ctx, this.rules, this.list);
    this.marks = new MarksRepo(ctx);
    this.syncRuns = new SyncRunsRepo(ctx);
    this.expectedBills = new ExpectedBillsRepo(ctx);
  }

  // ── accounts (finance/accounts.ts) ───────────────────────
  listAccounts() { return this.accounts.listAccounts(); }
  getAccount(id: string) { return this.accounts.getAccount(id); }
  upsertAccount(a: NewAccount) { return this.accounts.upsertAccount(a); }
  updateAccount(id: string, patch: { name?: string; type?: AccountType }) { return this.accounts.updateAccount(id, patch); }
  setAccountIbanIfMissing(id: string, iban: string) { return this.accounts.setAccountIbanIfMissing(id, iban); }
  deleteAccount(id: string) { return this.accounts.deleteAccount(id); }
  transactionsOfAccount(accountId: string) { return this.accounts.transactionsOfAccount(accountId); }
  mergeAccountInto(from: string, to: string, newIds: ReadonlyMap<string, string>) { return this.accounts.mergeAccountInto(from, to, newIds); }
  setAccountBalance(id: string, cents: number, at: string) { return this.accounts.setAccountBalance(id, cents, at); }
  markAccountSynced(id: string, at: string) { return this.accounts.markAccountSynced(id, at); }
  deleteProviderData(provider: string) { return this.accounts.deleteProviderData(provider); }

  // ── connections (finance/connections.ts) ─────────────────
  listConnections() { return this.connections.listConnections(); }
  upsertConnection(c: Omit<Connection, "userId">) { return this.connections.upsertConnection(c); }
  setConnectionStatus(id: string, status: Connection["status"]) { return this.connections.setConnectionStatus(id, status); }
  markConnectionSynced(id: string, at: string) { return this.connections.markConnectionSynced(id, at); }

  // ── transactions (finance/transactions.ts) ───────────────
  allTransactions() { return this.transactions.allTransactions(); }
  allTransactionsWithSearchText() { return this.transactions.allTransactionsWithSearchText(); }
  getTransaction(id: string) { return this.transactions.getTransaction(id); }
  transactionKeys(accountId: string, from: string, to: string) { return this.transactions.transactionKeys(accountId, from, to); }
  latestBookingDate(accountId: string, source: string) { return this.transactions.latestBookingDate(accountId, source); }
  pendingRows(accountId: string) { return this.transactions.pendingRows(accountId); }
  deletePendingByIdStatement(accountId: string, id: string) { return this.transactions.deletePendingByIdStatement(accountId, id); }
  deletePendingStatement(accountId: string) { return this.transactions.deletePendingStatement(accountId); }
  upsertStatements(txs: Omit<StoredTransaction, "userId">[], importedAt: string) { return this.transactions.upsertStatements(txs, importedAt); }
  unprocessedStatements(at: string) { return this.transactions.unprocessedStatements(at); }
  unprocessedMark() { return this.transactions.unprocessedMark(); }
  clearUnprocessedMark(seen: string | null) { return this.transactions.clearUnprocessedMark(seen); }
  batch(statements: Statement[]) { return this.transactions.batch(statements); }
  batchInChunks(statements: Statement[]) { return this.transactions.batchInChunks(statements); }
  updateEnrichment(txs: Pick<Transaction, "id" | "category" | "categorySource" | "isTransfer">[]) { return this.transactions.updateEnrichment(txs); }
  updateMerchants(changes: { id: string; merchant: string }[]) { return this.transactions.updateMerchants(changes); }
  refreshSearchText() { return this.transactions.refreshSearchText(); }
  writeSearchText(rows: readonly { id: string; merchant: string; counterparty: string | null; description: string | null; searchText: string | null }[]) {
    return this.transactions.writeSearchText(rows);
  }
  setUserCategory(id: string, category: string | null) { return this.transactions.setUserCategory(id, category); }

  // ── the transaction list and the export (finance/transaction-list.ts) ──
  listTransactions(f: TransactionFilter, accountIds?: readonly string[]) { return this.list.listTransactions(f, accountIds); }
  exportPage(f: TransactionFilter, accountIds: readonly string[] | undefined, limit: number, after?: { date: string; id: string }) {
    return this.list.exportPage(f, accountIds, limit, after);
  }

  // ── merchants and trade register answers (finance/merchants.ts) ──
  transactionsOfMerchants(merchants: readonly string[]) { return this.merchants.transactionsOfMerchants(merchants); }
  merchantNames() { return this.merchants.merchantNames(); }
  matchedRowsOutside(merchants: readonly string[]) { return this.merchants.matchedRowsOutside(merchants); }
  uncategorisedSpending() { return this.merchants.uncategorisedSpending(); }
  merchantHistory(merchant: string, accountIds?: readonly string[]) { return this.merchants.merchantHistory(merchant, accountIds); }
  uncategorisedMerchants(limit?: number) { return this.merchants.uncategorisedMerchants(limit); }
  merchantSummaries(f: { q?: string; category?: string; limit: number }) { return this.merchants.merchantSummaries(f); }
  hasMerchant(merchant: string) { return this.merchants.hasMerchant(merchant); }
  industryCodes() { return this.merchants.industryCodes(); }
  industryDetails(merchants: readonly string[], sharedOwners?: readonly string[]) { return this.merchants.industryDetails(merchants, sharedOwners); }

  // ── rules (finance/rules.ts) ─────────────────────────────
  listRules() { return this.rules.listRules(); }
  ruleCount() { return this.rules.ruleCount(); }
  hasMerchantRule(merchant: string) { return this.rules.hasMerchantRule(merchant); }
  setMerchantRule(merchant: string, category: string) { return this.rules.setMerchantRule(merchant, category); }
  deleteMerchantRules(merchant: string) { return this.rules.deleteMerchantRules(merchant); }
  addRule(rule: Omit<CategoryRule, "id">) { return this.rules.addRule(rule); }
  renameMerchantRules(renames: ReadonlyMap<string, string>) { return this.rules.renameMerchantRules(renames); }
  deleteRule(id: number) { return this.rules.deleteRule(id); }

  // ── marks (finance/marks.ts) ─────────────────────────────
  listMarks() { return this.marks.listMarks(); }
  setMark(subject: string, mark: MarkKind, at: string) { return this.marks.setMark(subject, mark, at); }
  clearMark(subject: string) { return this.marks.clearMark(subject); }
  renameMerchantMarks(renames: ReadonlyMap<string, string>) { return this.marks.renameMerchantMarks(renames); }

  // ── sync runs (finance/sync-runs.ts) ─────────────────────
  startSyncRun(trigger: string) { return this.syncRuns.startSyncRun(trigger); }
  finishSyncRun(id: number, r: Pick<SyncRun, "status" | "fetched" | "inserted" | "message">) { return this.syncRuns.finishSyncRun(id, r); }
  failInterruptedSyncRuns() { return this.syncRuns.failInterruptedSyncRuns(); }
  pruneSyncRuns(keep?: number) { return this.syncRuns.pruneSyncRuns(keep); }
  listSyncRuns(limit?: number) { return this.syncRuns.listSyncRuns(limit); }

  // ── expected bills (finance/expected-bills.ts) ───────────
  listExpectedBills() { return this.expectedBills.listExpectedBills(); }
  addExpectedBill(bill: ExpectedBill, createdAt: string) { return this.expectedBills.addExpectedBill(bill, createdAt); }
  deleteExpectedBill(id: string) { return this.expectedBills.deleteExpectedBill(id); }
}
