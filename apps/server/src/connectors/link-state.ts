/**
 * The state that ties a bank's redirect back to the user who started the link. It lives in the settings table
 * for an hour and is used once.
 */
import { originFromRelayState, parseLocalOrigin, relayState } from "@banking/core";
import { UserError } from "../platform/errors.ts";
import { randomToken } from "../platform/ids.ts";
import type { Services } from "../services/context.ts";

export const LINK_STATE_PREFIX = "auth_state:";
const STATE_TTL_MS = 60 * 60_000;

/** The bank's redirect came back with an unknown, used or old state; the callback tells the user to start again. */
export class AuthStateExpired extends UserError {}

/**
 * The state for the bank. In relay mode it carries the local address the return page forwards to: the one the
 * browser used (`returnTo`), else the configured address, and only if it is a private or local origin.
 */
function stateFor(s: Services, returnTo: unknown): string {
  const token = randomToken();
  if (s.redirectMode() !== "relay" || s.config.bank.redirectUrl) return token;
  const origin =
    (typeof returnTo === "string" ? parseLocalOrigin(returnTo) : null) ?? parseLocalOrigin(s.instance.current.appBaseUrl);
  if (!origin) {
    throw new UserError("Avaa Omatalous kotiverkon osoitteesta, esimerkiksi http://192.168.1.10:8080, tai ota käyttöön oma https-osoite kohdassa Asetukset > Palvelin.");
  }
  return relayState(token, origin);
}

/** A new state for this user, stored until the bank's redirect comes back. */
export async function issueLinkState(s: Services, userId: string, returnTo: unknown): Promise<string> {
  const state = stateFor(s, returnTo);
  await s.settings.set(`${LINK_STATE_PREFIX}${state}`, JSON.stringify({ userId, createdAt: s.now().getTime() }));
  return state;
}

/** The link could not be started: the state is of no use. */
export async function dropLinkState(s: Services, state: string): Promise<void> {
  await s.settings.delete(`${LINK_STATE_PREFIX}${state}`);
}

/** Single use: consumed by the first attempt, even a failed or foreign one. Throws AuthStateExpired unless it is this user's and fresh. */
export async function consumeLinkState(s: Services, userId: string, state: string): Promise<void> {
  const key = `${LINK_STATE_PREFIX}${state}`;
  // a state that names a return address must still name a private one (the page and the server both check)
  if (state.includes(".") && !originFromRelayState(state)) throw new AuthStateExpired("Yhdistäminen vanheni. Yritä uudelleen.");
  const raw = await s.settings.get(key);
  if (raw) await s.settings.delete(key);
  const pending = raw ? (JSON.parse(raw) as { userId: string; createdAt: number }) : null;
  if (!pending || pending.userId !== userId || s.now().getTime() - pending.createdAt > STATE_TTL_MS) {
    throw new AuthStateExpired("Yhdistäminen vanheni. Yritä uudelleen.");
  }
}
