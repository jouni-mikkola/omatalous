/**
 * An own bank key that cannot be opened is told as a UserError with the way out, and the sealed value is never logged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCredentials } from "../src/connectors/enable-banking/credentials.ts";
import { UserError } from "../src/platform/errors.ts";
import { SecretBox } from "../src/security/secretbox.ts";
import type { Services } from "../src/services/context.ts";

const SECRET_A = "a".repeat(40);
const SECRET_B = "b".repeat(40);
const USER = "user-1";

function services(box: SecretBox, own: { appId: string; privateKeyEnc: string } | null): Services {
  return {
    users: { getBankCredentials: async () => own },
    secretBox: async () => box,
    settings: { get: async () => null },
    config: { enableBanking: { appId: "household", privateKeyPem: "HOUSE" } },
  } as unknown as Services;
}

afterEach(() => vi.restoreAllMocks());

describe("resolveCredentials, own key", () => {
  it("a key sealed under another secret is told, with the way out", async () => {
    const other = await SecretBox.fromSecret(SECRET_B);
    const box = await SecretBox.fromSecret(SECRET_A);
    const sealed = await other.seal("PEM", USER);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await resolveCredentials(services(box, { appId: "app", privateKeyEnc: sealed }), USER).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toContain("ei voi avata");
    expect(err.message).toContain("Asetukset > Pankit ja tilit");
    expect(JSON.stringify(log.mock.calls)).not.toContain(sealed);
  });

  it("a value of no known format is told the same way and not logged", async () => {
    const box = await SecretBox.fromSecret(SECRET_A);
    const bad = "garbage-value-xyz";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await resolveCredentials(services(box, { appId: "app", privateKeyEnc: bad }), USER).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toContain("Asetukset > Pankit ja tilit");
    expect(JSON.stringify(log.mock.calls)).not.toContain(bad);
  });

  it("a key that opens still resolves", async () => {
    const box = await SecretBox.fromSecret(SECRET_A);
    const sealed = await box.seal("PEM", USER);
    expect(await resolveCredentials(services(box, { appId: "app", privateKeyEnc: sealed }), USER)).toEqual({ appId: "app", privateKeyPem: "PEM", source: "user" });
  });

  it("the household's key is used when there is no own key", async () => {
    const box = await SecretBox.fromSecret(SECRET_A);
    expect(await resolveCredentials(services(box, null), USER)).toMatchObject({ appId: "household", privateKeyPem: "HOUSE", source: "instance" });
  });
});
