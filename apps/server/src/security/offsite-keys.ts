/**
 * The two key pairs of the copy to another machine (services/offsite.ts), made with node:crypto only.
 *
 * Decision: the household can start the copy without a terminal, and the key that opens the copies is theirs alone. The
 * age pair is made here so that the app holds the public half (the recipient) and hands the secret half to the person
 * once; nothing of it is stored or logged. The SSH pair is how this machine signs in to the other one; its private half
 * is sealed in the database (services/offsite.ts) and the public line is for the other machine's authorized_keys.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk >>> 0;
}

/** Bech32 (not bech32m), the encoding age uses for its keys. */
function bech32(hrp: string, bytes: Uint8Array): string {
  const data: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) data.push((acc << (5 - bits)) & 31);
  const expand = [...[...hrp].map((c) => c.charCodeAt(0) >>> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const mod = polymod([...expand, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const check = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...check].map((d) => CHARSET[d]).join("")}`;
}

/** What `age -r` accepts as a public key: the prefix and 58 characters of the bech32 alphabet. */
export const AGE_RECIPIENT = /^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/;

/** A new age key pair: `recipient` (public, `age1…`) and `secret` (`AGE-SECRET-KEY-1…`, for an `age -d -i` key file). */
export function newAgeKey(): { recipient: string; secret: string } {
  const { privateKey } = generateKeyPairSync("x25519");
  const jwk = privateKey.export({ format: "jwk" });
  return {
    recipient: bech32("age", Buffer.from(jwk.x!, "base64url")),
    secret: bech32("age-secret-key-", Buffer.from(jwk.d!, "base64url")).toUpperCase(),
  };
}

const PEM = /^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]{20,400}-----END PRIVATE KEY-----\n?$/;

const sshString = (b: Buffer): Buffer => Buffer.concat([Buffer.from([b.length >>> 24, (b.length >>> 16) & 255, (b.length >>> 8) & 255, b.length & 255]), b]);

/** The `authorized_keys` line of a private key (PKCS#8 PEM, ed25519). */
export function sshPublicLine(pem: string): string {
  const raw = Buffer.from(createPublicKey(createPrivateKey(pem)).export({ format: "jwk" }).x!, "base64url");
  return `ssh-ed25519 ${Buffer.concat([sshString(Buffer.from("ssh-ed25519")), sshString(raw)]).toString("base64")}`;
}

/** A new ed25519 key for ssh, as a PKCS#8 PEM (OpenSSH reads it as it is). */
export function newSshKey(): string {
  return generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

/** True when the text is a key `newSshKey` could have made. */
export function isSshKey(pem: unknown): pem is string {
  if (typeof pem !== "string" || !PEM.test(pem)) return false;
  try {
    return createPrivateKey(pem).asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}
