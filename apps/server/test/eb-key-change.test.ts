/**
 * A member's bank app is not changed while a connection made by it is active: the consent would stay alive at the bank.
 */
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removeCredentials, saveCredentials } from "../src/connectors/enable-banking/credentials.ts";
import { UserError } from "../src/platform/errors.ts";
import type { Services } from "../src/services/context.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const OWN = "11111111-aaaa-bbbb-cccc-000000000001";
const OTHER = "22222222-aaaa-bbbb-cccc-000000000002";

function setup(statuses: Array<"active" | "expired" | "revoked">) {
  const events: string[] = [];
  const saved: string[] = [];
  const deleted: number[] = [];
  const s = {
    users: {
      getBankCredentials: async () => ({ appId: OWN, privateKeyEnc: "x" }),
      setBankCredentials: async (_u: string, id: string) => void saved.push(id),
      deleteBankCredentials: async () => void deleted.push(1),
    },
    finance: () => ({ listConnections: async () => statuses.map((status, i) => ({ id: `c${i}`, provider: "enablebanking", institution: `Pankki${i}`, status })) }),
    secretBox: async () => ({ seal: async (v: string) => v, open: async () => PEM }),
    settings: { get: async () => null },
    security: { insert: async (e: { kind: string }) => events.push(e.kind) },
    now: () => new Date("2026-11-11T10:00:00Z"),
    keyTestLimiter: { consume: () => ({ wait: 0, first: false }) },
    fetch: async () => { throw new Error("offline"); },
    config: { bank: { apiUrl: "http://bank.invalid", authHosts: [] }, enableBanking: { appId: "household", privateKeyPem: "HOUSE" } },
  } as unknown as Services;
  return { s, saved, deleted, events };
}

afterEach(() => vi.restoreAllMocks());

const req = {} as never;

describe("a key change with active connections", () => {
  it("removeCredentials is refused, names the connections and records nothing", async () => {
    const { s, deleted, events } = setup(["active", "revoked"]);
    const err = await removeCredentials(s, "u", req).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toContain("Pankki0");
    expect(err.message).toContain("Poista yhteydet ensin");
    expect(deleted).toEqual([]);
    expect(events).not.toContain("bank_key_removed");
  });

  it("saveCredentials with another Application ID is refused and saves nothing", async () => {
    const { s, saved } = setup(["active"]);
    const err = await saveCredentials(s, "u", OTHER, PEM, req).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toContain("Pankki0");
    expect(err.message).toContain("Poista yhteydet ensin");
    expect(saved).toEqual([]);
  });

  it("saveCredentials with the same Application ID passes", async () => {
    const { s, saved } = setup(["active"]);
    await saveCredentials(s, "u", OWN.toUpperCase(), PEM, req);
    expect(saved).toEqual([OWN]);
  });

  it("removeCredentials passes with no active connection, or with revoked and expired ones", async () => {
    for (const statuses of [[], ["revoked", "expired"]] as const) {
      const { s, deleted, events } = setup([...statuses]);
      await removeCredentials(s, "u", req);
      expect(deleted).toEqual([1]);
      expect(events).toContain("bank_key_removed");
    }
  });

  it("saveCredentials with another Application ID passes when no connection is active", async () => {
    const { s, saved } = setup(["expired"]);
    await saveCredentials(s, "u", OTHER, PEM, req);
    expect(saved).toEqual([OTHER]);
  });
});
