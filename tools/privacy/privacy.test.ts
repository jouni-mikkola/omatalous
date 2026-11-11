/**
 * The privacy check (tools/privacy/scan.mjs): each detector with a hit and its near misses, the allowances, the stamp of
 * a picture, and a run of the command on a throwaway repository. Every value a hit needs is built here at run time,
 * so this file passes the check itself.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { tempDir } from "../lib/tmp-kit.ts";
import { stampPng } from "./png-stamp.mjs";
import { addonCodeReal, detect, hashSets, hetuValid, ibanValid, loadLists, luhn, matchGlob, pngTexts, runs, scanIdentity, scanImage, scanLine, scanPath, sha } from "./scan.mjs";

const SCAN = join(import.meta.dirname, "scan.mjs");
const NONE = { words: new Set<string>(), users: new Set<string>(), hosts: new Set<string>() };
const kinds = (line: string, sets = NONE) => detect(line, sets).map((d) => d.kind);

/** A Finnish account number with right check digits, made from a bank code and an account. */
function iban(bban: string): string {
  const digits = `${bban}1518` + "00";
  const check = 98 - Number(BigInt(digits) % 97n);
  return `FI${String(check).padStart(2, "0")}${bban}`;
}

/** A card number of the length asked with the right Luhn digit. */
function card(start: string, length: number): string {
  let body = start.padEnd(length - 1, "7");
  for (let d = 0; d <= 9; d++) if (luhn(`${body}${d}`)) return `${body}${d}`;
  body = "";
  return body;
}

describe("personal data", () => {
  it("finds an account number with valid check digits, also in groups of four, and lets the documented example pass", () => {
    const made = iban("23456000001234");
    expect(ibanValid(made)).toBe(true);
    expect(kinds(`maksu tilille ${made} tänään`)).toEqual(["iban"]);
    expect(kinds(`tili ${made.replace(/(.{4})/g, "$1 ").trim()}.`)).toEqual(["iban"]);
    // near misses: a wrong check, a creditor reference, too short
    expect(kinds(made.slice(0, 2) + "00" + made.slice(4))).toEqual([]);
    expect(kinds(`RF18${"539007547034"}`)).toEqual([]);
    const lists = loadLists();
    expect(scanLine(`FI21 1234 5600 0007 85`, "x", "docs/x.md", lists, hashSets(lists))).toEqual([]);
  });

  it("finds a personal id with a real date and check mark, not one whose mark fails", () => {
    const id = ["131052", "308T"].join("-");
    expect(hetuValid(id)).toBe(true);
    expect(kinds(`hetu ${id}`)).toEqual(["hetu"]);
    expect(kinds(`hetu ${id.slice(0, -1)}X`)).toEqual([]);
    expect(kinds(`${["320152", "308T"].join("-")}`)).toEqual([]);
  });

  it("finds an address outside the example domains", () => {
    expect(kinds(`mail ${["someone", "mail.fi"].join("@")}`)).toEqual(["email"]);
    expect(kinds("mail someone@example.com, a@b.test, c@esimerkki.fi, d@x.invalid")).toEqual([]);
  });

  it("finds a Finnish mobile number and not a colour, a version or an amount", () => {
    expect(kinds(`soita ${["040", "123", "4567"].join(" ")}`)).toEqual(["phone"]);
    expect(kinds(`+358 ${["40", "123", "4567"].join(" ")}`)).toEqual(["phone"]);
    expect(kinds("color: #050508; 0.4512345 € 2026-04-12")).toEqual([]);
  });

  it("finds a card number that passes Luhn, not its last four, not a test number", () => {
    const pan = card("45321", 16);
    expect(kinds(`kortti ${pan.replace(/(.{4})/g, "$1 ").trim()}`)).toEqual(["card"]);
    expect(kinds(`kortti **** **** **** ${pan.slice(-4)}`)).toEqual([]);
    const lists = loadLists();
    expect(scanLine("4111 1111 1111 1111", "x", "e2e/x.ts", lists, hashSets(lists))).toEqual([]);
  });

  it("does not read an account number's digits as a card", () => {
    expect(kinds(`${iban(["4405202", "0036082"].join("")).replace(/(.{4})/g, "$1 ").trim()}`)).toEqual(["iban"]);
  });
});

describe("secrets", () => {
  it("finds a private key with its body, not a header alone or a test's made-up body", () => {
    const head = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const body = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7".padEnd(64, "Q");
    expect(kinds(`"${head}\\n${body}\\n"`)).toEqual(["secret"]);
    expect(detect(head, NONE, body).map((d) => d.kind)).toEqual(["secret"]);
    expect(kinds(`if (pem.startsWith("${head}"))`)).toEqual([]);
    expect(detect(head, NONE, "MC4CAQAwBQYDK2VwBCIEIFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKE").map((d) => d.kind)).toEqual([]);
  });

  it("finds tokens by their shape", () => {
    expect(kinds(`token ${["ghp", "a".repeat(36)].join("_")}`)).toEqual(["secret"]);
    expect(kinds(`Bearer ${["omt", "B".repeat(43)].join("_")}`)).toEqual(["secret"]);
    expect(kinds("omt_… is the prefix")).toEqual([]);
  });

  it("finds an add-on code unless it is plainly an example", () => {
    const code = (o: object) => `omt1.${Buffer.from(JSON.stringify(o)).toString("base64url")}`;
    expect(addonCodeReal(code({ repo: "owner/name", token: "read-only-token" }))).toBe(false);
    expect(addonCodeReal(code({ repo: "example/addon", token: "x" }))).toBe(false);
    expect(addonCodeReal(code({ repo: "someone/thing", token: "x" }))).toBe(true);
    expect(addonCodeReal(code({ repo: "owner-x/thing", token: "x" }))).toBe(true);
    expect(addonCodeReal(code({ repo: "owner/name", token: ["github", "pat", "A".repeat(60)].join("_") }))).toBe(true);
    expect(kinds(code({ repo: "acme/stuff", token: "abc" }))).toEqual(["secret"]);
  });
});

describe("words kept as hashes", () => {
  const sets = { words: new Set([sha("hiddenword"), sha("two words"), sha("api.hidden.fi")]), users: new Set([sha("someuser")]), hosts: new Set([sha("somehost")]) };

  it("finds a word as a token, a part of a name, a camelCase word and a pair", () => {
    expect(kinds("the HiddenWord is here", sets)).toEqual(["word"]);
    expect(kinds("src/hiddenword-list/x.ts", sets)).toEqual(["word"]);
    expect(kinds("getHiddenWord()", sets)).toEqual([]);
    expect(kinds("const fetchHiddenword = 1", sets)).toEqual(["word"]);
    expect(kinds("Two  Words apart", sets)).toEqual(["word"]);
    expect(kinds("https://api.hidden.fi/v1", sets)).toEqual(["word"]);
    expect(kinds("hiddenwords and unhiddenword", sets)).toEqual([]);
  });

  it("finds an account name in a home path or before @, and a machine name where a host stands", () => {
    expect(kinds("/home/someuser/code", sets)).toEqual(["user"]);
    expect(kinds("C:\\Users\\SomeUser\\x", sets)).toEqual(["user"]);
    expect(kinds("ssh somehost", sets)).toEqual(["host"]);
    expect(kinds("someuser@somehost:~/x", sets)).toEqual(["user", "host"]);
    expect(kinds("somehost.local", sets)).toEqual(["host"]);
    expect(kinds("the somehost word alone", sets)).toEqual([]);
  });

  it("lets a file keep the uses it had, by kind and hash", () => {
    const lists = { words: [], users: [], hosts: [], examples: {}, skip: { email: ["LICENSE"] }, baseline: { "a.ts": [`word:${sha("hiddenword")}`] } };
    expect(scanLine("hiddenword", "a.ts:1", "a.ts", lists, sets)).toEqual([]);
    expect(scanLine("hiddenword", "b.ts:1", "b.ts", lists, sets)).toHaveLength(1);
    expect(scanLine(["x", "mail.fi"].join("@"), "LICENSE:1", "LICENSE", lists, sets)).toEqual([]);
  });

  it("splits runs as documented", () => {
    expect([...runs("api.x-y.fi")]).toEqual(expect.arrayContaining(["api", "x-y", "x-y.fi", "api.x-y.fi", "fi"]));
  });

  it("never prints the value it found", () => {
    const [hit] = scanLine(`/home/someuser`, "f:1", "f", { words: [], users: [], hosts: [], examples: {}, skip: {}, baseline: {} }, sets);
    expect(JSON.stringify(hit)).not.toContain("someuser");
    const [mail] = scanLine(["someone", "mail.fi"].join("@"), "f:1", "f", { words: [], users: [], hosts: [], examples: {}, skip: {}, baseline: {} }, NONE);
    expect(mail?.shown).not.toContain("mail.fi");
  });
});

describe("paths and commits", () => {
  it("refuses the add-on's folders, keys, .env files and databases", () => {
    for (const p of ["apps/server/src/private/x.ts", "extension/a/b.js", "apps/server/migrations/9001_x.sql", ".env", "deploy/.env.prod", "a/server.key", "data/app.db", "id_ed25519", "x/app_secret"]) expect(scanPath(p), p).not.toEqual([]);
    for (const p of [".env.example", "apps/server/migrations/0042_x.sql", "apps/server/migrations/9900_drill.sql", "docs/privacy.md", "e2e/private-migrations.ts"]) expect(scanPath(p), p).toEqual([]);
  });

  it("lets only GitHub's no-reply addresses author a commit", () => {
    expect(scanIdentity("1+someone@users.noreply.github.com", "noreply@github.com", "c")).toEqual([]);
    expect(scanIdentity(["someone", "mail.fi"].join("@"), "noreply@github.com", "c")).toHaveLength(1);
  });

  it("matches globs", () => {
    expect(matchGlob("**/*.sql", "a/b/c.sql")).toBe(true);
    expect(matchGlob("LICENSE", "x/LICENSE")).toBe(false);
  });
});

/** A one-pixel PNG. */
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    return out;
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))), chunk("IEND", Buffer.alloc(0))]);
}

describe("pictures", () => {
  it("lets in a picture shots stamped and refuses one it did not", () => {
    const stamped = stampPng(png(), "demo");
    expect(pngTexts(stamped)).toEqual({ "omatalous-shot": "demo" });
    expect(stampPng(stamped, "demo")).toBe(stamped);
    expect(scanImage("docs/images/x.png", stamped)).toEqual([]);
    expect(scanImage("docs/images/x.png", png())).toHaveLength(1);
    expect(scanImage("docs/x.jpg", Buffer.from("jpeg"))).toHaveLength(1);
    expect(scanImage("apps/web/public/icons/x.png", png())).toEqual([]);
  });
});

describe("the command", () => {
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_COMMITTER_NAME: "T", GIT_AUTHOR_EMAIL: "1+t@users.noreply.github.com", GIT_COMMITTER_EMAIL: "1+t@users.noreply.github.com" } });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.trim();
  };

  it("passes a clean change, fails one with an address, a picture and a commit address, and prints no value", () => {
    const dir = tempDir("privacy-");
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.md"), "start\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "start");
    const base = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "a.md"), "start\nnothing to see\n");
    git(dir, "commit", "-qam", "Plain change");
    const clean = spawnSync(process.execPath, [SCAN, "--diff", base, "HEAD"], { cwd: dir, encoding: "utf8" });
    expect(clean.status, clean.stdout).toBe(0);

    const mail = ["someone", "mail.fi"].join("@");
    writeFileSync(join(dir, "b.md"), `write to ${mail}\n`);
    writeFileSync(join(dir, "shot.png"), png());
    git(dir, "add", "-A");
    const r0 = spawnSync("git", ["commit", "-qm", "More"], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_COMMITTER_NAME: "T", GIT_AUTHOR_EMAIL: mail, GIT_COMMITTER_EMAIL: mail } });
    expect(r0.status).toBe(0);
    const dirty = spawnSync(process.execPath, [SCAN, "--ci"], { cwd: dir, encoding: "utf8", env: { ...process.env, BASE_SHA: base, HEAD_SHA: "HEAD", PR_TITLE: `Mail ${mail}`, PR_BODY: "fine", PR_BRANCH: "work/x" } });
    expect(dirty.status).toBe(1);
    expect(dirty.stdout).toContain("b.md:1: email");
    expect(dirty.stdout).toContain("shot.png: image");
    expect(dirty.stdout).toContain("author or committer: identity");
    expect(dirty.stdout).toContain("the pull request's title: email");
    expect(dirty.stdout).not.toContain("mail.fi");
  });

  it("before a push: reads new files and the address git commits with, and a clean main has nothing to say", () => {
    const dir = tempDir("privacy-");
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.md"), "x\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "one");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(dir, "config", "user.email", ["someone", "mail.fi"].join("@"));
    const run = () => spawnSync(process.execPath, [SCAN, "--local"], { cwd: dir, encoding: "utf8" });
    expect(run().status, run().stdout).toBe(0);
    writeFileSync(join(dir, "new.md"), `call ${["040", "123", "4567"].join(" ")}\n`);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("new.md:1: phone");
    expect(r.stdout).toContain("git config user.email (the next commit's) author or committer: identity");
  });

  it("a base the clone does not hold reads the head's parent", () => {
    const dir = tempDir("privacy-");
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.md"), "x\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "one");
    writeFileSync(join(dir, "a.md"), "x\ny\n");
    git(dir, "commit", "-qam", "two");
    const r = spawnSync(process.execPath, [SCAN, "--ci"], { cwd: dir, encoding: "utf8", env: { ...process.env, BASE_SHA: "0".repeat(40), HEAD_SHA: "HEAD" } });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe("the workflow", () => {
  it("is the job named privacy, the name of the required check, and runs on every pull request edit and push to main", () => {
    const yml = readFileSync(join(import.meta.dirname, "../../.github/workflows/privacy.yml"), "utf8");
    expect(yml).toMatch(/^jobs:\n {2}privacy:\n/m);
    expect(yml).toContain("types: [opened, edited, synchronize, reopened]");
    expect(yml).not.toMatch(/paths-ignore/);
    // the texts of a pull request never stand in the shell's text
    expect(yml).not.toMatch(/run:.*\$\{\{/);
  });

  it("judges a change with the scanner and lists of its base, so a change that empties the scanner still fails", () => {
    const yml = readFileSync(join(import.meta.dirname, "../../.github/workflows/privacy.yml"), "utf8");
    const step = /- name: Scan\n(?:.*\n)*? {8}run: \|\n((?: {10}.*\n)+)/.exec(yml);
    expect(step, "the Scan step runs a block").not.toBeNull();
    const script = step![1]!.replace(/^ {10}/gm, "");
    expect(script).not.toMatch(/\$\{\{/);

    const dir = tempDir("privacy-");
    const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_COMMITTER_NAME: "T", GIT_AUTHOR_EMAIL: "1+t@users.noreply.github.com", GIT_COMMITTER_EMAIL: "1+t@users.noreply.github.com" };
    const git = (...args: string[]) => {
      const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    };
    git("init", "-q", "-b", "main");
    mkdirSync(join(dir, "tools/privacy"), { recursive: true });
    writeFileSync(join(dir, "tools/privacy/scan.mjs"), readFileSync(SCAN));
    writeFileSync(join(dir, "tools/privacy/lists.json"), readFileSync(join(import.meta.dirname, "lists.json")));
    git("add", "-A");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    // the change weakens the scanner and adds what the base's scanner refuses
    writeFileSync(join(dir, "tools/privacy/scan.mjs"), "process.exit(0);\n");
    writeFileSync(join(dir, "new.md"), `call ${["040", "123", "4567"].join(" ")}\n`);
    git("add", "-A");
    git("commit", "-qm", "change");
    const run = (baseSha: string) =>
      spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
        cwd: dir,
        encoding: "utf8",
        env: { ...env, RUNNER_TEMP: tempDir("privacy-runner-"), BASE_SHA: baseSha, HEAD_SHA: git("rev-parse", "HEAD"), PR_TITLE: "Change", PR_BODY: "", PR_BRANCH: "fix/x" },
      });
    for (const baseSha of [base, "0".repeat(40)]) {
      const r = run(baseSha);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toContain("new.md:1: phone");
    }
  });
});
