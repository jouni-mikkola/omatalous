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

/**
 * Why linking a bank stopped, one message each. The callback puts only the reason in the address and the web app shows
 * the same words (BankConnections.tsx CONNECT_ERRORS); the pasted address gets the message itself. A reason that a new
 * attempt cannot fix says who fixes it, so the user is not sent round the same failure again.
 */
export const LINK_FAILURES = {
  cancelled: "Yhdistäminen keskeytyi.",
  bank: "Pankki keskeytti yhdistämisen. Syy näkyy Enable Bankingin Control Panelissa sovelluksen pyyntölokissa.",
  inactive: "Enable Banking ei vielä päästä sovellusta pankkeihin. Ylläpitäjän pitää painaa Control Panelissa Activate by linking accounts.",
  app: "Enable Banking ei tunnistanut sovellusta. Ylläpitäjän pitää tarkistaa se kohdassa Asetukset > Palvelin > Testaa yhteys.",
  refused: "Enable Banking hylkäsi yhdistämisen. Syy näkyy Control Panelissa sovelluksen pyyntölokissa.",
  expired: "Yhdistäminen vanheni. Yritä uudelleen.",
} as const;

export type LinkFailureReason = keyof typeof LINK_FAILURES;

export class LinkFailure extends UserError {
  constructor(readonly reason: LinkFailureReason) {
    super(LINK_FAILURES[reason]);
  }
}

/** The bank's redirect came back with an unknown, used or old state; the callback tells the user to start again. */
export class AuthStateExpired extends LinkFailure {
  constructor() {
    super("expired");
  }
}

/**
 * The browser came back with `error` instead of a code: the user cancelled at the bank (access_denied, the only value
 * Enable Banking documents), or the bank or Enable Banking stopped the authorisation. The state is used up either way.
 */
export async function returnedWithError(s: Services, userId: string, state: string | null | undefined, error: string): Promise<LinkFailure> {
  if (state) await consumeLinkState(s, userId, state).catch(() => undefined);
  return new LinkFailure(error === "access_denied" ? "cancelled" : "bank");
}

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
  if (state.includes(".") && !originFromRelayState(state)) throw new AuthStateExpired();
  const raw = await s.settings.get(key);
  if (raw) await s.settings.delete(key);
  const pending = raw ? (JSON.parse(raw) as { userId: string; createdAt: number }) : null;
  if (!pending || pending.userId !== userId || s.now().getTime() - pending.createdAt > STATE_TTL_MS) {
    throw new AuthStateExpired();
  }
}
