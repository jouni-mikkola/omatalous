/**
 * Renewing every bank consent in one round (Asetukset > Pankkiyhteydet). The round is one settings row per user
 * (`consent_round:<user id>`): when it began and the consents it renews, each with the registry id of its bank. Nothing
 * comes from the browser, and a bank is started by the id of banks.ts through the same route as any other. What is done
 * is read from the consents themselves: a consent is done once it is no longer due.
 */
import { dueConsents, type RoundConnection, type RoundConsent, type RoundView, roundView, type StoredRound } from "@banking/core";
import { bankById, bankIdForAspsp } from "../connectors/enable-banking/banks.ts";
import { offeredBanks } from "../connectors/enable-banking/app-setup.ts";
import { UserError } from "../platform/errors.ts";
import { connectionView } from "./accounts.ts";
import type { Services } from "./context.ts";

const ROUND_PREFIX = "consent_round:";
/** A round nobody finished is dropped after this long: the consents it counted have changed since. */
const ROUND_DAYS = 7;

interface Renewal {
  /** The consents to renew now. */
  due: RoundConsent[];
  /** The round begun, else null. */
  round: RoundView | null;
}

const bankOf = (institution: string) => bankIdForAspsp(institution);

async function readRound(s: Services, userId: string): Promise<StoredRound | null> {
  const raw = await s.settings.get(`${ROUND_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    const round = JSON.parse(raw) as Partial<StoredRound>;
    const age = s.now().getTime() - new Date(round.startedAt ?? "").getTime();
    if (!Array.isArray(round.consents) || !(age < ROUND_DAYS * 86_400_000)) return null;
    // an id that is no longer in the registry cannot be started
    return { startedAt: round.startedAt!, consents: round.consents.filter((c) => typeof c?.connection === "string" && bankById(c.bank)) };
  } catch {
    return null;
  }
}

/** What GET /api/meta says of renewal, from the consents it already shows. */
export async function renewalOf(s: Services, userId: string, views: readonly RoundConnection[], startable: ReadonlySet<string>): Promise<Renewal> {
  const stored = await readRound(s, userId);
  return { due: dueConsents(views, bankOf, startable), round: stored?.consents.length ? roundView(stored, views) : null };
}

/** Begins a round over the consents that are due now, replacing one that was begun before. */
export async function startRound(s: Services, userId: string): Promise<RoundView> {
  const repo = s.finance(userId);
  const [accounts, connections, offered] = await Promise.all([repo.listAccounts(), repo.listConnections(), offeredBanks(s)]);
  const today = s.today();
  const views = connections.map((c) => connectionView(c, today, s.instance.current.timezone, accounts, connections));
  const consents = dueConsents(views, bankOf, new Set(offered.map((b) => b.id)));
  if (consents.length === 0) throw new UserError("Ei yhteyksiä, jotka pitäisi uusia.");
  const round: StoredRound = { startedAt: s.now().toISOString(), consents };
  await s.settings.set(`${ROUND_PREFIX}${userId}`, JSON.stringify(round));
  return roundView(round, views);
}

/** Ends the round, finished or not. Consents stay as they are. */
export async function closeRound(s: Services, userId: string): Promise<void> {
  await s.settings.delete(`${ROUND_PREFIX}${userId}`);
}
