/**
 * How good a new password is, with the reason when it is refused. One definition for the server (which refuses) and the
 * browser (which tells while typing), so the two never disagree.
 * Decision: whether the household member can go on with the password they typed or must pick another.
 */

import { DEFAULT_LANGUAGE, type Language } from "./locale.ts";
import { messageFromWire, messageIn } from "./messages.ts";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
/** The shortest run of repeats that is refused when digits or signs follow it: under this the tail carries the password. */
const MIN_REPEATED_LENGTH = 8;

/** Passwords that lead every leaked list, in Finnish and English, compared after lower-casing and cutting digits and signs off the end. */
const COMMON = new Set([
  "password", "passw0rd", "salasana", "salasana123", "qwerty", "qwertyuiop", "qwertyuiopasdf", "asdfghjkl", "asdfghjklzxcv", "zxcvbnm",
  "letmein", "welcome", "iloveyou", "admin", "administrator", "changeme", "football", "baseball", "monkey", "dragon", "master",
  "sunshine", "princess", "trustno", "starwars", "superman", "batman", "abc", "abcdef", "abcdefghijkl", "abcdefghijklmnop",
  "kissa", "koira", "jalkapallo", "suomi", "finland", "helsinki", "tervetuloa", "perhe", "rakkaus", "aurinko", "kesa", "talvi",
  "omatalous", "talous", "pankki", "banking", "money", "login", "secret", "internet", "computer", "hockey", "liverpool",
]);

/** Runs of the keyboard rows and of the alphabet and digits: a password made of one is a pattern, not a secret. */
const SEQUENCES = ["qwertyuiopasdfghjklzxcvbnm", "abcdefghijklmnopqrstuvwxyz", "0123456789", "01234567890"];

const strip = (p: string) => p.normalize("NFKC").toLowerCase().replace(/[^\p{L}]+$/u, "");

function inSequence(p: string): boolean {
  const s = p.toLowerCase();
  if (s.length < 6) return false;
  return SEQUENCES.some((seq) => seq.includes(s) || [...seq].reverse().join("").includes(s));
}

/** One block said again and again ("PasswordPassword", "12341234abcd" is not: the whole text must be the repeats). */
function repeatsABlock(p: string): boolean {
  for (let size = 1; size <= p.length / 2; size++) {
    if (p.length % size === 0 && p === p.slice(0, size).repeat(p.length / size)) return true;
  }
  return false;
}

/** Almost every step is one character up or down in the code table: "123456789012", "abcdefghijklmnop". */
function mostlyStepping(p: string): boolean {
  let steps = 0;
  for (let i = 1; i < p.length; i++) if (Math.abs(p.charCodeAt(i) - p.charCodeAt(i - 1)) === 1) steps++;
  return steps >= (p.length - 1) * 0.8;
}

type PasswordCheck = {
  /** Why the password is refused, in the words of the page; null when it may be used. */
  problem: string | null;
  /** The catalogue code of that reason and its parameters, for the server to send on (core messages.ts). */
  issue: { code: "pw.too_short" | "pw.too_long" | "pw.common" | "pw.few_chars" | "pw.repeated" | "pw.sequence"; params?: { min: number } } | null;
  /** 0 refused, 1 weak but allowed, 2 fair, 3 good, 4 strong. */
  level: 0 | 1 | 2 | 3 | 4;
};

export function checkPassword(typed: string, lang: Language = DEFAULT_LANGUAGE): PasswordCheck {
  // the server hashes the NFKC form, so the rules judge that one
  const password = typed.normalize("NFKC");
  const refuse = (code: NonNullable<PasswordCheck["issue"]>["code"]): PasswordCheck => {
    const params = code === "pw.too_short" ? { min: MIN_PASSWORD_LENGTH } : undefined;
    return { problem: messageFromWire(code, params, lang) ?? "", issue: { code, ...(params ? { params } : {}) }, level: 0 };
  };
  if (password.length < MIN_PASSWORD_LENGTH) return refuse("pw.too_short");
  if (password.length > MAX_PASSWORD_LENGTH) return refuse("pw.too_long");
  const bare = strip(password);
  if (COMMON.has(bare) || COMMON.has(password.toLowerCase())) return refuse("pw.common");
  if (new Set(password.toLowerCase()).size <= 3) return refuse("pw.few_chars");
  // digits and signs after the repeats do not save it ("passwordpassword1"), as long as the repeats are most of the password
  const repeatsUnderTail = bare.length >= MIN_REPEATED_LENGTH && bare.length * 2 > password.length && repeatsABlock(bare);
  if (repeatsABlock(password.toLowerCase()) || repeatsUnderTail) return refuse("pw.repeated");
  if (inSequence(password.replace(/\s/g, "")) || mostlyStepping(password.toLowerCase())) return refuse("pw.sequence");
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\d/, /[^\p{L}\d]/u].filter((re) => re.test(password)).length;
  const distinct = new Set(password).size;
  const score = (password.length >= 16 ? 2 : password.length >= 14 ? 1 : 0) + (classes >= 3 ? 1 : 0) + (distinct >= 10 ? 1 : 0) + (classes >= 2 ? 0 : -1);
  const level = Math.max(1, Math.min(4, 1 + score)) as 1 | 2 | 3 | 4;
  return { problem: null, issue: null, level };
}

/** The word for how strong an allowed password is, in the reader's language. */
export const passwordLevelText = (level: 1 | 2 | 3 | 4, lang: Language = DEFAULT_LANGUAGE): string => messageIn(lang, `pw.level_${level}`);
