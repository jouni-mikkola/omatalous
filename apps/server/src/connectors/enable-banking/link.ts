/** Linking a bank through Enable Banking: the consent URL, then the accounts the redirect brings back. */
import type { FinanceRepo } from "../../db/finance-repo.ts";
import { UserError } from "../../platform/errors.ts";
import { stableId } from "../../platform/ids.ts";
import type { Services } from "../../services/context.ts";
import { foldCsvAccounts } from "../fold-accounts.ts";
import { consumeLinkState, dropLinkState, issueLinkState } from "../link-state.ts";
import { bankById, DEFAULT_BANK } from "./banks.ts";
import { EnableBankingError } from "./client.ts";
import { enableBanking } from "./connector.ts";
import { clientFor } from "./credentials.ts";
import { accountName, accountType } from "./mapper.ts";

/** Step 1: returns the bank's consent page URL. Only banks in the registry (banks.ts) can be started. */
export async function startConnection(s: Services, userId: string, bankId: unknown = DEFAULT_BANK.id, returnTo?: unknown): Promise<{ url: string }> {
  const bank = bankById(bankId);
  if (!bank) throw new UserError("Tuntematon pankki.");
  const client = await clientFor(s, userId);
  const country = bank.country;

  const aspsp = (await client.listAspsps(country)).find((a) => a.name.toLowerCase() === bank.aspspName.toLowerCase());
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
    if (err instanceof EnableBankingError && (/REDIRECT_URI_NOT_ALLOWED/.test(err.message) || (err.status === 422 && /redirect/i.test(err.body)))) {
      throw new UserError(`Enable Banking ei hyväksy paluuosoitetta. Lisää sovelluksen Redirect URLs -kohtaan: ${s.redirectUrl()}`);
    }
    throw err;
  }
}

/** Step 2: the bank redirected back with `code` and `state`. */
export async function completeConnection(s: Services, repo: FinanceRepo, code: string, state: string): Promise<{ connectionId: string; accounts: number }> {
  await consumeLinkState(s, repo.userId, state);

  const session = await (await clientFor(s, repo.userId)).createSession(code);
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
      iban: a.account_id?.iban ?? null,
      currency: a.currency ?? "EUR",
      type: accountType(a),
    });
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
