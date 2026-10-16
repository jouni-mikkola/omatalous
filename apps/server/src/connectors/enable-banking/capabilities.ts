/**
 * What each bank supports, kept in the settings beside the application id. Two kinds of fact: what Enable Banking's
 * bank list says (consent length, PSU headers, PSU types) and what a link or a fetch has SEEN (card accounts, pending
 * rows, balance types, the deepest history reached, as a count of days and never a date). Keyed by the bank id of
 * banks.ts. No account id, no name and no amount is kept. A write that fails is logged and never fails the caller.
 */
import { BANKS, findAspsp } from "./banks.ts";
import type { EbAspsp } from "./types.ts";
import type { Services } from "../../services/context.ts";
import { readJson } from "../../services/remote-access-cloudflare.ts";

const CAPABILITIES = "instance_bank_capabilities";

interface BankCapability {
  /** How long a consent may last, in whole days; null when the list does not say. */
  consentDays: number | null;
  /** The Psu-* headers the bank's own entry requires; null when the entry has none, which means the default pair (psu.ts). */
  requiredPsuHeaders: string[] | null;
  psuTypes: string[] | null;
  /** A card account (`cash_account_type` CARD) has been seen at a link or a fetch. */
  cardAccounts: boolean;
  /** A pending row has been seen. */
  pending: boolean;
  /** Balance codes seen (CLBD, ITAV ...), sorted. */
  balanceTypes: string[];
  /** The deepest history a fetch reached, in days before the day of that fetch; null before a fetch with rows. */
  historyDays: number | null;
}

/** What a link or a fetch saw. A part that is left out says nothing. */
interface Seen {
  card?: boolean;
  pending?: boolean;
  balanceTypes?: readonly unknown[];
  historyDays?: number;
}

type Store = Record<string, BankCapability>;

const empty = (): BankCapability => ({ consentDays: null, requiredPsuHeaders: null, psuTypes: null, cardAccounts: false, pending: false, balanceTypes: [], historyDays: null });

/** Four capital letters: the shape of every code Enable Banking documents for a balance or an account type. */
export const isCode = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{4}$/.test(value);

const strings = (value: unknown, shape: RegExp): string[] | null => {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((v): v is string => typeof v === "string" && shape.test(v)))];
};

/** Writes go one after another per Services, so two facts that arrive together are both kept. */
const queues = new WeakMap<object, Promise<void>>();

function update(s: Services, change: (store: Store) => void): Promise<void> {
  const run = (queues.get(s) ?? Promise.resolve()).then(async () => {
    try {
      const store = (await readJson<Store>(s, CAPABILITIES)) ?? {};
      const before = JSON.stringify(store);
      change(store);
      if (JSON.stringify(store) !== before) await s.settings.set(CAPABILITIES, JSON.stringify(store));
    } catch (err) {
      console.error("bank capabilities:", err instanceof Error ? err.message : "not saved");
    }
  });
  queues.set(s, run);
  return run;
}

/** Takes what the bank list says about each bank of banks.ts that it has. A bank the list lacks keeps its record. */
export function noteBankList(s: Services, aspsps: readonly EbAspsp[]): Promise<void> {
  return update(s, (store) => {
    for (const bank of BANKS) {
      const hit = findAspsp(bank, aspsps);
      if (!hit) continue;
      const seconds = hit.maximum_consent_validity;
      const known = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 86_400;
      const headers = strings(hit.required_psu_headers, /^Psu-[A-Za-z-]{1,40}$/);
      const record = (store[bank.id] ??= empty());
      record.consentDays = known ? Math.floor(seconds / 86_400) : null;
      record.requiredPsuHeaders = headers && headers.length ? headers : null;
      record.psuTypes = strings(hit.psu_types, /^[a-z]{1,20}$/);
    }
  });
}

/** Adds what a link or a fetch saw for a bank. Facts only grow: a card once seen stays seen, history only gets deeper. */
export function noteSeen(s: Services, bankId: string | null, seen: Seen): Promise<void> {
  if (!bankId || !BANKS.some((b) => b.id === bankId)) return Promise.resolve();
  return update(s, (store) => {
    const record = (store[bankId] ??= empty());
    if (seen.card) record.cardAccounts = true;
    if (seen.pending) record.pending = true;
    if (seen.balanceTypes) record.balanceTypes = [...new Set([...record.balanceTypes, ...seen.balanceTypes.filter(isCode)])].sort();
    if (typeof seen.historyDays === "number" && Number.isFinite(seen.historyDays) && seen.historyDays >= 0) {
      record.historyDays = Math.max(record.historyDays ?? 0, Math.floor(seen.historyDays));
    }
  });
}

/** The records in the order of banks.ts, for the banks that have one. */
export async function bankCapabilities(s: Services): Promise<({ bankId: string } & BankCapability)[]> {
  const store = (await readJson<Store>(s, CAPABILITIES)) ?? {};
  return BANKS.flatMap((b) => (store[b.id] ? [{ bankId: b.id, ...empty(), ...store[b.id] }] : []));
}
