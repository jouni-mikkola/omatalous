/**
 * One-time codes of RFC 6238 (TOTP) on RFC 4226 (HOTP): HMAC-SHA1, 30-second steps, 6 digits. This is what every
 * authenticator app speaks. Nothing here needs a secure browser context, so it works on plain http.
 */
import { createHmac } from "node:crypto";
import { randomBytes } from "./encoding.ts";

const STEP_SECONDS = 30;
const SECRET_BYTES = 20;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** A new secret as the authenticator app shows it: 20 random bytes, base32 without padding. */
export const newSecret = (): string => base32(randomBytes(SECRET_BYTES));

/** The code of one step; `secret` is the base32 text. `digits` is 6 for a person; the RFC's own table uses 8. */
export function totpCode(secret: string, step: number, digits = 6): string {
  const key = Buffer.from(unbase32(secret));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function unbase32(text: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of text.toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) continue;
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export const stepOf = (nowMs: number): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

/** What an authenticator app reads from the picture: `Omatalous:<username>`, the secret and the issuer. */
export function otpauthUri(username: string, secret: string): string {
  return `otpauth://totp/Omatalous:${encodeURIComponent(username)}?secret=${secret}&issuer=Omatalous`;
}
