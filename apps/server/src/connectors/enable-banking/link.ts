/** Linking a bank through Enable Banking: the consent URL, then the accounts the redirect brings back. */
import { randomUUID } from "node:crypto";
import type { FinanceRepo } from "../../db/finance-repo.ts";
import { UserError } from "../../platform/errors.ts";
import { stableId } from "../../platform/ids.ts";
import type { Services } from "../../services/context.ts";
import { foldCsvAccounts } from "../fold-accounts.ts";
import { consumeLinkState, dropLinkState, issueLinkState, LinkFailure } from "../link-state.ts";
import { instanceAppInactive, testBankApp } from "./app-setup.ts";
import { bankById, bankIdForAspsp, DEFAULT_BANK, findAspsp } from "./banks.ts";
import { type EnableBankingClient, EnableBankingError } from "./client.ts";
import { enableBanking } from "./connector.ts";
import { clientFor } from "./credentials.ts";
import { accountHolder, accountName, accountType, cardMask, creditLimitCents } from "./mapper.ts";
import { noteBankList, noteSeen } from "./capabilities.ts";
import type { EbAspsp } from "./types.ts";

/** Step 1: returns the bank's consent page URL. Only banks in the registry (banks.ts) can be started. */
export async function startConnection(s: Services, userId: string, bankId: unknown = DEFAULT_BANK.id, returnTo?: unknown): Promise<{ url: string }> {
  const bank = bankById(bankId);
  if (!bank) throw new UserError("Tuntematon pankki.");
  const client = await clientFor(s, userId);
  const country = bank.country;

  // an application that is not active yet would send the user to the bank and back with an error: say so first
  if (await stillInactive(s, userId)) throw new LinkFailure("inactive");
  let aspsp: EbAspsp | undefined;
  try {
    // matched as the offered list matches it (banks.ts), and started with the name the live list writes
    const listed = await client.listAspsps(country);
    await noteBankList(s, listed);
    aspsp = findAspsp(bank, listed);
  } catch (err) {
    throw linkFailure(err);
  }
  if (!aspsp) throw new UserError(`Pankkia ${bank.name} (${country}) ei löytynyt Enable Bankingista.`);
  const seconds = Math.min(s.config.bank.consentDays * 86_400, aspsp.maximum_consent_validity ?? Number.POSITIVE_INFINITY);

  // the state ties the bank's redirect to this user: another user cannot complete it
  const state = await issueLinkState(s, userId, returnTo);
  try {
    const { url } = await client.startAuthorization({
      aspspName: aspsp.name,
      country,
      redirectUrl: s.redirectUrl(),
      state,
      validUntil: new Date(s.now().getTime() + seconds * 1000 - 60_000),
      psuType: bank.psuType,
    });
    return { url };
  } catch (err) {
    await dropLinkState(s, state);
    if (redirectNotAllowed(err)) {
      throw new UserError(`Enable Banking ei hyväksy paluuosoitetta. Lisää sovelluksen Redirect URLs -kohtaan: ${s.redirectUrl()}`);
    }
    throw linkFailure(err);
  }
}

/** Enable Banking refused the redirect URL: it is not among the application's Redirect URLs. */
function redirectNotAllowed(err: unknown): boolean {
  return err instanceof EnableBankingError && (/REDIRECT_URI_NOT_ALLOWED/.test(err.message) || (err.status === 422 && /redirect/i.test(err.body)));
}

/** How far ahead the test's authorisation reaches: it is never opened, and ends by itself. */
const SELF_TEST_MINUTES = 10;

/**
 * The admin's test of the redirect URL: asks Enable Banking to start an authorisation with the configured address, and
 * stops there. The bank's page is never opened and no state is issued, so no return can complete it. Enable Banking has
 * no call to cancel an authorisation (only a session, which exists after a consent), so none is made: it lapses by itself.
 * `ok`: accepted; `redirect_not_allowed`: the address is not among the application's Redirect URLs; `error`: anything
 * else (no application, no bank in the list, a refusal or a failure of the call).
 */
export async function testRedirect(s: Services, userId: string): Promise<"ok" | "redirect_not_allowed" | "error"> {
  try {
    const client = await clientFor(s, userId);
    const aspsp = findAspsp(DEFAULT_BANK, await client.listAspsps(DEFAULT_BANK.country));
    if (!aspsp) return "error";
    await client.startAuthorization({
      aspspName: aspsp.name,
      country: DEFAULT_BANK.country,
      redirectUrl: s.redirectUrl(),
      state: `redirect-test-${randomUUID()}`,
      validUntil: new Date(s.now().getTime() + SELF_TEST_MINUTES * 60_000),
      psuType: DEFAULT_BANK.psuType,
    });
    return "ok";
  } catch (err) {
    if (redirectNotAllowed(err)) return "redirect_not_allowed";
    // status and path only: the body may hold more than a code
    console.error(`redirect test failed: ${err instanceof Error ? err.message : "unknown"}`);
    return "error";
  }
}

/**
 * The household's application that the last test found not active (app-setup.ts, saved by Tallenna ja testaa and
 * Testaa yhteys). An admin may have linked accounts since, so that answer is asked again here, which also saves the
 * new one. Only a fresh `active: false` stops the start: no flag, a failed call or a timeout lets it go on to the bank.
 * A member's own key is not checked, as for "Lisää pankkiyhteys".
 */
async function stillInactive(s: Services, userId: string): Promise<boolean> {
  if (await s.users.getBankCredentials(userId)) return false;
  if (!(await instanceAppInactive(s))) return false;
  return (await testBankApp(s)).active === false;
}

/** Codes of an authorisation code that was used already or waited too long: a new start works. */
const STALE_CODE = /^(?:EXPIRED_AUTHORIZATION_CODE|WRONG_AUTHORIZATION_CODE|ALREADY_AUTHORIZED|WRONG_SESSION_STATUS)$/;

/**
 * A refusal from Enable Banking while linking, as one reason the user can act on. A failure that may pass by itself
 * (a timeout, a rate limit, a server error) stays an UpstreamError that says to try later.
 */
function linkFailure(err: unknown): unknown {
  if (!(err instanceof EnableBankingError) || err.status < 400 || err.status >= 500 || err.status === 408 || err.status === 429) return err;
  if (err.status === 401) return new LinkFailure("app");
  if (err.status === 403) return new LinkFailure("inactive");
  if (STALE_CODE.test(err.code)) return new LinkFailure("expired");
  // status, path and code only: the body may hold account data
  console.error(`bank link refused: ${err.message}`);
  return new LinkFailure("refused");
}

/** Step 2: the bank redirected back with `code` and `state`. */
export async function completeConnection(s: Services, repo: FinanceRepo, code: string, state: string): Promise<{ connectionId: string; accounts: number }> {
  await consumeLinkState(s, repo.userId, state);

  const client = await clientFor(s, repo.userId);
  let session: Awaited<ReturnType<EnableBankingClient["createSession"]>>;
  try {
    session = await client.createSession(code);
  } catch (err) {
    throw linkFailure(err);
  }
  await repo.upsertConnection({
    id: session.session_id,
    provider: enableBanking.id,
    institution: session.aspsp.name,
    country: session.aspsp.country,
    status: "active",
    validUntil: session.access.valid_until,
    createdAt: s.now().toISOString(),
    lastSyncedAt: null,
  });

  for (const a of session.accounts) {
    // account uids change with every consent; the identification hash / IBAN do not
    const identity = stableId(a.identification_hash ?? a.account_id?.iban ?? a.uid);
    await repo.upsertAccount({
      id: `eb-${stableId(`${repo.userId}|${identity}`)}`,
      connectionId: session.session_id,
      provider: enableBanking.id,
      externalId: a.uid,
      identity,
      name: accountName(a),
      holder: accountHolder(a),
      cardMask: cardMask(a),
      creditLimitCents: creditLimitCents(a),
      iban: a.account_id?.iban ?? null,
      currency: a.currency ?? "EUR",
      type: accountType(a),
    });
    const bankId = bankIdForAspsp(session.aspsp.name);
    await noteSeen(s, bankId, { card: a.cash_account_type === "CARD" });
  }

  await foldCsvAccounts(repo);

  // older consents whose accounts all moved to this one are no longer used
  const accounts = await repo.listAccounts();
  for (const c of await repo.listConnections()) {
    if (c.id !== session.session_id && c.status === "active" && !accounts.some((a) => a.connectionId === c.id)) {
      await repo.setConnectionStatus(c.id, "revoked");
    }
  }
  await s.settings.bumpUserDataVersion(repo.userId);
  return { connectionId: session.session_id, accounts: session.accounts.length };
}
