/**
 * The add-on code the owner pastes in Asetukset (docs/MODULES.md): `omt1.<base64url of {"repo","token"}>`. The text is
 * a secret as a whole. Nothing here names it in an error: every refusal is the same sentence.
 */
import { UserError } from "../platform/errors.ts";

export interface ModuleCode {
  /** `owner/name` of the repository whose releases carry the bundle. */
  repo: string;
  /** Reads that repository's releases. */
  token: string;
}

const PREFIX = "omt1.";
const MAX = 1024;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const TOKEN = /^[A-Za-z0-9_]{20,255}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const CODE_REFUSED = "Koodi ei kelpaa. Tarkista, että liitit sen kokonaan.";

/** The code's two values, or a UserError that repeats none of it. */
export function parseModuleCode(input: unknown): ModuleCode {
  if (typeof input !== "string") throw new UserError(CODE_REFUSED);
  const text = input.trim();
  if (text.length > MAX || !text.startsWith(PREFIX)) throw new UserError(CODE_REFUSED);
  const body = text.slice(PREFIX.length);
  if (!BASE64URL.test(body)) throw new UserError(CODE_REFUSED);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new UserError(CODE_REFUSED);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new UserError(CODE_REFUSED);
  const o = parsed as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.length !== 2 || keys[0] !== "repo" || keys[1] !== "token") throw new UserError(CODE_REFUSED);
  if (typeof o.repo !== "string" || !REPO.test(o.repo) || o.repo.split("/")[1]!.startsWith(".")) throw new UserError(CODE_REFUSED);
  if (typeof o.token !== "string" || !TOKEN.test(o.token)) throw new UserError(CODE_REFUSED);
  return { repo: o.repo, token: o.token };
}

/** The text of a code, for tests and for a module's own release tooling. */
export function moduleCodeText(code: ModuleCode): string {
  return PREFIX + Buffer.from(JSON.stringify({ repo: code.repo, token: code.token })).toString("base64url");
}
