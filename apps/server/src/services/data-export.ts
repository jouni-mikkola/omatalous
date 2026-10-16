/** "Vie kaikki tiedot": what the user sees as one JSON file, built from the stores of data-export-stores.ts. */
import { bankSignature } from "../db/finance-repo.ts";
import { accountKey } from "../db/household-repo.ts";
import { yieldToLoop } from "../platform/yield.ts";
import { sharedInView } from "./analysis.ts";
import type { Services } from "./context.ts";
import { weightedKeys } from "./settlement.ts";
import { EXPORT_FORMAT, EXPORT_VERSION, LEFT_OUT, STORES, storeColumns, storeRead, type Viewer } from "./data-export-stores.ts";

type Row = Record<string, string | number | null>;

/** The bank's signature of a stored row, the one a later fetch matches on; the file's reader need not know how it is made. */
const withSignature = (r: Row) => ({
  ...r,
  signature: bankSignature({
    bookingDate: String(r.booking_date),
    valueDate: (r.value_date as string | null) ?? null,
    amountCents: Number(r.amount_cents),
    status: String(r.status),
    counterparty: (r.counterparty as string | null) ?? null,
    counterpartyIban: (r.counterparty_iban as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    mcc: (r.mcc as string | null) ?? null,
    bankTxnCode: (r.bank_txn_code as string | null) ?? null,
    merchant: String(r.merchant),
  }),
});

/** What the user sees: the accounts of the transaction list (their own and the shared ones, `sharedInView`) and the people those name. */
async function viewerOf(s: Services, user: { id: string; role: string }): Promise<Viewer> {
  const own = await s.finance(user.id).listAccounts();
  const [shared, shares] = await Promise.all([sharedInView(s, user.id, own), s.household.sharesOf(user.id)]);
  const accountKeys = [...new Set([...own, ...shared].map(accountKey))];
  return {
    userId: user.id,
    admin: user.role === "admin",
    ownAccounts: own.map((a) => a.id),
    sharedAccounts: shared.map((a) => a.id),
    accountKeys,
    weightedKeys: await weightedKeys(s, user.id, accountKeys),
    users: [...new Set([user.id, ...shared.map((a) => a.userId), ...shares.map((x) => x.userId)])],
  };
}

/**
 * The file of one user: every store read in one read transaction, so it is one snapshot, and only the rows the user sees
 * in the app. A table that is neither a store nor in LEFT_OUT (a test stops that before a release) is named in
 * `notExported`, never written and never an error.
 */
export async function exportEverything(s: Services, user: { id: string; role: string; username: string }, appVersion: string): Promise<string> {
  const viewer = await viewerOf(s, user);
  const reads = await Promise.all(STORES.map(async (st) => storeRead(st, await storeColumns(s, st), viewer)));
  const { tables, rows } = await s.household.exportSnapshot(reads);
  const notExported = tables.filter((t) => !(t in LEFT_OUT) && !STORES.some((st) => st.table === t)).sort();
  const head = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: s.now().toISOString(), appVersion, exportedBy: user.username, notExported };
  const pieces = [JSON.stringify(head).slice(0, -1)];
  for (const [i, store] of STORES.entries()) {
    const out = store.key === "transactions" ? (rows[i] as Row[]).map(withSignature) : rows[i]!;
    pieces.push(`,${JSON.stringify(store.key)}:[${out.map((r) => `\n${JSON.stringify(r)}`).join(",")}${out.length ? "\n" : ""}]`);
    await yieldToLoop();
  }
  pieces.push("}\n");
  return pieces.join("");
}
