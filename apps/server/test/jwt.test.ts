import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signJwt } from "../src/connectors/enable-banking/jwt.ts";
import { importPrivateKey } from "../src/security/rsa-key.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function decode(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("Enable Banking JWT", () => {
  it.each(["pkcs8", "pkcs1"] as const)("signs a verifiable RS256 token with a %s key", async (type) => {
    const pem = privateKey.export({ type, format: "pem" }).toString();
    const token = await signJwt("app-123", await importPrivateKey(pem), Date.UTC(2026, 9, 9) );
    const [h, p, sig] = token.split(".");
    expect(decode(h!)).toEqual({ typ: "JWT", alg: "RS256", kid: "app-123" });
    expect(decode(p!)).toMatchObject({ iss: "enablebanking.com", aud: "api.enablebanking.com" });
    expect(decode(p!).exp - decode(p!).iat).toBe(3600);
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig!, "base64url"))).toBe(true);
  });
});
