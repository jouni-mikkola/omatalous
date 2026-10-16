/**
 * "Tuo tiedot": reads the file of "Vie kaikki tiedot" (docs/DATA_EXPORT.md) into the signed-in user's own data. The page
 * sends the file in chunks to a session (`startImport`, `addChunk`); `dryRun` says what would happen and writes nothing;
 * `commitImport` adds the missing rows in one transaction and then processes the transactions once. The file is hostile
 * until proved otherwise: every value is checked as it is staged, every reference must point inside the file or to a row
 * the user has here, and nothing is ever updated or deleted. No user, password, session, second factor or token is made.
 */
import { type ClosedMonth, getCategory, normalizeIban, PAYER_ROLES } from "@banking/core";
import { type OwnAccount, ImportRepo, type IdTable } from "../db/import-repo.ts";
import { bankSignature, searchText } from "../db/finance-repo.ts";
import { randomToken } from "../platform/ids.ts";
import { UserError } from "../platform/errors.ts";
import { yieldToLoop } from "../platform/yield.ts";
import type { Statement } from "../db/types.ts";
import type { Services } from "./context.ts";
import { reprocess } from "./enrich.ts";
import { importedAgreementValue, importedMonthRefusal, weightedKeys } from "./settlement.ts";
import { expiry, open, refuse, sessionOf, type ImportHead, type Row, type Session, type User } from "./data-import-session.ts";

export { addChunk, cancelImport, startImport } from "./data-import-session.ts";
import { IMPORT_BY_KEY, IMPORT_STORES, NEVER_WRITTEN, type ImportStore } from "./data-import-stores.ts";


/** Why a row is not added: it is another user's, a kind of row this import never writes, household-wide and the user is not the admin, or a settlement row the user may not bring (`refused`). */
type SkipReason = "other_user" | "users" | "sharing" | "household" | "refused";

interface StoreCounts {
  key: string;
  add: number;
  exists: number;
  skipped: { reason: SkipReason; n: number }[];
}

/** The answer of a dry run, and of a commit (with `committed`). */
interface ImportPlan {
  session: string;
  expiresAt: string;
  head: ImportHead;
  stores: StoreCounts[];
  /** The people the file names who are not the signed-in user: their rows are never written. */
  otherUsers: { username: string; rows: number }[];
  /** Stores of the file this import does not know (rows counted), and keys of known rows it does not know (counted). */
  ignored: { stores: { key: string; rows: number }[]; keys: number };
  total: { add: number; exists: number; skipped: number };
  committed: boolean;
}

/** What the route layer lends the import: the loan form's own checks (the services do not import routes). */
export interface ImportChecks {
  loan(fields: Record<string, unknown>, accounts: { getAccount(id: string): Promise<{ id: string; type: string } | null> }): Promise<unknown>;
}

/** The checks of the plan that read the whole file: a reference that points nowhere refuses it. */
function dangling(s: Services, ses: Session, store: ImportStore, i: number, column: string): never {
  refuse(s, ses, `Tiedoston kohdan ${store.key} rivi ${i + 1} viittaa riviin (${column}), jota tiedostossa tai tässä sovelluksessa ei ole.`);
}

/** Whether a column takes null. */
const nullable = (check: (v: unknown) => unknown) => {
  try {
    check(null);
    return true;
  } catch {
    return false;
  }
};

const camel = (k: string) => k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const LOAN_COLUMNS = ["name", "lender", "kind", "granted_cents", "balance_cents", "balance_date", "rate_bp", "reference", "margin_bp", "repayment", "interval_months", "payment_cents", "end_date", "limit_cents", "series_key", "account_id", "rate_review_date"];

interface Planned {
  plan: ImportPlan;
  statements: Statement[];
  accountKeyRows: number;
}

/**
 * An asset id that is here with another kind or name is not the same asset: its rows get a fresh id (all days of it alike),
 * so no row lands under an asset it does not describe. An id the file itself uses for two kinds is cut the same way.
 */
async function oneKindPerAsset(repo: ImportRepo, staged: { row: Row; key: string }[], store: ImportStore): Promise<void> {
  const claimed = await repo.assetKinds(staged.map((x) => String(x.row.id)));
  const fresh = new Map<string, string>();
  for (const x of staged) {
    const id = String(x.row.id);
    const what = JSON.stringify([x.row.kind, x.row.name]);
    const known = claimed.get(id);
    if (!known) claimed.set(id, new Set([what]));
    else if (!known.has(what)) {
      const cut = JSON.stringify([id, what]);
      x.row.id = fresh.get(cut) ?? fresh.set(cut, randomToken()).get(cut)!;
      x.key = JSON.stringify(store.pk.map((c) => x.row[c] ?? null));
    }
  }
}

/**
 * What the file does to this user's data, worked out against the rows that exist now and nothing written. Every row is
 * added, kept (it exists: same key) or skipped with a reason. Run again at the commit, so the answer is of that moment.
 */
async function buildPlan(s: Services, ses: Session, committed: boolean, checks: ImportChecks): Promise<Planned> {
  const repo = new ImportRepo(s.db);
  const me = ses.user;
  const rowsOf = (key: string) => ses.rows.get(key) ?? [];
  const statements: Statement[] = [];
  const counts = new Map<string, StoreCounts>();
  const others = new Map<string, number>();
  const tally = (key: string) => counts.get(key) ?? counts.set(key, { key, add: 0, exists: 0, skipped: [] }).get(key)!;
  const skip = (key: string, reason: SkipReason, who?: string) => {
    const t = tally(key);
    const r = t.skipped.find((x) => x.reason === reason);
    if (r) r.n++;
    else t.skipped.push({ reason, n: 1 });
    if (who !== undefined) others.set(who, (others.get(who) ?? 0) + 1);
  };
  let accountKeyRows = 0;

  // the people the file names; the signed-in user is the one whose username is theirs
  const fileUsers = new Map<string, string>();
  for (const [i, u] of rowsOf("users").entries()) {
    if (fileUsers.has(String(u.id))) dangling(s, ses, IMPORT_BY_KEY.get("users")!, i, "id");
    fileUsers.set(String(u.id), String(u.username));
  }
  const usernameOf = (store: ImportStore, i: number, column: string, fileId: unknown) => {
    const name = fileUsers.get(String(fileId));
    return name ?? dangling(s, ses, store, i, column);
  };

  // accounts: the user's own are matched to the ones here (id, identity, then IBAN); a new one has no bank link
  const accountStore = IMPORT_BY_KEY.get("accounts")!;
  const local: OwnAccount[] = await repo.accountsOf(me.id);
  const localById = new Map(local.map((a) => [a.id, a]));
  const localKeys = new Set(local.map((a) => a.identity ?? a.id));
  const accMap = new Map<string, string>();
  const createdAccounts = new Set<string>();
  const keyMap = new Map<string, string>();
  const otherAcc = new Map<string, string>();
  const otherKey = new Map<string, string>();
  const accountRows = rowsOf("accounts");
  const takenAccounts = await repo.taken("accounts", accountRows.map((r) => String(r.id)));
  // what the other users of this instance hold: a key (id or identity) or an IBAN of theirs is never taken into this user's data
  const othersHold = await repo.accountsOfOthers(me.id);
  const heldKeys = new Set(othersHold.flatMap((a) => [a.id, ...(a.identity ? [a.identity] : [])]));
  const heldIbans = new Set(othersHold.flatMap((a) => normalizeIban(a.iban) ?? []));
  for (const [i, row] of accountRows.entries()) {
    const fid = String(row.id);
    const owner = usernameOf(accountStore, i, "user_id", row.user_id);
    if (row["@owner_username"] !== undefined && row["@owner_username"] !== owner) dangling(s, ses, accountStore, i, "owner_username");
    const fileKey = (row.identity as string | null) ?? fid;
    if (owner !== me.username) {
      otherAcc.set(fid, owner);
      if (!keyMap.has(fileKey)) otherKey.set(fileKey, owner);
      skip("accounts", "other_user", owner);
      continue;
    }
    if (accMap.has(fid)) {
      tally("accounts").exists++;
      continue;
    }
    const iban = normalizeIban(row.iban as string | null);
    const found = localById.get(fid) ?? local.find((a) => row.identity !== null && a.identity === row.identity) ?? (iban ? local.find((a) => normalizeIban(a.iban) === iban) : undefined);
    if (found) {
      accMap.set(fid, found.id);
      keyMap.set(fileKey, found.identity ?? found.id);
      otherKey.delete(fileKey);
      tally("accounts").exists++;
      continue;
    }
    // an account another user holds and this user does not is joined by linking the bank, never by the file: no identity, so its key is its own id
    const held = (row.identity !== null && heldKeys.has(String(row.identity))) || (iban !== null && heldIbans.has(iban));
    const identity = held ? null : (row.identity as string | null);
    const newId = takenAccounts.has(fid) || (identity === null && heldKeys.has(fid)) ? randomToken() : fid;
    const added: OwnAccount = { id: newId, identity, iban: row.iban as string | null, type: String(row.type) };
    local.push(added);
    createdAccounts.add(newId);
    localById.set(newId, added);
    accMap.set(fid, newId);
    keyMap.set(fileKey, added.identity ?? newId);
    otherKey.delete(fileKey);
    statements.push(
      ImportRepo.insert("accounts", {
        id: newId, user_id: me.id, connection_id: null, provider: row.provider === "demo" ? "demo" : "csv", external_id: null, identity: added.identity, name: row.name!, iban: added.iban,
        currency: row.currency!, type: added.type, balance_cents: row.balance_cents!, balance_at: row.balance_at!, last_synced_at: null, created_at: row.created_at!, custom_name: row.custom_name!,
        holder: row.holder!, card_mask: row.card_mask!, credit_limit_cents: row.credit_limit_cents!,
      }),
    );
    tally("accounts").add++;
  }

  // transactions: by id first, then by the bank signature a later fetch matches on (one stored row used once)
  const txStore = IMPORT_BY_KEY.get("transactions")!;
  const txMap = new Map<string, string>();
  const otherTx = new Set<string>();
  const newTx = new Set<string>();
  const candidates: { row: Row; i: number; account: string }[] = [];
  for (const [i, row] of rowsOf("transactions").entries()) {
    const owner = usernameOf(txStore, i, "user_id", row.user_id);
    if (row["@owner_username"] !== undefined && row["@owner_username"] !== owner) dangling(s, ses, txStore, i, "owner_username");
    if (owner !== me.username) {
      otherTx.add(String(row.id));
      skip("transactions", "other_user", owner);
      continue;
    }
    const fa = String(row.account_id);
    const account = accMap.get(fa) ?? (!otherAcc.has(fa) && localById.has(fa) ? fa : undefined);
    if (account === undefined) dangling(s, ses, txStore, i, "account_id");
    candidates.push({ row, i, account });
  }
  const byId = await repo.present("transactions", ["user_id", "id"], candidates.map((c) => [me.id, String(c.row.id)]));
  const idsTaken = await repo.taken("transactions", candidates.filter((c) => !byId.has(JSON.stringify([me.id, String(c.row.id)]))).map((c) => String(c.row.id)));
  const pool = new Map<string, string[]>();
  const signatureOf = (r: { bookingDate: string; valueDate: string | null; amountCents: number; status: string; counterparty: string | null; counterpartyIban: string | null; description: string | null; reference: string | null; mcc: string | null; bankTxnCode: string | null; merchant: string }) => bankSignature(r);
  const poolAccounts = [...new Set(candidates.map((c) => c.account))].filter((a) => !createdAccounts.has(a));
  if (poolAccounts.length) {
    for (const t of await repo.transactionsOf(me.id, poolAccounts)) {
      if (byId.has(JSON.stringify([me.id, t.id]))) continue;
      const k = `${t.accountId}|${signatureOf(t)}`;
      pool.set(k, [...(pool.get(k) ?? []), t.id]);
    }
  }
  let n = 0;
  for (const { row, account } of candidates) {
    if (++n % 5000 === 0) await yieldToLoop();
    const fid = String(row.id);
    if (txMap.has(fid)) {
      tally("transactions").exists++;
      continue;
    }
    if (byId.has(JSON.stringify([me.id, fid]))) {
      txMap.set(fid, fid);
      tally("transactions").exists++;
      continue;
    }
    const sig = `${account}|${signatureOf({ bookingDate: String(row.booking_date), valueDate: row.value_date as string | null, amountCents: Number(row.amount_cents), status: String(row.status), counterparty: row.counterparty as string | null, counterpartyIban: row.counterparty_iban as string | null, description: row.description as string | null, reference: row.reference as string | null, mcc: row.mcc as string | null, bankTxnCode: row.bank_txn_code as string | null, merchant: String(row.merchant) })}`;
    const same = pool.get(sig);
    if (same?.length) {
      txMap.set(fid, same.shift()!);
      tally("transactions").exists++;
      continue;
    }
    const id = idsTaken.has(fid) ? randomToken() : fid;
    txMap.set(fid, id);
    newTx.add(id);
    // a category this release does not know is left to the processing that follows
    const known = getCategory(String(row.category)).id === row.category;
    statements.push(
      ImportRepo.insert("transactions", {
        id, user_id: me.id, account_id: account, booking_date: row.booking_date!, value_date: row.value_date!, amount_cents: row.amount_cents!, currency: row.currency!, status: row.status!,
        counterparty: row.counterparty!, counterparty_iban: row.counterparty_iban!, description: row.description!, reference: row.reference!, mcc: row.mcc!, merchant: row.merchant!,
        category: known ? row.category! : "other", category_source: known ? row.category_source! : "default", is_transfer: row.is_transfer!, source: row.source!, raw: null,
        imported_at: row.imported_at!, search_text: searchText({ merchant: String(row.merchant), counterparty: row.counterparty as string | null, description: row.description as string | null }),
        bank_txn_code: row.bank_txn_code!,
      }),
    );
    tally("transactions").add++;
  }

  // a pool or card the user is weighted in: as the household says now, or (an account this import adds) as the file says of the user, who weighs 1 unless it says 0
  // the closed months of the pools this import has worked out, to hold a given month against
  const worked = new Map<string, Map<string, ClosedMonth> | null>();
  const weighted = new Set(await weightedKeys(s, me.id, [...localKeys]));
  const zero = new Set(rowsOf("accountUse").filter((r) => r.weight === 0 && r.user_id !== null && fileUsers.get(String(r.user_id)) === me.username).map((r) => keyMap.get(String(r.account_key)) ?? String(r.account_key)));
  for (const id of createdAccounts) {
    const a = localById.get(id)!;
    if (!zero.has(a.identity ?? a.id)) weighted.add(a.identity ?? a.id);
  }

  // the other stores, each row by its key: another user's skipped, the user's own added unless the table has the key
  const billsHere = new Set<string>();
  const NOT_STORES = new Set(["users", "accounts", "transactions", "accountShares"]);
  for (const store of IMPORT_STORES) {
    const rows = rowsOf(store.key);
    if (store.key === "accountShares" && rows.length) {
      tally(store.key).skipped.push({ reason: NEVER_WRITTEN.accountShares!, n: rows.length });
      continue;
    }
    if (NOT_STORES.has(store.key) || !rows.length) continue;
    const unresolvedTx = new Set<string>();
    if (store.tx) for (const r of rows) if (!txMap.has(String(r[store.tx])) && !otherTx.has(String(r[store.tx]))) unresolvedTx.add(String(r[store.tx]));
    const localTx = unresolvedTx.size ? new Set([...(await repo.present("transactions", ["user_id", "id"], [...unresolvedTx].map((t) => [me.id, t])))].map((k) => (JSON.parse(k) as string[])[1]!)) : new Set<string>();
    const staged: { row: Row; i: number; key: string }[] = [];
    for (const [i, row] of rows.entries()) {
      const mapped: Row = { ...row };
      for (const k of Object.keys(mapped)) if (k.startsWith("@")) delete mapped[k];
      if (store.key === "payerRoles" && (row.scope === "member") !== (row.user_id !== null)) dangling(s, ses, store, i, "scope");
      // a role the app does not know would be read by no run and shown by no page: refused like a loan that fails its own checks
      if (store.key === "payerRoles" && !(PAYER_ROLES as readonly unknown[]).includes(row.role)) refuse(s, ses, `Tiedoston kohdan payerRoles rivi ${i + 1} on virheellinen (role).`);
      // household-wide rows (no owner, no writer elsewhere in the app) are the admin's to bring
      if (store.household && (store.userOrNull ? row[store.userOrNull] === null : true) && me.role !== "admin") {
        skip(store.key, "household");
        continue;
      }
      let theirs: string | undefined | null = null;
      for (const column of [store.user, store.userOrNull]) {
        if (!column || row[column] === null) continue;
        const name = column === store.user ? usernameOf(store, i, column, row[column]) : fileUsers.get(String(row[column]));
        if (name !== me.username) theirs = name;
        mapped[column] = me.id;
      }
      if (theirs === null && store.accountKey) {
        const k = String(row[store.accountKey]);
        const m = keyMap.get(k) ?? (localKeys.has(k) ? k : undefined);
        if (m !== undefined) mapped[store.accountKey] = m;
        else if (otherKey.has(k)) theirs = otherKey.get(k);
        else dangling(s, ses, store, i, store.accountKey);
      }
      if (theirs === null && store.account && row[store.account.column] !== null) {
        const a = String(row[store.account.column]);
        const m = accMap.get(a) ?? (!otherAcc.has(a) && localById.has(a) ? a : undefined);
        if (m !== undefined) mapped[store.account.column] = m;
        else if (otherAcc.has(a)) theirs = otherAcc.get(a);
        else dangling(s, ses, store, i, store.account.column);
      }
      if (theirs === null && store.tx) {
        const t = String(row[store.tx]);
        const m = txMap.get(t) ?? (localTx.has(t) ? t : undefined);
        if (m !== undefined) mapped[store.tx] = m;
        else if (otherTx.has(t)) theirs = "";
        else dangling(s, ses, store, i, store.tx);
      }
      if (theirs !== null) {
        skip(store.key, "other_user", theirs || undefined);
        continue;
      }
      // what a settlement says of a pool is for those weighted in it; a month is kept only when it has closed by the rule that closes one, and one that is kept is never replaced (it exists: same key)
      if (store.key === "accountAgreements" || store.key === "settlementClosed") {
        if (!weighted.has(String(mapped.account_key)) || (store.key === "settlementClosed" && (await importedMonthRefusal(s, me.id, mapped, worked)))) {
          skip(store.key, "refused");
          continue;
        }
        // a row that shows the income ratio is put by the user alone: the others it names put it themselves
        if (store.key === "accountAgreements") {
          const value = await importedAgreementValue(s, me.id, String(mapped.account_key), String(mapped.kind), String(mapped.value));
          if (value === null) {
            skip(store.key, "refused");
            continue;
          }
          mapped.value = value;
        }
      }
      for (const c of store.said ?? []) {
        if (row[c] === null) continue;
        const mine = fileUsers.get(String(row[c])) === me.username;
        mapped[c] = mine || !nullable(store.cols[c]!) ? me.id : null;
      }
      // a person named as an owner is a person of this instance: the user, as for who said it (a holder who is no user stays)
      for (const c of store.owner ?? []) mapped[c] = row[c] === "u:" ? "u:" : `u:${me.id}`;
      staged.push({ row: mapped, i, key: JSON.stringify(store.pk.map((c) => mapped[c] ?? null)) });
    }
    if (store.key === "valuedAssets") await oneKindPerAsset(repo, staged, store);
    const present = await repo.present(store.table, store.pk, staged.map((x) => JSON.parse(x.key) as (string | number | null)[]));
    // a statement row needs its statement: one added or kept above, or one the user has
    const billsPresent = store.key === "statementRows" ? await repo.present("statement_bill", ["user_id", "bill_tx_id"], staged.map((x) => [me.id, x.row.bill_tx_id!])) : new Set<string>();
    const seen = new Set<string>();
    const fresh: { row: Row; i: number }[] = [];
    for (const x of staged) {
      if (store.key === "statementRows" && !billsHere.has(String(x.row.bill_tx_id)) && !billsPresent.has(JSON.stringify([me.id, x.row.bill_tx_id]))) dangling(s, ses, store, x.i, "bill_tx_id");
      if (store.key === "statementBills") billsHere.add(String(x.row.bill_tx_id));
      const isPart = store.key === "parts";
      // the parts of a transaction that was here already are the ones the processing derived: kept as they are
      if (present.has(x.key) || seen.has(x.key) || (isPart && !newTx.has(String(x.row.tx_id)))) {
        tally(store.key).exists++;
        continue;
      }
      seen.add(x.key);
      fresh.push(x);
    }
    const taken = store.idColumn ? await repo.taken(store.table as IdTable, fresh.map((x) => String(x.row[store.idColumn!]))) : new Map<string, string | null>();
    for (const { row, i } of fresh) {
      if (store.idColumn && taken.has(String(row[store.idColumn]))) row[store.idColumn] = randomToken();
      if (store.key === "loans") {
        const fields = Object.fromEntries(LOAN_COLUMNS.map((c) => [camel(c), row[c]]));
        try {
          await checks.loan(fields, { getAccount: async (id) => localById.get(id) ?? null });
        } catch (err) {
          if (!(err instanceof UserError)) throw err;
          refuse(s, ses, `Tiedoston kohdan loans rivi ${i + 1} on virheellinen (${err.message}).`);
        }
      }
      if (store.key === "rules") delete row.id;
      statements.push(ImportRepo.insert(store.table, row));
      tally(store.key).add++;
      if (store.accountKey) accountKeyRows++;
    }
    await yieldToLoop();
  }
  const usersCount = rowsOf("users").length;
  if (usersCount) tally("users").skipped.push({ reason: NEVER_WRITTEN.users!, n: usersCount });

  const stores = IMPORT_STORES.filter((st) => counts.has(st.key)).map((st) => counts.get(st.key)!);
  const total = { add: 0, exists: 0, skipped: 0 };
  for (const c of stores) {
    total.add += c.add;
    total.exists += c.exists;
    total.skipped += c.skipped.reduce((sum, x) => sum + x.n, 0);
  }
  const otherUsers = [...fileUsers.values()].filter((u) => u !== me.username).map((username) => ({ username, rows: others.get(username) ?? 0 }));
  const plan: ImportPlan = {
    session: ses.id,
    expiresAt: new Date(ses.expires).toISOString(),
    head: ses.head,
    stores,
    otherUsers,
    ignored: { stores: [...ses.unknownStores].map(([key, rows]) => ({ key, rows })), keys: ses.unknownKeys },
    total,
    committed,
  };
  return { plan, statements, accountKeyRows };
}

/** Dry run: what a commit of this session would add, keep and skip. Writes nothing; the session stays open for the commit. */
export async function dryRun(s: Services, user: { id: string }, id: string, checks: ImportChecks): Promise<ImportPlan> {
  const ses = sessionOf(s, user, id);
  ses.expires = expiry(s);
  return (await buildPlan(s, ses, false, checks)).plan;
}

/**
 * Adds the rows the plan says are missing, all in one transaction, then runs the processing of the user's transactions
 * once (never per row). The session ends. The answer is the plan of that moment.
 */
export async function commitImport(s: Services, user: User, id: string, checks: ImportChecks): Promise<ImportPlan> {
  const ses = sessionOf(s, user, id);
  const { plan, statements, accountKeyRows } = await buildPlan(s, ses, true, checks);
  // the session ends when the rows are in; a database that refuses leaves it, so the user can try again
  if (statements.length) await new ImportRepo(s.db).commit(statements);
  open(s).delete(ses.id);
  if (!statements.length) return plan;
  if (accountKeyRows) await s.settings.bumpDataVersion();
  try {
    await reprocess(s.finance(user.id), s.settings);
  } catch (err) {
    console.error("import: the rows were added but processing them failed:", err instanceof Error ? err.message : err);
  }
  return plan;
}
