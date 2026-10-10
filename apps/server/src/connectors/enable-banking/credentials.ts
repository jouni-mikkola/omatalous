/**
 * Which Enable Banking application a user's calls are signed with. Each user uses either their own (stored
 * encrypted) or the household's shared one (set up by an admin in the browser, see app-setup.ts).
 */
import type { EnableBankingConfig } from "../../platform/config.ts";
import { UserError } from "../../platform/errors.ts";
import { canonicalPrivateKey, KeyProblem } from "../../security/private-key.ts";
import type { Services } from "../../services/context.ts";
import { instanceCredentials, parseAppId } from "./app-setup.ts";
import { EnableBankingClient } from "./client.ts";

export interface ResolvedCredentials extends EnableBankingConfig {
  source: "user" | "instance";
}

export async function resolveCredentials(s: Services, userId: string): Promise<ResolvedCredentials | null> {
  const own = await s.users.getBankCredentials(userId);
  if (own) {
    const box = await s.secretBox();
    if (!box) throw new UserError("Pankkiavainta ei voi avata. Pyydä ylläpitäjää tarkistamaan palvelimen loki.");
    return { appId: own.appId, privateKeyPem: await box.open(own.privateKeyEnc, userId), source: "user" };
  }
  const shared = await instanceCredentials(s);
  return shared ? { appId: shared.appId, privateKeyPem: shared.privateKeyPem, source: "instance" } : null;
}

/** Validates and stores a member's own Enable Banking app id + private key (encrypted, re-encoded). */
export async function saveCredentials(s: Services, userId: string, appIdInput: unknown, privateKeyInput: unknown): Promise<void> {
  const box = await s.secretBox();
  if (!box) throw new UserError("Avaimia ei voi nyt tallentaa. Pyydä ylläpitäjää tarkistamaan palvelimen loki.");
  const appId = parseAppId(appIdInput);
  let pem: string;
  try {
    pem = await canonicalPrivateKey(privateKeyInput);
  } catch (err) {
    if (err instanceof KeyProblem) throw new UserError(err.message);
    throw err;
  }
  await s.users.setBankCredentials(userId, appId, await box.seal(pem, userId));
}

export async function clientFor(s: Services, userId: string): Promise<EnableBankingClient> {
  const creds = await resolveCredentials(s, userId);
  if (!creds) throw new UserError("Pankkiyhteydet eivät ole vielä käytössä. Pyydä ylläpitäjää ottamaan ne käyttöön kohdassa Asetukset > Palvelin.");
  return new EnableBankingClient({ appId: creds.appId, privateKeyPem: creds.privateKeyPem, fetch: s.fetch, authHosts: s.config.bank.authHosts, timeZone: s.instance.current.timezone });
}
