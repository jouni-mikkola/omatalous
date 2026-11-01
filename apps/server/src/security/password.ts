/**
 * Password hashing with Argon2id (node:crypto, so no native package in the bundle). Stored as the PHC string
 * "argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<hash>", so the cost can be raised later and old hashes still
 * verify. The hashes of earlier versions, "pbkdf2_sha256$<iterations>$<salt>$<hash>", still verify and are rewritten
 * at the next good sign-in (`needsRehash`).
 */
import { argon2, type Argon2Parameters } from "node:crypto";
import { promisify } from "node:util";
import { checkPassword } from "@banking/core";
import { UserError } from "../platform/errors.ts";
import { limitField } from "../platform/limits.ts";
import { fromBase64Url, randomBytes, timingSafeEqual, toBase64Url, utf8 } from "./encoding.ts";

const argon2Async = promisify<Argon2Parameters & { message: Uint8Array }, Buffer>((p, cb) => argon2("argon2id", p, cb));

/** The cost of a new hash: memory in KiB, passes, and one lane (a lane would take a second thread of the pool per hash). */
export interface PasswordCost {
  memoryKib: number;
  passes: number;
}

const TAG_BYTES = 32;
const LANES = 1;
/** What a stored hash may ask for, so a damaged row cannot ask for gigabytes or minutes: what the schema lets an admin set. */
const MAX_MEMORY_KIB = limitField("passwordMemoryKib").max;
const MAX_PASSES = limitField("passwordPasses").max;
const MAX_ITERATIONS = 10_000_000;

const ARGON2 = /^argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,3}),p=1\$([\w-]{1,64})\$([\w-]{1,128})$/;

async function deriveArgon2(password: string, salt: Uint8Array<ArrayBuffer>, memoryKib: number, passes: number): Promise<Uint8Array> {
  const hash = await argon2Async({ message: utf8.encode(password.normalize("NFKC")), nonce: salt, parallelism: LANES, tagLength: TAG_BYTES, memory: memoryKib, passes });
  return new Uint8Array(hash);
}

async function derivePbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, cost: PasswordCost): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveArgon2(password, salt, cost.memoryKib, cost.passes);
  return `argon2id$v=19$m=${cost.memoryKib},t=${cost.passes},p=${LANES}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const argon = ARGON2.exec(stored);
  if (argon) {
    const memory = Number(argon[1]);
    const passes = Number(argon[2]);
    if (memory < 8 || memory > MAX_MEMORY_KIB || passes < 1 || passes > MAX_PASSES) return false;
    const salt = decode(argon[3]!);
    const tag = decode(argon[4]!);
    if (!salt || salt.length < 8 || tag?.length !== TAG_BYTES) return false;
    return timingSafeEqual(await deriveArgon2(password, salt, memory, passes), tag);
  }
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2_sha256" || !iter || !salt || !hash) return false;
  const iterations = Number(iter);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  const saltBytes = decode(salt);
  const tag = decode(hash);
  if (!saltBytes || tag?.length !== TAG_BYTES) return false;
  return timingSafeEqual(await derivePbkdf2(password, saltBytes, iterations), tag);
}

/** The bytes of base64url text, or null when it is no base64url (a damaged row must be a refusal, not a 500). */
function decode(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return fromBase64Url(text);
  } catch {
    return null;
  }
}

/** A PBKDF2 hash no password matches. */
const legacyDummy = (iterations: number): string => `pbkdf2_sha256$${iterations}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

/** The rounds of a PBKDF2 hash, or null when `stored` is not one. */
export const pbkdf2Rounds = (stored: string): number | null => (stored.startsWith("pbkdf2_sha256$") ? Number(stored.split("$")[1]) || null : null);

/**
 * A check that costs the same whoever the name belongs to. `stored` is null for an unknown name. `legacyRounds` is the
 * most rounds of any PBKDF2 hash still stored, or null when none is left. While there is one, each check also spends the
 * cost of the scheme it did not need, so a PBKDF2 user, an Argon2id user and an unknown name all take one PBKDF2 and one
 * Argon2id derivation and timing tells nothing. Users whose hash was made at another cost than the rest (after an admin
 * changed the setting) still stand out until their next sign-in rewrites it.
 */
export async function verifyUniform(password: string, stored: string | null, cost: PasswordCost, legacyRounds: number | null): Promise<boolean> {
  const used = stored ?? dummyHash(cost);
  const ok = await verifyPassword(password, used);
  if (legacyRounds !== null) await verifyPassword(password, pbkdf2Rounds(used) !== null ? dummyHash(cost) : legacyDummy(legacyRounds));
  return ok;
}

/** True for a hash that is not Argon2id at the cost now set: older scheme, or lower or different parameters. */
export function needsRehash(stored: string, cost: PasswordCost): boolean {
  const argon = ARGON2.exec(stored);
  return !argon || Number(argon[1]) !== cost.memoryKib || Number(argon[2]) !== cost.passes;
}

/**
 * A hash to verify against when the user does not exist, with the cost of a real one, so timing does not reveal
 * valid usernames. The salt and tag are fixed and match nothing.
 */
const dummyHash = (cost: PasswordCost): string => `argon2id$v=19$m=${cost.memoryKib},t=${cost.passes},p=${LANES}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

/** The refusal of a password the rules do not accept, as a coded UserError; null when it may be used. */
export function passwordRefusal(password: string): UserError | null {
  const { problem, issue } = checkPassword(password);
  return problem === null || issue === null ? null : new UserError(problem, issue);
}

/** Readable random password for new household members, e.g. "kx7m-q2rt-9wfa-ze4p". */
export function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]!);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}
