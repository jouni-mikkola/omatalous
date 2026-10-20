/**
 * Password hashing with PBKDF2-HMAC-SHA256 (WebCrypto). Stored as
 * "pbkdf2_sha256$<iterations>$<salt>$<hash>" so the iteration count can be
 * raised later and old hashes still verify.
 */
import { fromBase64Url, randomBytes, timingSafeEqual, toBase64Url, utf8 } from "./encoding.ts";

/** OWASP's 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const DEFAULT_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 12;

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2_sha256" || !iter || !salt || !hash) return false;
  const derived = await derive(password, fromBase64Url(salt), Number(iter));
  return timingSafeEqual(derived, fromBase64Url(hash));
}

/** A dummy hash to verify against when the user does not exist, so timing does not reveal valid usernames. */
export const DUMMY_HASH = "pbkdf2_sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Salasanan pitää olla vähintään ${MIN_PASSWORD_LENGTH} merkkiä.`;
  if (password.length > 256) return "Salasana on liian pitkä.";
  return null;
}

/** Readable random password for new household members, e.g. "kx7m-q2rt-9wfa-ze4p". */
export function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]!);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}
