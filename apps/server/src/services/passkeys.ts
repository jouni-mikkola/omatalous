/**
 * Passkeys as a second sign-in factor (WebAuthn, through @simplewebauthn/server, ADR 0024). The relying party is the
 * address of the install (`appBaseUrl`, services/instance.ts): its host is the rp id and its origin the one expected. A
 * browser allows a passkey only on https or on localhost, so any other address is told so and nothing is started. It
 * also allows one only on the page of the rp id, so a request that came to another address of the install (the home
 * network's, say) is offered no passkey and starts none. A
 * passkey follows the password (the half session of auth/session.ts), is not a way in on its own, and does not ask for
 * the authenticator's own user verification. Attestation is `none`; the public key is stored as it is (db/factor-repo.ts).
 * Each challenge is made for one user, kept in memory for five minutes and used once: it is taken out before the answer
 * is checked. A try is counted before it is checked, in the limiters of the code step (second-factor.ts).
 */
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { mustKeepFactor, newRecoveryCodes, normalRecovery, recoveryHash, takeCode, throttled } from "./second-factor.ts";
import { recordEvent } from "./security.ts";
import { confirmPassword, type RequestInfo } from "./users.ts";

const MAX_PASSKEYS = 10;
const LABEL_MAX = 40;
const WHAT = "passkey";

type Who = { id: string; username: string };

/** The address a request came to, as its own headers tell it. */
export type AskedAt = { origin?: string | undefined; host?: string | undefined };

/**
 * Whether the request came to the app address: its Origin when it has one, else its Host (a browser sends no Origin
 * with a GET of its own address, and a Host has no scheme to compare). A request with neither tells nothing and counts
 * as the app address.
 */
function atAppAddress(app: URL, at: AskedAt): boolean {
  if (at.origin !== undefined) {
    try {
      return new URL(at.origin).origin === app.origin;
    } catch {
      return false;
    }
  }
  return at.host === undefined || at.host.trim().toLowerCase() === app.host;
}

/**
 * The rp id and origin of this install, whether a browser will allow a passkey on it, and (`here`) whether the request
 * came to that address.
 */
export function relyingParty(s: Services, at: AskedAt = {}): { id: string; origin: string; usable: boolean; here: boolean } {
  const url = new URL(s.instance.current.appBaseUrl);
  // a browser takes a domain as the rp id, never an IP address, so only the name localhost counts as the machine itself
  const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost");
  return { id: url.hostname, origin: url.origin, usable: url.protocol === "https:" || (local && url.protocol === "http:"), here: atAppAddress(url, at) };
}

function usableParty(s: Services, at: AskedAt = {}) {
  const rp = relyingParty(s, at);
  if (!rp.usable) throw UserError.of("passkey.needs_https", { address: rp.origin });
  return rp;
}

export async function passkeyStatus(s: Services, userId: string, at: AskedAt = {}) {
  const rp = relyingParty(s, at);
  const list = await s.factors.passkeys(userId);
  return {
    usable: rp.usable && rp.here,
    address: rp.origin,
    passkeys: list.map((p) => ({ id: p.id, label: p.label, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })),
  };
}

/** The name a member gave a device: one short line of text. */
function parseLabel(raw: unknown): string {
  const label = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!label || label.length > LABEL_MAX || /[\p{Cc}<>]/u.test(label)) throw UserError.of("passkey.label_bad", { max: LABEL_MAX });
  return label;
}

/** Takes a challenge out of memory: whoever answers has one go at it. */
function takeChallenge(s: Services, key: string): string | undefined {
  const challenge = s.passkeyChallenges.get(key, s.now().getTime());
  s.passkeyChallenges.delete(key);
  return challenge;
}

/**
 * The password, and once the user has a second factor a code as well (from the app or a recovery code), as for taking
 * the factor away: a session and the password alone must not add a passkey that later signs in with no code.
 */
async function confirmOwner(s: Services, user: Who, password: string, code: string, req: RequestInfo): Promise<void> {
  await confirmPassword(s, user, password, req, WHAT, "auth.password_wrong");
  if ((await s.factors.hasAny(user.id)) && !(await takeCode(s, user, code, req))) throw UserError.of("auth.bad_code");
}

/** Step 1 of adding: the password (and a code), then the options for `navigator.credentials.create`. */
export async function startPasskey(s: Services, user: Who, password: string, code: string, req: RequestInfo, at: AskedAt = {}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const rp = usableParty(s, at);
  // the browser at another address refuses the rp id: say where to open the app, before the password is asked
  if (!rp.here) throw UserError.of("passkey.failed", { address: rp.origin });
  await confirmOwner(s, user, password, code, req);
  const existing = await s.factors.passkeys(user.id);
  if (existing.length >= MAX_PASSKEYS) throw UserError.of("passkey.too_many", { max: MAX_PASSKEYS });
  const options = await generateRegistrationOptions({
    rpName: "Omatalous",
    rpID: rp.id,
    userName: user.username,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as never })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  s.passkeyChallenges.set(`add:${user.id}`, options.challenge, s.now().getTime());
  return options;
}

/**
 * Step 2: the device's answer is checked against the challenge of step 1 and the address, and the passkey is stored. A
 * user with no recovery codes yet gets ten, shown this once, so a lost device does not lock them out; otherwise `[]`.
 */
export async function finishPasskey(s: Services, user: Who, response: unknown, label: unknown, keepSessionId: string, req: RequestInfo): Promise<string[]> {
  const rp = usableParty(s);
  const name = parseLabel(label);
  const challenge = takeChallenge(s, `add:${user.id}`);
  if (!challenge) throw UserError.of("passkey.start_again");
  const made = await throttled(
    s,
    user,
    req,
    async () => {
      try {
        const v = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge: challenge,
          expectedOrigin: rp.origin,
          expectedRPID: rp.id,
          requireUserVerification: false,
        });
        return v.verified && v.registrationInfo ? v.registrationInfo.credential : null;
      } catch {
        return null;
      }
    },
    WHAT,
  );
  if (!made) throw UserError.of("passkey.failed", { address: rp.origin });
  const needCodes = (await s.factors.recoveryLeft(user.id)) === 0;
  const codes = needCodes ? newRecoveryCodes() : [];
  const added = await s.factors.addPasskey(
    user.id,
    { credentialId: made.id, publicKey: Buffer.from(made.publicKey).toString("base64url"), counter: made.counter, transports: made.transports ?? [], rpId: rp.id, label: name },
    await Promise.all(codes.map((c) => recoveryHash(user.id, normalRecovery(c)))),
    s.now().toISOString(),
  );
  if (!added) throw UserError.of("passkey.taken");
  // the first factor ends the other sessions, as turning on the authenticator app does: a session taken before has not met it
  if (needCodes) await s.users.deleteSessionsOf(user.id, keepSessionId);
  await recordEvent(s, { kind: "passkey_added", userId: user.id, ...req, detail: name, notify: true });
  return codes;
}

/** The options for `navigator.credentials.get` of a user who has the password right (the half session). */
export async function passkeyChallenge(s: Services, user: Who, at: AskedAt = {}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const rp = usableParty(s, at);
  // none that works here: the sign-in at this address offered no passkey
  if (!rp.here) throw UserError.of("passkey.none");
  const list = (await s.factors.passkeys(user.id)).filter((p) => p.rpId === rp.id);
  if (!list.length) throw UserError.of("passkey.none");
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    allowCredentials: list.map((p) => ({ id: p.credentialId, transports: p.transports as never })),
    userVerification: "preferred",
  });
  s.passkeyChallenges.set(`sign-in:${user.id}`, options.challenge, s.now().getTime());
  return options;
}

/**
 * Checks the device's answer of a sign-in. True when it is one of the user's passkeys, signed for the challenge just
 * made and this address; false otherwise. Throws TooManyAttempts when the throttle is full.
 */
export async function takePasskey(s: Services, user: Who, response: unknown, req: RequestInfo): Promise<boolean> {
  const challenge = takeChallenge(s, `sign-in:${user.id}`);
  const rp = relyingParty(s);
  const used = await throttled(
    s,
    user,
    req,
    async () => {
      const id = (response as { id?: unknown } | null)?.id;
      const passkey = typeof id === "string" && challenge && rp.usable ? (await s.factors.passkeys(user.id)).find((p) => p.credentialId === id && p.rpId === rp.id) : undefined;
      if (!passkey || !challenge) return null;
      try {
        const v = await verifyAuthenticationResponse({
          response: response as AuthenticationResponseJSON,
          expectedChallenge: challenge,
          expectedOrigin: rp.origin,
          expectedRPID: rp.id,
          credential: { id: passkey.credentialId, publicKey: Buffer.from(passkey.publicKey, "base64url"), counter: passkey.counter, transports: passkey.transports as never },
          requireUserVerification: false,
        });
        return v.verified ? { passkey, counter: v.authenticationInfo.newCounter } : null;
      } catch {
        return null;
      }
    },
    WHAT,
  );
  if (!used) return false;
  await s.factors.usePasskey(used.passkey.id, used.counter, s.now().toISOString());
  await recordEvent(s, { kind: "passkey_used", userId: user.id, ...req, detail: used.passkey.label });
  return true;
}

/** The password (and a code) takes one passkey away. An admin's last second factor stays while the address is public. */
export async function removePasskey(s: Services, user: Who, password: string, code: string, id: string, req: RequestInfo): Promise<void> {
  await confirmOwner(s, user, password, code, req);
  const list = await s.factors.passkeys(user.id);
  const target = list.find((p) => p.id === id);
  if (!target) throw UserError.of("passkey.unknown");
  // an admin's last factor stays while the address is public; the delete itself checks it, so two at once cannot take both
  const keep = await mustKeepFactor(s, user.id);
  if (!(await s.factors.removePasskey(user.id, id, keep))) throw UserError.of(keep && (await s.factors.passkeys(user.id)).some((p) => p.id === id) ? "factor.keep_while_public" : "passkey.unknown");
  await recordEvent(s, { kind: "passkey_removed", userId: user.id, ...req, detail: target.label, notify: true });
}
