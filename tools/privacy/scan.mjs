// @ts-check
/**
 * The `privacy` check (.github/workflows/privacy.yml): what lands in the public repository reveals no personal data, no
 * secret, nothing of the maintainer's machines and nothing of the add-on module. It reads the lines a change adds, the
 * paths it adds, its commit messages and the pull request's title, body and branch name, and fails with one line per
 * finding. A finding never prints the value it found in clear: the log of a public run is public too.
 *
 *   node tools/privacy/scan.mjs --ci                 the workflow's run, from BASE_SHA, HEAD_SHA, PR_TITLE, PR_BODY, PR_BRANCH
 *   node tools/privacy/scan.mjs --diff BASE HEAD     the lines, paths, pictures, commit messages and addresses of BASE..HEAD
 *   node tools/privacy/scan.mjs --text NAME          stdin as one text (a pull request's title, body or branch name)
 *   node tools/privacy/scan.mjs --tree               every tracked file, whole
 *   node tools/privacy/scan.mjs --history [REF]      every line a commit of REF (default HEAD) added, and every message
 *   node tools/privacy/scan.mjs --baseline           the allowances of the tree as JSON, for `baseline` in lists.json
 *
 * Exit 1 when something was found, 2 on a usage error. The words it refuses are SHA-256 hashes in lists.json.
 * Plain Node with no package: the workflow runs it before any install.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {{ words: string[], users: string[], hosts: string[], examples: Record<string, string[]>,
 *   skip: Record<string, string[]>, baseline: Record<string, string[]> }} Lists
 * @typedef {{ where: string, kind: string, shown: string, fix: string }} Finding
 * @typedef {{ words: Set<string>, users: Set<string>, hosts: Set<string> }} Sets
 * @typedef {"iban" | "hetu" | "email" | "phone" | "card" | "secret" | "word" | "user" | "host" | "path" | "file" | "image" | "identity"} Kind
 * @typedef {{ kind: Kind, value: string, shown: string }} Hit
 */

/** @returns {Lists} */
export function loadLists(file = join(HERE, "lists.json")) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export const sha = (/** @type {string} */ s) => createHash("sha256").update(s).digest("hex");

/** What a reader of the log sees of a value: two characters and its length. */
export function mask(/** @type {string} */ value) {
  const v = value.trim();
  return v.length <= 4 ? "*".repeat(v.length) : `${v.slice(0, 2)}${"*".repeat(Math.min(v.length - 2, 12))} (${v.length} chars)`;
}

/** @type {Record<Kind, string>} */
const FIX = {
  iban: "use an example account number (FI21 1234 5600 0007 85) or one the test makes up at run time",
  hetu: "use a made-up personal id whose check mark fails, or an example of tools/privacy/lists.json",
  email: "use an address at example.com, example.org or a .test or .invalid domain",
  identity:
    "commit as GitHub's no-reply address: git config user.email <id>+<login>@users.noreply.github.com, then git rebase --exec 'git commit --amend --no-edit --reset-author' origin/main and push with --force-with-lease",
  phone: "leave the number out or write it with x's (040 xxx xxxx)",
  card: "use a test card number (4111 1111 1111 1111) or the last four digits only",
  secret: "remove it, rotate it if it was ever real, and read secrets from a file or the environment",
  word: "describe the change in neutral words (add-on module, lisäosa)",
  user: "write ~ or $HOME instead of a home path, and name no account of a machine",
  host: "name no machine: write localhost, <host> or an example address",
  path: "files under a private/ folder, extension/ and the add-on's migrations (9000 to 9899) stay out of the public repository",
  file: "keys, .env files and databases stay out of the repository",
  image: "a picture in the repository comes from `pnpm shots` or `pnpm docs:shots` (made-up data, stamped): take it again with them",
};

// --- personal data -----------------------------------------------------------------------------------------------

/** ISO 13616: the first four characters moved to the end, letters as 10 to 35, the number mod 97 is 1. */
export function ibanValid(/** @type {string} */ raw) {
  const s = raw.replace(/ /g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith("FI") && s.length !== 18) return false;
  let r = 0;
  for (const c of s.slice(4) + s.slice(0, 4)) {
    const n = c >= "A" ? c.charCodeAt(0) - 55 : c.charCodeAt(0) - 48;
    r = (r * (n > 9 ? 100 : 10) + n) % 97;
  }
  return r === 1;
}

const HETU_MARKS = "0123456789ABCDEFHJKLMNPRSTUVWXY";
/** A Finnish personal id with a possible date and the right check mark. */
export function hetuValid(/** @type {string} */ s) {
  const m = /^(\d{2})(\d{2})(\d{2})[-+A-FYXWVU](\d{3})([0-9A-Y])$/.exec(s.toUpperCase());
  if (!m) return false;
  const [, dd = "", mm = "", yy = "", nnn = "", mark = ""] = m;
  if (+dd < 1 || +dd > 31 || +mm < 1 || +mm > 12) return false;
  return HETU_MARKS[Number(`${dd}${mm}${yy}${nnn}`) % 31] === mark;
}

export function luhn(/** @type {string} */ digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** Domains reserved for examples (RFC 2606, RFC 6761), the ones only a local network resolves, and GitHub's no-reply one. */
const EXAMPLE_MAIL = /(^|\.)(example\.(com|org|net|fi)|esimerkki\.fi|example|test|invalid|localhost|local)$|^users\.noreply\.github\.com$/i;

/**
 * A private key: its PEM header with a body after it, on the same line (a string with \n in it) or on the next. A
 * header alone is code that looks for one, and a short body is a test's garbage.
 */
const PEM_HEADER = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/;
const PEM_BODY = /^(?:\\r|\\n|\s|")*[A-Za-z0-9+/]{60,}/;

/** Secrets by their own shape. A test that needs one builds it at run time from parts. */
const SECRETS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bomt_[A-Za-z0-9_-]{43}\b/,
];

/**
 * An add-on code (`omt1.` and base64url JSON of a repository and a token) is a secret unless it is plainly an example:
 * the repository is example…/…, owner/… or test/… and the token has no real token's shape.
 */
export function addonCodeReal(/** @type {string} */ code) {
  let o;
  try {
    o = JSON.parse(Buffer.from(code.slice(5), "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (!o || typeof o !== "object") return false;
  const repo = String(o.repo ?? "");
  const token = String(o.token ?? "");
  const exampleRepo = repo === "" || /^(?:example[\w.-]*|owner|test)\/[\w.-]+$/i.test(repo);
  return !exampleRepo || SECRETS.some((re) => re.test(token));
}

// --- words, kept as hashes ---------------------------------------------------------------------------------------

/**
 * The runs of a text a hashed word is looked for in, lower case: each token, each run of up to five of its parts
 * (`api.example.fi` gives `api`, `example.fi`, ...), each word of a camelCase name (`getWordList` gives `word`), and
 * each pair of tokens with one space (`two words`).
 */
export function runs(/** @type {string} */ text) {
  /** @type {Set<string>} */
  const out = new Set();
  const tokens = text.match(/[\p{L}\p{N}]+(?:[-._:/@][\p{L}\p{N}]+)*/gu) ?? [];
  for (let t = 0; t < tokens.length; t++) {
    const token = /** @type {string} */ (tokens[t]).toLowerCase();
    const parts = token.split(/([-._:/@])/);
    for (let a = 0; a < parts.length; a += 2) for (let b = a; b < parts.length && b <= a + 8; b += 2) out.add(parts.slice(a, b + 1).join(""));
    for (const camel of /** @type {string} */ (tokens[t]).match(/\p{Lu}?\p{Ll}+|\p{Lu}+(?!\p{Ll})|\p{N}+/gu) ?? []) out.add(camel.toLowerCase());
    const next = tokens[t + 1];
    if (next) out.add(`${token} ${next.toLowerCase()}`);
  }
  return out;
}

/** The account names a line shows in a home path (/home/x, /Users/x, C:\Users\x, ~x) or before @ in user@host. */
function userSpots(/** @type {string} */ line) {
  const out = [];
  for (const m of line.matchAll(/(?:\/home\/|\/Users\/|[A-Za-z]:\\+Users\\+|~)([\p{L}\p{N}._-]+)|([\p{L}\p{N}._-]+)@/giu)) out.push((m[1] ?? m[2] ?? "").toLowerCase());
  return out;
}

/** The machine names a line shows where a host stands: user@host, //host, ssh host, host.local, hostname=host, host:~. */
function hostSpots(/** @type {string} */ line) {
  const out = [];
  const re = /(?:@|\/\/|\bssh\s+(?:-\S+\s+)*|\bhost(?:name)?\s*[=:]\s*["']?)([\p{L}\p{N}-]+)|([\p{L}\p{N}-]+)\.(?:local|lan|home|internal|ts\.net)\b|([\p{L}\p{N}-]+):~/giu;
  for (const m of line.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3] ?? "").toLowerCase());
  return out;
}

/**
 * What one line shows, before any allowance: each value with its kind. `next` is the line after it, where the body
 * of a private key would stand.
 * @param {string} line
 * @param {Sets} sets
 * @param {string} [next]
 * @returns {Hit[]}
 */
export function detect(line, sets, next = "") {
  /** @type {Hit[]} */
  const out = [];
  const add = (/** @type {Kind} */ kind, /** @type {string} */ value, shown = mask(value)) => out.push({ kind, value, shown });
  // an account number's digits are no card number: the card pattern reads the line with the account numbers blanked
  let rest = line;
  for (const m of line.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g)) {
    // RF and a number is a creditor reference (ISO 11649), with the same check
    if (m[0].startsWith("RF")) continue;
    // the longest valid start: a sentence can go on after the number
    for (let end = m[0].length; end >= 15; end--) {
      const cand = m[0].slice(0, end).trimEnd();
      if (ibanValid(cand)) {
        add("iban", cand.replace(/ /g, ""));
        rest = rest.slice(0, m.index) + " ".repeat(cand.length) + rest.slice(m.index + cand.length);
        break;
      }
    }
  }
  const pem = PEM_HEADER.exec(line);
  if (pem) {
    const after = line.slice(pem.index + pem[0].length);
    const body = PEM_BODY.exec(after)?.[0] ?? (after.trim() === "" ? PEM_BODY.exec(next)?.[0] : undefined);
    // a test's made-up key says so in its body
    if (body && !/fake|dummy|example/i.test(body)) add("secret", pem[0], "a private key");
  }
  for (const m of line.matchAll(/(?<![\p{L}\p{N}])\d{6}[-+A-FYXWVU]\d{3}[0-9A-Y](?![\p{L}\p{N}])/gu)) if (hetuValid(m[0])) add("hetu", m[0].toUpperCase());
  for (const m of line.matchAll(/[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g)) if (!EXAMPLE_MAIL.test(/** @type {string} */ (m[1]))) add("email", m[0].toLowerCase());
  for (const m of line.matchAll(/(?<![\d.,/\w#])(?:\+358|00358|0)[ -]?(?:4\d|50)(?:[ -]?\d){6,8}(?![\d.,/\w])/g)) add("phone", m[0].replace(/[ -]/g, ""));
  for (const m of rest.matchAll(/(?<![\d.,/\w#-])[2-6]\d{3}(?:[ -]?\d{4}){2}[ -]?\d{1,7}(?![\d.,/\w-])/g)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits) && !/^(\d)\1+$/.test(digits)) add("card", digits);
  }
  for (const re of SECRETS) for (const m of line.matchAll(new RegExp(re.source, "g"))) add("secret", m[0], "a key or token");
  for (const m of line.matchAll(/\bomt1\.[A-Za-z0-9_-]{16,}/g)) if (addonCodeReal(m[0])) add("secret", m[0], "an add-on code");
  for (const run of runs(line)) if (sets.words.has(sha(run))) add("word", run, "a word of the private list");
  for (const u of userSpots(line)) if (sets.users.has(sha(u))) add("user", u, "an account name of a machine");
  for (const h of hostSpots(line)) if (sets.hosts.has(sha(h))) add("host", h, "a machine name");
  return out;
}

/** How the baseline names a value: its kind and the SHA-256 of the value in lower case. */
export const keyOf = (/** @type {{ kind: string, value: string }} */ d) => `${d.kind}:${sha(d.value.toLowerCase())}`;

/** `**` any folders, `*` any characters but /. */
export function matchGlob(/** @type {string} */ glob, /** @type {string} */ file) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?");
  return new RegExp(`^${re}$`).test(file);
}

const skipped = (/** @type {Lists} */ lists, /** @type {string} */ kind, /** @type {string} */ file) => Boolean(file) && (lists.skip[kind] ?? []).some((g) => matchGlob(g, file));
const example = (/** @type {Lists} */ lists, /** @type {Hit} */ d) => (lists.examples[d.kind] ?? []).includes(d.value.toLowerCase());

/**
 * Every finding in one line. `file` is the file the line is in ("" for a message, a title or a branch name): the
 * allowances of that file (lists.baseline), the kinds skipped there (lists.skip) and the examples (lists.examples) apply.
 * @param {string} line
 * @param {string} where
 * @param {string} file
 * @param {Lists} lists
 * @param {Sets} sets
 * @param {string} [next] the line after it
 * @returns {Finding[]}
 */
export function scanLine(line, where, file, lists, sets, next = "") {
  const allowed = new Set(lists.baseline[file] ?? []);
  return detect(line, sets, next)
    .filter((d) => !skipped(lists, d.kind, file) && !allowed.has(keyOf(d)) && !example(lists, d))
    .map((d) => ({ where, kind: d.kind, shown: d.shown, fix: FIX[d.kind] }));
}

const IMAGE = /\.(png|apng|jpe?g|webp|gif|avif|bmp|tiff?)$/i;

/**
 * What a path alone says: a private folder, the extension folder, the add-on's migrations, a key, a .env file or a
 * database.
 * @returns {Finding[]}
 */
export function scanPath(/** @type {string} */ path) {
  /** @type {Finding[]} */
  const out = [];
  const lower = path.toLowerCase();
  if (/(^|\/)private(\/|$)|^extension\//.test(lower) || /(^|\/)migrations\/9[0-8]\d\d_/.test(lower)) out.push({ where: path, kind: "path", shown: "a path of the add-on module", fix: FIX.path });
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  const envFile = /^\.env(\.|$)/.test(base) && !/\.(example|sample)$/.test(base);
  if (envFile || /\.(pem|key|p12|pfx|jks|kdbx|sqlite3?|db|db-wal|db-shm)$/.test(base) || /^id_(rsa|dsa|ecdsa|ed25519)/.test(base) || base === "app_secret") {
    out.push({ where: path, kind: "file", shown: "a key, environment or database file", fix: FIX.file });
  }
  return out;
}

/** The keyword `pnpm shots` writes into every picture it takes (tools/privacy/png-stamp.mjs). */
export const STAMP_KEY = "omatalous-shot";

/** The text chunks (tEXt) of a PNG, keyword to text. */
export function pngTexts(/** @type {Buffer} */ png) {
  /** @type {Record<string, string>} */
  const out = {};
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) return out;
  for (let at = 8; at + 8 <= png.length; ) {
    const len = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    if (type === "tEXt") {
      const data = png.subarray(at + 8, at + 8 + len);
      const zero = data.indexOf(0);
      if (zero > 0) out[data.toString("latin1", 0, zero)] = data.toString("latin1", zero + 1);
    }
    if (type === "IEND") break;
    at += 12 + len;
  }
  return out;
}

/**
 * A picture outside the app's own icons and bank logos carries the stamp of `pnpm shots`, which takes pictures only of
 * an app it started itself on an empty data folder.
 * @param {string} path
 * @param {Buffer | null} content
 * @returns {Finding[]}
 */
export function scanImage(path, content) {
  if (!IMAGE.test(path) || path.startsWith("apps/web/public/")) return [];
  return content && pngTexts(content)[STAMP_KEY] ? [] : [{ where: path, kind: "image", shown: "a picture that `pnpm shots` did not take", fix: FIX.image }];
}

/** @param {Lists} lists @returns {Sets} */
export function hashSets(lists) {
  return { words: new Set(lists.words), users: new Set(lists.users), hosts: new Set(lists.hosts) };
}

// --- git ---------------------------------------------------------------------------------------------------------

/** @param {string[]} args */
function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${String(r.stderr).trim()}`);
  return r.stdout;
}

/** @param {string} spec */
function gitBlob(spec) {
  const r = spawnSync("git", ["show", spec], { maxBuffer: 1 << 30 });
  return r.status === 0 ? r.stdout : null;
}

/**
 * The added lines of a unified diff made with -U0, with their file and line number in the new file.
 * @param {string} diff
 * @returns {{ file: string, line: number, text: string }[]}
 */
export function addedLines(diff) {
  const out = [];
  let file = "";
  let line = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) file = l === "+++ /dev/null" ? "" : l.slice(6);
    else if (l.startsWith("@@")) line = Number(/\+(\d+)/.exec(l)?.[1] ?? 0);
    else if (l.startsWith("+") && file) out.push({ file, line: line++, text: l.slice(1) });
  }
  return out;
}

/**
 * The findings of added lines, each read with the line after it when that one was added too.
 * @param {{ file: string, line: number, text: string }[]} lines
 * @param {string} prefix
 * @param {Lists} lists
 * @param {Sets} sets
 */
function scanAdded(lines, prefix, lists, sets) {
  return lines.flatMap(({ file, line, text }, i) => {
    const after = lines[i + 1];
    const next = after && after.file === file && after.line === line + 1 ? after.text : "";
    return scanLine(text, `${prefix}${file}:${line}`, file, lists, sets, next);
  });
}

/**
 * Everything BASE..HEAD adds: lines, paths, pictures and commit messages.
 * @param {string} base
 * @param {string} head
 * @param {Lists} lists
 */
export function scanDiff(base, head, lists) {
  const sets = hashSets(lists);
  /** @type {Finding[]} */
  const found = [];
  const range = `${base}...${head}`;
  const diff = git(["diff", "--no-color", "--no-ext-diff", "--no-textconv", "-U0", "--no-renames", "--diff-filter=AM", range]);
  found.push(...scanAdded(addedLines(diff), "", lists, sets));
  const added = git(["diff", "--name-only", "--no-renames", "--diff-filter=AM", "-z", range]).split("\0").filter(Boolean);
  for (const p of added) {
    found.push(...scanPath(p));
    if (IMAGE.test(p)) found.push(...scanImage(p, gitBlob(`${head}:${p}`)));
    found.push(...scanLine(p, `${p} (its path)`, p, lists, sets));
  }
  for (const entry of git(["log", "--format=%H%x00%ae%x00%ce%x00%B%x01", `${base}..${head}`]).split("\x01")) {
    const [hash, author = "", committer = "", body = ""] = entry.trim().split("\0");
    if (!hash) continue;
    found.push(...scanIdentity(author, committer, `commit ${hash.slice(0, 10)}`));
    body.split("\n").forEach((text, i) => found.push(...scanLine(text, `commit ${hash.slice(0, 10)} message line ${i + 1}`, "", lists, sets)));
  }
  return found;
}

/** The addresses a public commit may carry: GitHub's own and its no-reply address for a user. */
const PUBLIC_MAIL = /^([0-9]+\+)?[\w.-]+@users\.noreply\.github\.com$|^noreply@github\.com$/i;

/**
 * A commit's author and committer address is public with the commit, also on a pull request's branch after the branch
 * is gone. Only GitHub's no-reply addresses (and example domains, for tests) pass.
 * @returns {Finding[]}
 */
export function scanIdentity(/** @type {string} */ author, /** @type {string} */ committer, /** @type {string} */ where) {
  return [...new Set([author, committer])]
    .filter((mail) => !PUBLIC_MAIL.test(mail) && !EXAMPLE_MAIL.test(mail.slice(mail.lastIndexOf("@") + 1)))
    .map(() => ({ where: `${where} author or committer`, kind: "identity", shown: "an address that is not GitHub's no-reply address", fix: FIX.identity }));
}

/** Each tracked file with its text, or null for a binary file. */
function* trackedFiles() {
  for (const file of git(["ls-files", "-z"]).split("\0").filter(Boolean)) {
    let content;
    try {
      content = readFileSync(file);
    } catch {
      continue;
    }
    yield { file, content, text: content.includes(0) ? null : content.toString("utf8") };
  }
}

/** @param {Lists} lists */
export function scanTree(lists) {
  const sets = hashSets(lists);
  /** @type {Finding[]} */
  const found = [];
  for (const { file, content, text } of trackedFiles()) {
    found.push(...scanPath(file));
    if (IMAGE.test(file)) found.push(...scanImage(file, content));
    else if (text !== null) text.split("\n").forEach((l, i, all) => found.push(...scanLine(l, `${file}:${i + 1}`, file, lists, sets, all[i + 1])));
  }
  return found;
}

/**
 * Every line a commit of REF added and every message. Pictures of the past are named by path only.
 * @param {string} ref
 * @param {Lists} lists
 */
export function scanHistory(ref, lists) {
  const sets = hashSets(lists);
  /** @type {Finding[]} */
  const found = [];
  // one commit at a time: the whole history in one string is more than a string may hold
  for (const hash of git(["rev-list", ref]).split("\n").filter(Boolean)) {
    const commit = hash.slice(0, 10);
    // the header on its own: with --diff-filter, git show prints nothing at all for a commit that only deletes
    const [author = "", committer = "", body = ""] = git(["show", "-s", "--format=%ae%x00%ce%x00%B", hash]).split("\0");
    found.push(...scanIdentity(author, committer, `commit ${commit}`));
    body.split("\n").forEach((text, i) => found.push(...scanLine(text, `commit ${commit} message line ${i + 1}`, "", lists, sets)));
    const diff = git(["show", "-p", "--no-color", "--no-ext-diff", "--no-textconv", "-U0", "--no-renames", "--diff-filter=AM", "--format=", hash]);
    found.push(...scanAdded(addedLines(diff), `commit ${commit} `, lists, sets));
    for (const m of diff.matchAll(/^\+\+\+ b\/(.+)$/gm)) found.push(...scanPath(/** @type {string} */ (m[1])).map((f) => ({ ...f, where: `commit ${commit} ${f.where}` })));
  }
  return found;
}

/** The kinds an existing file may keep: the words the app already uses for payees, and made-up personal data of tests. */
const ALLOWABLE = ["word", "iban", "hetu", "email", "phone", "card"];

/**
 * The allowances of the tree: for each file, the private words and personal-data examples it holds now, as
 * `kind:sha256`. Secrets, account and machine names, paths and pictures get none.
 * @param {Lists} lists
 */
export function baseline(lists) {
  /** @type {Record<string, Set<string>>} */
  const out = {};
  const sets = hashSets(lists);
  for (const { file, text } of trackedFiles()) {
    if (text === null) continue;
    for (const [i, l, all] of text.split("\n").map((l, i, all) => /** @type {const} */ ([i, l, all]))) {
      for (const d of detect(l, sets, all[i + 1])) {
        if (ALLOWABLE.includes(d.kind) && !example(lists, d) && !skipped(lists, d.kind, file)) (out[file] ??= new Set()).add(keyOf(d));
      }
    }
  }
  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, [...v].sort()]),
  );
}

/** @param {Finding[]} found */
export function report(found) {
  for (const f of found) console.log(`privacy: ${f.where}: ${f.kind}: ${f.shown}. Fix: ${f.fix}`);
  if (found.length) console.log(`privacy: ${found.length} finding(s). The rules: "The public repository" in CLAUDE.md.`);
}

/**
 * The workflow's run: a pull request's commits, title, body and branch name, or what a push to main added. BASE and
 * HEAD are commits; a BASE the clone does not hold (a new branch, a forced push) is HEAD's parent.
 * @param {Record<string, string | undefined>} env
 * @param {Lists} lists
 */
export function scanCi(env, lists) {
  const head = env.HEAD_SHA || "HEAD";
  const known = (/** @type {string | undefined} */ c) => Boolean(c) && !/^0+$/.test(c ?? "") && spawnSync("git", ["cat-file", "-e", `${c}^{commit}`]).status === 0;
  const base = known(env.BASE_SHA) ? /** @type {string} */ (env.BASE_SHA) : `${head}~1`;
  const sets = hashSets(lists);
  const text = (/** @type {string} */ name, /** @type {string | undefined} */ value) =>
    (value ?? "").split("\n").flatMap((l, i) => scanLine(l, `the pull request's ${name}${name === "body" ? ` line ${i + 1}` : ""}`, "", lists, sets));
  return [...text("title", env.PR_TITLE), ...text("body", env.PR_BODY), ...text("branch name", env.PR_BRANCH), ...scanDiff(base, head, lists)];
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  const lists = loadLists();
  /** @type {Finding[]} */
  let found;
  if (mode === "--ci") found = scanCi(process.env, lists);
  else if (mode === "--diff" && args.length === 2) found = scanDiff(/** @type {string} */ (args[0]), /** @type {string} */ (args[1]), lists);
  else if (mode === "--text" && args.length === 1) {
    const sets = hashSets(lists);
    found = readFileSync(0, "utf8")
      .split("\n")
      .flatMap((l, i) => scanLine(l, `${args[0]} line ${i + 1}`, "", lists, sets));
  } else if (mode === "--tree") found = scanTree(lists);
  else if (mode === "--history") found = scanHistory(args[0] ?? "HEAD", lists);
  else if (mode === "--baseline") {
    console.log(JSON.stringify(baseline(lists), null, 1));
    return 0;
  } else {
    console.error("usage: scan.mjs --ci | --diff BASE HEAD | --text NAME | --tree | --history [REF] | --baseline");
    return 2;
  }
  report(found);
  return found.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
