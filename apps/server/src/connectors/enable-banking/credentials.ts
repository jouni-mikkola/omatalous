/**
 * Which Enable Banking application a user's calls are signed with. Each user uses either their own (stored
 * encrypted) or the household's shared one (set up by an admin in the browser, see app-setup.ts).
 */
import type { EnableBankingConfig } from "../../platform/config.ts";
import { UserError } from "../../platform/errors.ts";
import { canonicalPrivateKey, KeyProblem } from "../../security/private-key.ts";
import type { Services } from "../../services/context.ts";
import { recordEvent } from "../../services/security.ts";
import type { RequestInfo } from "../../services/users.ts";
import { type ActivationResult, countKeyTest, instanceCredentials, parseAppId, testOwnKey } from "./app-setup.ts";
import { EnableBankingClient } from "./client.ts";

export interface ResolvedCredentials extends EnableBankingConfig {
  source: "user" | "instance";
}

export async function resolveCredentials(s: Services, userId: string): Promise<ResolvedCredentials | null> {
  const own = await s.users.getBankCredentials(userId);
  if (own) {
    const box = await s.secretBox();
    if (!box) throw new UserError("Pankkiavainta ei voi avata. Pyydä ylläpitäjää katsomaan palvelimen lokia.");
    return { appId: own.appId, privateKeyPem: await box.open(own.privateKeyEnc, userId), source: "user" };
  }
  const shared = await instanceCredentials(s);
  return shared ? { appId: shared.appId, privateKeyPem: shared.privateKeyPem, source: "instance" } : null;
}

/**
 * Validates and stores a member's own Enable Banking app id + private key (encrypted, re-encoded), after trying the
 * pair against Enable Banking. A pair it refuses (401) is not saved, so a working key is not replaced by a wrong one.
 * Any other outcome saves the key and says what the test found: the app may still be inactive, or Enable Banking
 * out of reach for a moment. Each call is counted per user first, before the key is imported (app-setup.ts countKeyTest).
 */
export async function saveCredentials(s: Services, userId: string, appIdInput: unknown, privateKeyInput: unknown, req: RequestInfo): Promise<ActivationResult> {
  await countKeyTest(s, userId, req);
  const box = await s.secretBox();
  if (!box) throw new UserError("Avaimia ei voi nyt tallentaa. Pyydä ylläpitäjää katsomaan palvelimen lokia.");
  const appId = parseAppId(appIdInput);
  let pem: string;
  try {
    pem = await canonicalPrivateKey(privateKeyInput);
  } catch (err) {
    if (err instanceof KeyProblem) throw new UserError(err.message);
    throw err;
  }
  const tested = await testOwnKey(s, appId, pem);
  if (tested.keyRefused) throw new UserError(`${tested.message} Avainta ei tallennettu.`);
  await s.users.setBankCredentials(userId, appId, await box.seal(pem, userId));
  await recordEvent(s, { kind: "bank_key_saved", userId, ...req, detail: `Application ID ${appId}` });
  return { ...tested, message: `Avain tallennettu. ${tested.message}` };
}

export async function removeCredentials(s: Services, userId: string, req: RequestInfo): Promise<void> {
  await s.users.deleteBankCredentials(userId);
  await recordEvent(s, { kind: "bank_key_removed", userId, ...req });
}

export async function clientFor(s: Services, userId: string): Promise<EnableBankingClient> {
  const creds = await resolveCredentials(s, userId);
  if (!creds) throw new UserError("Pankkiyhteydet eivät ole vielä käytössä. Pyydä ylläpitäjää ottamaan ne käyttöön kohdassa Asetukset > Palvelin.");
  return new EnableBankingClient({ appId: creds.appId, privateKeyPem: creds.privateKeyPem, baseUrl: s.config.bank.apiUrl, fetch: s.fetch, authHosts: s.config.bank.authHosts, timeZone: s.instance.current.timezone });
}
