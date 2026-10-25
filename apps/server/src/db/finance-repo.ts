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
import type { CategoryRule, ExpectedBill, FindingState, InputValue, IsoDate, Loan, MarkKind, PayerRole, Transaction } from "@banking/core";
import { type AccountPatch, AccountsRepo, type NewAccount } from "./finance/accounts.ts";
import { BalanceRecordRepo } from "./finance/balance-record.ts";
import { ForeignRowRepo } from "./finance/foreign-rows.ts";
import { StatementRepo } from "./finance/statements.ts";
import { ConnectionsRepo } from "./finance/connections.ts";
import type { FinanceContext } from "./finance/context.ts";
import { ExpectedBillsRepo } from "./finance/expected-bills.ts";
import { SpendingGoalRepo } from "./finance/spending-goal.ts";
import { LoansRepo } from "./finance/loans.ts";
import { MarksRepo } from "./finance/marks.ts";
import { PayerRolesRepo } from "./finance/payer-roles.ts";
import { type MerchantFilter, MerchantsRepo } from "./finance/merchants.ts";
import { OptimiseRepo } from "./finance/optimise.ts";
import type { OwnRows } from "./finance/part-sql.ts";
import { RulesRepo } from "./finance/rules.ts";
import { SyncRunsRepo } from "./finance/sync-runs.ts";
import { type TransactionFilter, TransactionListRepo } from "./finance/transaction-list.ts";
import { TransactionsRepo } from "./finance/transactions.ts";
import type { Connection, StoredTransaction, SyncRun } from "./rows.ts";
import type { Db, Statement } from "./types.ts";

export { WRITE_CHUNK } from "./finance/context.ts";
export type { NewAccount } from "./finance/accounts.ts";
export type { MerchantFilter, MerchantHistory, MerchantList, MerchantSummary, UncategorisedMerchant } from "./finance/merchants.ts";
export type { OwnRows } from "./finance/part-sql.ts";
export type { TransactionFilter } from "./finance/transaction-list.ts";
export { bankSignature, type StoredParty, searchText } from "./finance/transactions.ts";

export class FinanceRepo {
  private readonly accounts: AccountsRepo;
  private readonly balanceRecord: BalanceRecordRepo;
  private readonly foreignRows: ForeignRowRepo;
  private readonly statements: StatementRepo;
  private readonly connections: ConnectionsRepo;
  private readonly transactions: TransactionsRepo;
  private readonly list: TransactionListRepo;
  private readonly merchants: MerchantsRepo;
  private readonly rules: RulesRepo;
  private readonly marks: MarksRepo;
  private readonly payerRolesRepo: PayerRolesRepo;
  private readonly syncRuns: SyncRunsRepo;
  private readonly expectedBills: ExpectedBillsRepo;
  private readonly spendingGoals: SpendingGoalRepo;
  private readonly loans: LoansRepo;
  private readonly optimise: OptimiseRepo;

  constructor(
    db: Db,
    readonly userId: string,
  ) {
    const ctx: FinanceContext = { db, userId };
    this.accounts = new AccountsRepo(ctx);
    this.balanceRecord = new BalanceRecordRepo(ctx);
    this.foreignRows = new ForeignRowRepo(ctx);
    this.statements = new StatementRepo(ctx);
    this.connections = new ConnectionsRepo(ctx);
    this.transactions = new TransactionsRepo(ctx);
    this.list = new TransactionListRepo(ctx);
    this.rules = new RulesRepo(ctx);
    this.merchants = new MerchantsRepo(ctx, this.rules, this.list);
    this.marks = new MarksRepo(ctx);
    this.payerRolesRepo = new PayerRolesRepo(ctx);
    this.syncRuns = new SyncRunsRepo(ctx);
    this.expectedBills = new ExpectedBillsRepo(ctx);
    this.spendingGoals = new SpendingGoalRepo(ctx);
    this.loans = new LoansRepo(ctx);
    this.optimise = new OptimiseRepo(ctx);
  }

  // ── accounts (finance/accounts.ts) ───────────────────────
  listAccounts() { return this.accounts.listAccounts(); }
  getAccount(id: string) { return this.accounts.getAccount(id); }
  upsertAccount(a: NewAccount) { return this.accounts.upsertAccount(a); }
  updateAccount(id: string, patch: AccountPatch) { return this.accounts.updateAccount(id, patch); }
  setAccountBankDetails(id: string, d: Parameters<AccountsRepo["setAccountBankDetails"]>[1]) { return this.accounts.setAccountBankDetails(id, d); }
  deleteAccount(id: string) { return this.accounts.deleteAccount(id); }
  transactionsOfAccount(accountId: string) { return this.accounts.transactionsOfAccount(accountId); }
  mergeAccountInto(from: string, to: string, newIds: ReadonlyMap<string, string>) { return this.accounts.mergeAccountInto(from, to, newIds); }
  setAccountBalance(id: string, cents: number | null, at: string | null) { return this.accounts.setAccountBalance(id, cents, at); }
  negateLoanBalances() { return this.accounts.negateLoanBalances(); }
  recordBalances(...args: Parameters<BalanceRecordRepo["recordBalances"]>) { return this.balanceRecord.recordBalances(...args); }
  storeForeignRows(...args: Parameters<ForeignRowRepo["storeForeignRows"]>) { return this.foreignRows.storeForeignRows(...args); }
  foreignRowsOf(...args: Parameters<ForeignRowRepo["foreignRowsOf"]>) { return this.foreignRows.foreignRowsOf(...args); }
  // ── card statement rows (finance/statements.ts) ──────────
  statementBills() { return this.statements.statementBills(); }
  saveStatement(...args: Parameters<StatementRepo["saveStatement"]>) { return this.statements.saveStatement(...args); }
  deleteStatement(...args: Parameters<StatementRepo["deleteStatement"]>) { return this.statements.deleteStatement(...args); }
  setStatementDetached(...args: Parameters<StatementRepo["setStatementDetached"]>) { return this.statements.setStatementDetached(...args); }
  rowKeyHolders(...args: Parameters<StatementRepo["rowKeyHolders"]>) { return this.statements.rowKeyHolders(...args); }
  overlappingBill(...args: Parameters<StatementRepo["overlappingBill"]>) { return this.statements.overlappingBill(...args); }
  balancesOf(...args: Parameters<BalanceRecordRepo["balancesOf"]>) { return this.balanceRecord.balancesOf(...args); }
  askedFromOf(...args: Parameters<BalanceRecordRepo["askedFromOf"]>) { return this.balanceRecord.askedFromOf(...args); }
  bookedRowsFrom(...args: Parameters<BalanceRecordRepo["bookedRowsFrom"]>) { return this.balanceRecord.bookedRowsFrom(...args); }
  replaceDemoBalances(...args: Parameters<BalanceRecordRepo["replaceDemoBalances"]>) { return this.balanceRecord.replaceDemoBalances(...args); }
  seedBalancesFromAccounts() { return this.balanceRecord.seedBalancesFromAccounts(); }
  recordHistory(...args: Parameters<BalanceRecordRepo["recordHistory"]>) { return this.balanceRecord.recordHistory(...args); }
  recordFetch(...args: Parameters<BalanceRecordRepo["recordFetch"]>) { return this.balanceRecord.recordFetch(...args); }
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
  earliestBookingDate(accountId: string, source: string) { return this.transactions.earliestBookingDate(accountId, source); }
  pendingRows(accountId: string) { return this.transactions.pendingRows(accountId); }
  deletePendingStatement(accountId: string) { return this.transactions.deletePendingStatement(accountId); }
  upsertStatements(txs: Omit<StoredTransaction, "userId">[], importedAt: string) { return this.transactions.upsertStatements(txs, importedAt); }
  unprocessedStatements(at: string) { return this.transactions.unprocessedStatements(at); }
  unprocessedMark() { return this.transactions.unprocessedMark(); }
  clearUnprocessedMark(seen: string | null) { return this.transactions.clearUnprocessedMark(seen); }
  batch(statements: Statement[]) { return this.transactions.batch(statements); }
  batchInChunks(statements: Statement[]) { return this.transactions.batchInChunks(statements); }
  updateEnrichment(txs: Pick<Transaction, "id" | "category" | "categorySource" | "isTransfer">[]) { return this.transactions.updateEnrichment(txs); }
  updateMerchants(changes: { id: string; merchant: string }[]) { return this.transactions.updateMerchants(changes); }
  fillBankCodes(source: string, path: string, codeOf: (field: unknown) => string | null) { return this.transactions.fillBankCodes(source, path, codeOf); }
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
  incomingPayerRows() { return this.merchants.incomingPayerRows(); }
  matchedRowsOutside(merchants: readonly string[]) { return this.merchants.matchedRowsOutside(merchants); }
  uncategorisedSpending() { return this.merchants.uncategorisedSpending(); }
  registerLookupRows() { return this.merchants.registerLookupRows(); }
  merchantHistory(merchant: string, accountIds?: readonly string[], own?: OwnRows) { return this.merchants.merchantHistory(merchant, accountIds, own); }
  uncategorisedMerchants(limit?: number, own?: OwnRows) { return this.merchants.uncategorisedMerchants(limit, own); }
  merchantSummaries(f: MerchantFilter) { return this.merchants.merchantSummaries(f); }
  hasMerchant(merchant: string) { return this.merchants.hasMerchant(merchant); }
  industryCodes(sharedOwners?: readonly string[]) { return this.merchants.industryCodes(sharedOwners); }
  industryDetails(merchants: readonly string[], sharedOwners?: readonly string[]) { return this.merchants.industryDetails(merchants, sharedOwners); }

  // ── rules (finance/rules.ts) ─────────────────────────────
  listRules() { return this.rules.listRules(); }
  ruleCount() { return this.rules.ruleCount(); }
  hasMerchantRule(merchant: string) { return this.rules.hasMerchantRule(merchant); }
  setMerchantRule(merchant: string, category: string) { return this.rules.setMerchantRule(merchant, category); }
  deleteMerchantRules(merchant: string) { return this.rules.deleteMerchantRules(merchant); }
  deleteUnknownMerchantRules() { return this.rules.deleteUnknownMerchantRules(); }
  addRule(rule: Omit<CategoryRule, "id">) { return this.rules.addRule(rule); }
  setRuleCategory(ids: readonly number[], category: string) { return this.rules.setRuleCategory(ids, category); }
  renameMerchantRules(renames: ReadonlyMap<string, string>) { return this.rules.renameMerchantRules(renames); }
  settleMerchantRules(merchants: ReadonlySet<string>, keep?: ReadonlySet<string>) { return this.rules.settleMerchantRules(merchants, keep); }
  copyMerchantRules(groups: ReadonlyMap<string, readonly string[]>) { return this.rules.copyMerchantRules(groups); }
  deleteRule(id: number) { return this.rules.deleteRule(id); }

  // ── marks (finance/marks.ts) ─────────────────────────────
  listMarks() { return this.marks.listMarks(); }
  setMark(subject: string, mark: MarkKind, at: string) { return this.marks.setMark(subject, mark, at); }
  clearMark(subject: string) { return this.marks.clearMark(subject); }
  renameMerchantMarks(renames: ReadonlyMap<string, string>) { return this.marks.renameMerchantMarks(renames); }
  copyMerchantMarks(groups: ReadonlyMap<string, readonly string[]>) { return this.marks.copyMerchantMarks(groups); }

  // ── payer roles (finance/payer-roles.ts) ─────────────────
  payerRoles() { return this.payerRolesRepo.payerRoles(); }
  setPayerRole(key: string, role: PayerRole, at: string) { return this.payerRolesRepo.setPayerRole(key, role, at); }
  clearPayerRole(key: string) { return this.payerRolesRepo.clearPayerRole(key); }

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

  // ── spending goal (finance/spending-goal.ts) ─────────────
  spendingGoal() { return this.spendingGoals.spendingGoal(); }
  setSpendingGoal(cents: number, at: string) { return this.spendingGoals.setSpendingGoal(cents, at); }
  clearSpendingGoal() { return this.spendingGoals.clearSpendingGoal(); }

  // ── loans (finance/loans.ts) ─────────────────────────────
  listLoans() { return this.loans.listLoans(); }
  addLoan(loan: Loan, at: string) { return this.loans.addLoan(loan, at); }
  updateLoan(loan: Loan, at: string) { return this.loans.updateLoan(loan, at); }
  deleteLoan(id: string) { return this.loans.deleteLoan(id); }

  // ── optimise (finance/optimise.ts) ───────────────────────
  listInputs() { return this.optimise.listInputs(); }
  setInput(key: string, value: InputValue, asOf: IsoDate) { return this.optimise.setInput(key, value, asOf); }
  deleteInput(key: string) { return this.optimise.deleteInput(key); }
  listStates() { return this.optimise.listStates(); }
  setState(state: FindingState) { return this.optimise.setState(state); }
  clearState(findingId: string) { return this.optimise.clearState(findingId); }
  getSnapshot(month: string) { return this.optimise.getSnapshot(month); }
  putSnapshot(month: string, data: unknown, createdAt: string) { return this.optimise.putSnapshot(month, data, createdAt); }
  renameMerchantStates(renames: ReadonlyMap<string, string>) { return this.optimise.renameMerchantStates(renames); }
  copyMerchantStates(groups: ReadonlyMap<string, readonly string[]>) { return this.optimise.copyMerchantStates(groups); }
}
