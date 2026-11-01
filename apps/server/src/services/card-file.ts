/**
 * The rows of a card statement file, which the browser read (ADR 0025). The request holds rows and no file: a day, a sum and a
 * text each, and the card's name or one of the household's statement cards. The rows go in through `ingestTransactions` like
 * any fetch, so the same statement sent twice stores each row once.
 */
import { CARD_FILE_MAX_CENTS, CARD_FILE_MAX_ROWS, isRealDay, STATEMENT_TEXT_MAX, type RawTransaction } from "@banking/core";
import { bankFile } from "../connectors/bank-file/index.ts";
import { cardFile } from "../connectors/card-file/index.ts";
import type { Connector } from "../connectors/types.ts";
import { UserError } from "../platform/errors.ts";
import { stableId } from "../platform/ids.ts";
import { strictObject } from "../platform/validate.ts";
import type { Services } from "./context.ts";
import { reprocess } from "./enrich.ts";
import { startLookup } from "./industry.ts";
import { type IngestResult, ingestTransactions } from "./ingest.ts";

const MAX_NAME = 80;

interface CardFileInput {
  accountId: string | null;
  name: string | null;
  last4: string | null;
  rows: { day: string; cents: number; text: string }[];
}

/** The request body, shaped. Anything else is refused. */
export function parseCardFile(body: unknown): CardFileInput {
  const { accountId, name, last4, rows } = strictObject(body, ["accountId", "name", "last4", "rows"] as const);
  const text = (v: unknown, max: number): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || Array.from(v).length > max) throw UserError.of("check.field_bad");
    return v.trim() || null;
  };
  if (last4 !== undefined && last4 !== null && !(typeof last4 === "string" && /^\d{4}$/.test(last4))) throw UserError.of("check.field_bad");
  if (!Array.isArray(rows) || !rows.length) throw UserError.of("card_file.bad_rows");
  if (rows.length > CARD_FILE_MAX_ROWS) throw UserError.of("card_file.too_many", { max: CARD_FILE_MAX_ROWS });
  const out = rows.map((r: unknown) => {
    const { day, cents, text: t } = strictObject(r, ["day", "cents", "text"] as const);
    if (typeof day !== "string" || !isRealDay(day) || typeof cents !== "number" || !Number.isSafeInteger(cents) || cents === 0 || Math.abs(cents) > CARD_FILE_MAX_CENTS || typeof t !== "string") throw UserError.of("card_file.bad_rows");
    const clean = t.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").trim();
    if (!clean || Array.from(clean).length > STATEMENT_TEXT_MAX) throw UserError.of("card_file.bad_rows");
    return { day, cents, text: clean };
  });
  return { accountId: text(accountId, 200), name: text(name, MAX_NAME), last4: (last4 as string | null | undefined) ?? null, rows: out };
}

export interface CardFileResult extends IngestResult {
  accountId: string;
}

/** What a statement file's rows belong to: a card of the card statements, or an account of a bank's CSV export. */
interface StatementKind {
  source: Connector;
  type: "credit_card" | "checking";
  fallbackName: string;
}

const CARD: StatementKind = { source: cardFile, type: "credit_card", fallbackName: "Kortti" };
const ACCOUNT: StatementKind = { source: bankFile, type: "checking", fallbackName: "Tili" };

export const saveCardFile = (s: Services, userId: string, input: CardFileInput) => saveStatementRows(s, userId, input, CARD);
export const saveBankFile = (s: Services, userId: string, input: CardFileInput) => saveStatementRows(s, userId, input, ACCOUNT);

/** Stores the rows on a statement account of the user's: the one named, else the one the name gives (made on first use). */
async function saveStatementRows(s: Services, userId: string, input: CardFileInput, kind: StatementKind): Promise<CardFileResult> {
  const repo = s.finance(userId);
  if (input.rows.some((r) => r.day > s.today())) throw UserError.of("card_file.future");
  let accountId = input.accountId;
  let accountChanged = false;
  if (accountId) {
    // only a card made here takes rows: a bank's account is filled by its own fetch
    const account = await repo.getAccount(accountId);
    if (!account || account.provider !== kind.source.id) throw UserError.of("card_file.bad_account");
  } else {
    const name = input.name ?? (input.last4 ? `${kind.fallbackName} ${input.last4}` : kind.fallbackName);
    const identity = stableId(`${userId}|${kind.source.id}|${name}|${input.last4 ?? ""}`);
    accountId = `${kind.source.id}-${identity}`;
    if (!(await repo.getAccount(accountId))) {
      accountChanged = true;
      await repo.upsertAccount({ id: accountId, connectionId: null, provider: kind.source.id, externalId: null, identity, name, cardMask: input.last4 ? `**** ${input.last4}` : null, iban: null, currency: "EUR", type: kind.type });
    }
  }
  const raws: RawTransaction[] = input.rows.map((r) => ({
    externalId: null,
    bookingDate: r.day,
    valueDate: null,
    amountCents: r.cents,
    currency: "EUR",
    status: "booked",
    counterparty: r.text,
    counterpartyIban: null,
    description: null,
    reference: null,
    mcc: null,
  }));
  const result = await ingestTransactions(repo, accountId, raws, kind.source.id);
  // the same file again changes nothing: no processing, and nobody's cached analysis is dropped
  if (result.changed || accountChanged) await reprocess(repo, s.settings);
  if (result.inserted) startLookup(s);
  return { accountId, ...result };
}
