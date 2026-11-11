/**
 * The add-on module loader end to end (docs/MODULES.md): a bundle built and signed here with a throwaway key, served by a
 * fake release service, installed by the code, loaded at the next "start", with a route, a migration and its web files.
 * Every broken bundle is refused before any of it runs, and the code shows up nowhere.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EXTENSIONS } from "../src/extensions.ts";
import { NAV, ROWS, SETTINGS } from "../../web/src/nav.ts";
import { HELP_WORDS } from "../src/cli-usage.ts";
import { BundleRefused, checkBundle, NotForThisVersion, RESERVED_IDS } from "../src/modules/bundle.ts";
import { moduleCodeText, parseModuleCode } from "../src/modules/code.ts";
import { loadInstalledModule, type StartState } from "../src/modules/load.ts";
import { satisfies } from "../src/modules/semver.ts";
import { readActive } from "../src/modules/store.ts";
import { APP_VERSION } from "../src/version.ts";
import { scratchDir, setupApp } from "./helpers.ts";

const PASSWORD = "aino-salasana-123";
// a made-up value of the right shape: no real token is ever in a test
const TOKEN = "test_only_not_a_token_0123456789abcdef";
const REPO = "example-owner/example-addon";
const CODE = moduleCodeText({ repo: REPO, token: TOKEN });

let work: string;
let key: string;
let otherKey: string;
let signers: string;
const marks = globalThis as { __addonRan?: number };

function keygen(path: string) {
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "", "-f", path]);
}

beforeAll(() => {
  work = scratchDir("talous-modules-");
  key = join(work, "key");
  otherKey = join(work, "other");
  keygen(key);
  keygen(otherKey);
  const [type, b64] = readFileSync(`${key}.pub`, "utf8").trim().split(" ");
  signers = join(work, "signers");
  writeFileSync(signers, `omatalous-module namespaces="omatalous-module" ${type} ${b64}\n`);
});
afterAll(() => rmSync(work, { recursive: true, force: true }));
afterEach(() => {
  EXTENSIONS.splice(0);
  vi.restoreAllMocks();
});

const SERVER = (id: string) => `
const host = globalThis[Symbol.for("omatalous.host")];
const { Hono } = host.modules.hono;
globalThis.__addonRan = (globalThis.__addonRan ?? 0) + 1;
export default function register(h) {
  h.addExtension({
    id: ${JSON.stringify(id)},
    label: "Esimerkki",
    routes: () => new Hono().get("/hello", (c) => c.json({ hello: c.get("user").username })),
    securityEvents: ["example_event"],
  });
}
`;
const WEB = `export default function register(h) { h.addExtension({ id: "example", page: { label: "Esimerkki", component: () => null } }); }\n`;
const MIGRATION = "-- migrate: compat 0.1.0\nCREATE TABLE example_note (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL);\n";

function manifest(over: Record<string, unknown> = {}) {
  return JSON.stringify({ id: "example", version: "1.2.0", host: `>=0.1.0 <${Number(APP_VERSION.split(".")[0]) + 1}.0.0`, server: "server.mjs", web: "web.mjs", css: "web.css", migrations: "migrations/", ...over });
}

function sign(file: string, with_ = key): Buffer {
  rmSync(`${file}.sig`, { force: true });
  execFileSync("ssh-keygen", ["-q", "-Y", "sign", "-f", with_, "-n", "omatalous-module", file], { stdio: "ignore" });
  return readFileSync(`${file}.sig`);
}

/** A bundle the way a module's release builds it: system tar in ustar form, then signed. */
function realBundle(name: string, over: Record<string, unknown> = {}): { packed: Buffer; signature: Buffer; file: string } {
  const dir = join(work, name);
  mkdirSync(join(dir, "migrations"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), manifest(over));
  writeFileSync(join(dir, "server.mjs"), SERVER("example"));
  writeFileSync(join(dir, "web.mjs"), WEB);
  writeFileSync(join(dir, "web.css"), ".example { color: inherit; }\n");
  writeFileSync(join(dir, "migrations", "9001_example.sql"), MIGRATION);
  const file = join(work, `${name}.tar.gz`);
  execFileSync("tar", ["--format=ustar", "--owner=0", "--group=0", "-czf", file, "-C", dir, "manifest.json", "server.mjs", "web.mjs", "web.css", "migrations"]);
  return { packed: readFileSync(file), signature: sign(file), file };
}

/** A tar written by hand, so an entry tar itself would refuse to write (a `..` path, a link) can be tested. */
function header(name: string, size: number, type: string, link = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write(type, 156);
  h.write(link, 157, 100, "utf8");
  h.write("ustar\0", 257);
  h.write("00", 263);
  h.fill(" ", 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}
function handTar(entries: { name: string; data?: string; type?: string; link?: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    parts.push(header(e.name, e.type === "2" || e.type === "1" ? 0 : data.length, e.type ?? "0", e.link));
    if (e.type !== "2" && e.type !== "1") parts.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
const ID = /^[a-z][a-z0-9-]{1,30}$/;
const BASE = [
  { name: "manifest.json", data: manifest({ css: undefined, migrations: undefined }) },
  { name: "server.mjs", data: SERVER("example") },
  { name: "web.mjs", data: WEB },
];
function signed(packed: Buffer, name: string, with_ = key) {
  const file = join(work, `${name}.tar.gz`);
  writeFileSync(file, packed);
  return { packed, signature: sign(file, with_) };
}

const opts = () => ({ signersFile: signers, appVersion: APP_VERSION, version: "1.2.0" });

/** GitHub's release API as far as the loader reads it, serving these bundles. */
function releaseService(bundles: Record<string, { packed: Buffer; signature: Buffer }>, seen: { url: string; auth: string | null }[] = []): typeof fetch {
  const api = `https://api.github.com/repos/${REPO}`;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    seen.push({ url, auth });
    if (url === `${api}/releases?per_page=30`) {
      const list = Object.keys(bundles).map((v, i) => ({
        draft: false,
        prerelease: false,
        assets: [
          { name: `module-${v}.tar.gz`, url: `${api}/releases/assets/${i * 2 + 1}` },
          { name: `module-${v}.tar.gz.sig`, url: `${api}/releases/assets/${i * 2 + 2}` },
        ],
      }));
      return new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } });
    }
    const asset = /\/releases\/assets\/(\d+)$/.exec(url);
    if (asset) return new Response(null, { status: 302, headers: { location: `https://objects.example.net/blob/${asset[1]}` } });
    const blob = /^https:\/\/objects\.example\.net\/blob\/(\d+)$/.exec(url);
    if (blob) {
      const n = Number(blob[1]);
      const b = Object.values(bundles)[Math.floor((n - 1) / 2)]!;
      return new Response(new Uint8Array(n % 2 ? b.packed : b.signature));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("the code", () => {
  it("reads back what moduleCodeText wrote and refuses everything else in one sentence that repeats none of it", () => {
    expect(parseModuleCode(CODE)).toEqual({ repo: REPO, token: TOKEN });
    for (const bad of ["", "omt1.", `omt2.${CODE.slice(5)}`, `${CODE}!`, moduleCodeText({ repo: "../x", token: TOKEN }), moduleCodeText({ repo: REPO, token: "short" }), `omt1.${Buffer.from(JSON.stringify({ repo: REPO, token: TOKEN, more: 1 })).toString("base64url")}`]) {
      expect(() => parseModuleCode(bad)).toThrow(/^Koodi ei kelpaa/);
    }
  });
});

describe("the host range", () => {
  it("follows the comparators of docs/MODULES.md", () => {
    expect(satisfies("1.0.0", ">=0.9.0 <1.1.0")).toBe(true);
    expect(satisfies("1.0.0-rc.1", "^1.0.0")).toBe(true);
    expect(satisfies("1.1.0", "~1.0.0")).toBe(false);
    expect(satisfies("0.3.4", "^0.3.0")).toBe(true);
    expect(satisfies("0.4.0", "^0.3.0")).toBe(false);
    expect(satisfies("2.0.0", "<1.0.0 || >=2.0.0")).toBe(true);
    expect(satisfies("1.0.0", "latest")).toBe(false);
  });
});

describe("a bundle", () => {
  it("passes when signed by a key of the signers file, made by tar --format=ustar", async () => {
    const b = realBundle("good");
    const checked = await checkBundle(b.packed, b.signature, opts());
    expect(checked.manifest.id).toBe("example");
    expect([...checked.files.keys()].sort()).toEqual(["manifest.json", "migrations/9001_example.sql", "server.mjs", "web.css", "web.mjs"]);
  });

  it("is refused for a signature of another key, a tampered tar, a `..` path, a symlink, a hard link, a stray file and another host range", async () => {
    const good = realBundle("refusals");
    const cases: [string, () => Promise<unknown>, RegExp][] = [
      ["other key", () => checkBundle(good.packed, signed(good.packed, "other", otherKey).signature, opts()), /signature/],
      ["no signature", () => checkBundle(good.packed, Buffer.alloc(0), opts()), /signature/],
      ["tampered", () => checkBundle(Buffer.concat([good.packed.subarray(0, 40), Buffer.from([good.packed[40]! ^ 1]), good.packed.subarray(41)]), good.signature, opts()), /signature/],
      ["dot dot", () => checkBundle(...pair(handTar([...BASE, { name: "../escape.mjs", data: "x" }]), "dotdot"), opts()), /not plain/],
      ["dot dot inside", () => checkBundle(...pair(handTar([...BASE, { name: "assets/../../x.mjs", data: "x" }]), "dotdot2"), opts()), /not plain/],
      ["absolute", () => checkBundle(...pair(handTar([...BASE, { name: "/etc/x.mjs", data: "x" }]), "absolute"), opts()), /not plain/],
      ["symlink", () => checkBundle(...pair(handTar([...BASE, { name: "assets/link.mjs", type: "2", link: "/etc/passwd" }]), "symlink"), opts()), /not a plain file/],
      ["hard link", () => checkBundle(...pair(handTar([...BASE, { name: "assets/hard.mjs", type: "1", link: "server.mjs" }]), "hardlink"), opts()), /not a plain file/],
      ["stray", () => checkBundle(...pair(handTar([...BASE, { name: "run.sh", data: "x" }]), "stray"), opts()), /may not have/],
      ["twice", () => checkBundle(...pair(handTar([...BASE, BASE[1]!]), "twice"), opts()), /twice/],
      ["no signers", () => checkBundle(good.packed, good.signature, { ...opts(), signersFile: null }), /trusts no/],
    ];
    for (const [what, run, why] of cases) {
      const err = await run().then(() => null, (e: unknown) => e);
      expect(err, what).toBeInstanceOf(BundleRefused);
      expect((err as Error).message, what).toMatch(why);
    }
    const old = realBundle("old-host", { host: "<0.0.1" });
    await expect(checkBundle(old.packed, old.signature, opts())).rejects.toBeInstanceOf(NotForThisVersion);
  });

  it("is refused for a migration with no compat floor, a malformed one or one above this version, which would stop the app the first start without the module", async () => {
    const withMigration = (sql: string, name: string) => {
      const entries = [{ name: "manifest.json", data: manifest({ css: undefined }) }, BASE[1]!, BASE[2]!, { name: "migrations/9001_example.sql", data: sql }];
      return pair(handTar(entries), name);
    };
    const table = "CREATE TABLE example_note (id INTEGER PRIMARY KEY);\n";
    const [major, minor, patch] = APP_VERSION.split(/[.-]/).map(Number);
    const cases: [string, string, RegExp][] = [
      ["no floor", table, /no compat floor/],
      ["malformed", `-- migrate: compat soon\n${table}`, /not a version/],
      ["above", `-- migrate: compat ${major}.${minor}.${patch! + 1}\n${table}`, /above this version/],
    ];
    for (const [what, sql, why] of cases) {
      const err = await checkBundle(...withMigration(sql, `floor-${what.replace(" ", "-")}`), opts()).then(() => null, (e: unknown) => e);
      expect(err, what).toBeInstanceOf(BundleRefused);
      expect((err as Error).message, what).toMatch(why);
    }
    const ok = await checkBundle(...withMigration(`-- migrate: compat ${major}.${minor}.${patch}\n${table}`, "floor-ok"), opts());
    expect(ok.files.has("migrations/9001_example.sql")).toBe(true);
  });

  it("is refused for an id the app uses itself, which would shadow a shared route and open it to a service token", async () => {
    for (const id of ["admin", "export", "security", "settings", "setup-code"]) {
      const entries = [{ name: "manifest.json", data: manifest({ id, css: undefined, migrations: undefined }) }, BASE[1]!, BASE[2]!];
      const err = await checkBundle(...pair(handTar(entries), `reserved-${id}`), opts()).then(() => null, (e: unknown) => e);
      expect(err, id).toBeInstanceOf(BundleRefused);
      expect((err as Error).message, id).toMatch(/uses itself/);
    }
  });

  it("reserves every first segment of a shared /api route, every shared page id and every shared CLI command", async () => {
    const { app } = await setupApp();
    const api = new Set(app.routes.map((r) => /^\/api\/([a-z][a-z0-9-]*)(\/|$)/.exec(r.path)?.[1]).filter((s) => s !== undefined));
    expect(api.size).toBeGreaterThan(20);
    const pages = [...NAV, ROWS, SETTINGS].map((p) => p.id);
    const cli = [...readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8").matchAll(/group === "([a-z-]+)"/g)].map((m) => m[1]!);
    expect(cli.length).toBeGreaterThan(5);
    const words = HELP_WORDS.filter((w) => ID.test(w));
    for (const id of [...api, ...pages, ...cli, ...words, "modules"]) expect(RESERVED_IDS.has(id), id).toBe(true);
  });
});

function pair(packed: Buffer, name: string): [Buffer, Buffer] {
  const s = signed(packed, name);
  return [s.packed, s.signature];
}

describe("the code in Asetukset, then a start", () => {
  it("installs the newest fitting release, loads it at the next start with its route, migration and web files, and never shows the code", async () => {
    const root = join(work, "data-1", "modules");
    const logs: string[] = [];
    for (const level of ["log", "error", "warn", "info"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const seen: { url: string; auth: string | null }[] = [];
    const newer = realBundle("newer", { version: "1.3.0", host: "<0.0.1" });
    const fits = realBundle("fits");
    const service = releaseService({ "1.3.0": newer, "1.2.0": fits }, seen);

    // first start: no module
    const first = await setupApp({}, service, { modules: { root, signersFile: signers, start: { state: "none" } } });
    expect((await first.admin.call("GET", "/api/modules")).body).toEqual({ state: "none" });
    const wrong = await first.admin.call("PUT", "/api/modules/code", { code: CODE, password: "väärä" });
    expect(wrong.status).toBe(403);
    expect(existsSync(root)).toBe(false);
    const bad = await first.admin.call("PUT", "/api/modules/code", { code: `${CODE.slice(0, 12)}`, password: PASSWORD });
    expect(bad.status).toBe(400);
    const put = await first.admin.call("PUT", "/api/modules/code", { code: CODE, password: PASSWORD });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ state: "pending", id: "example", version: "1.2.0" });
    expect(readActive(root)).toEqual({ id: "example", version: "1.2.0" });
    expect(marks.__addonRan).toBeUndefined();
    // the token went to the API host only, never to the host the asset came from
    expect(seen.filter((r) => r.auth !== null).every((r) => r.url.startsWith("https://api.github.com/"))).toBe(true);
    expect(seen.some((r) => r.url.startsWith("https://objects.example.net/") && r.auth === null)).toBe(true);
    const member = await first.member("eero");
    expect((await member.call("GET", "/api/modules")).status).toBe(403);
    expect((await member.call("PUT", "/api/modules/code", { code: CODE, password: "eero-uusi-salasana" })).status).toBe(403);

    // the next start loads it before the database opens
    const start = await loadInstalledModule({ root, signersFile: signers, appVersion: APP_VERSION });
    expect(start).toMatchObject({ state: "connected", id: "example", version: "1.2.0", css: true });
    expect(marks.__addonRan).toBe(1);
    expect(EXTENSIONS.map((e) => e.id)).toEqual(["example"]);
    const second = await setupApp({}, service, { modules: { root, signersFile: signers, start } });
    expect((await second.admin.call("GET", "/api/example/hello")).body).toEqual({ hello: "aino" });
    expect((await second.client().call("GET", "/api/example/hello")).status).toBe(401);
    expect(await second.db.all("SELECT name FROM sqlite_master WHERE name = 'example_note'")).toHaveLength(1);
    const web = await second.admin.call("GET", "/modules/example/1.2.0/web.mjs");
    expect(web.status).toBe(200);
    expect(web.res.headers.get("content-type")).toMatch(/javascript/);
    expect((await second.client().call("GET", "/modules/example/1.2.0/web.mjs")).status).toBe(404);
    expect((await second.admin.call("GET", "/modules/example/1.2.0/server.mjs")).status).toBe(404);
    expect((await second.admin.call("GET", "/modules/example/1.2.0/manifest.json")).status).toBe(404);
    // the code was set in another "process": this one has it in its settings too
    await second.s.settings.set("instance_module", (await first.s.settings.get("instance_module"))!);
    expect((await second.admin.call("GET", "/api/modules")).body).toEqual({ state: "connected", id: "example", version: "1.2.0", label: "Esimerkki" });

    // nowhere: responses, events, the export, the logs, the settings row in clear
    const events = await first.admin.call("GET", "/api/security/events");
    expect(events.body.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["module_code_set", "module_installed"]));
    const exported = await first.app.request("http://localhost:8080/api/data/export", { method: "POST", headers: { "X-Requested-With": "fetch", Cookie: first.admin.cookie } });
    const everything = [JSON.stringify(put.body), JSON.stringify(bad.body), JSON.stringify(wrong.body), JSON.stringify(events.body), await exported.text(), logs.join("\n"), (await first.s.settings.get("instance_module"))!];
    for (const text of everything) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(CODE.slice(5, 40));
      expect(text).not.toContain(REPO);
    }

    // removal deletes the files; the running process keeps the module until a restart
    const removed = await first.admin.call("DELETE", "/api/modules/code", { password: PASSWORD });
    expect(removed.body).toEqual({ state: "none" });
    expect(existsSync(root)).toBe(false);
    expect(await loadInstalledModule({ root, signersFile: signers, appVersion: APP_VERSION })).toEqual({ state: "none" });
  });

  it("refuses at start a kept bundle that was changed on disk, and runs nothing of it", async () => {
    const root = join(work, "data-2", "modules");
    const app = await setupApp({}, releaseService({ "1.2.0": realBundle("kept") }), { modules: { root, signersFile: signers, start: { state: "none" } } });
    await app.admin.call("PUT", "/api/modules/code", { code: CODE, password: PASSWORD });
    const kept = join(root, "example", "1.2.0", "bundle.tar.gz");
    const bytes = readFileSync(kept);
    bytes[60] = bytes[60]! ^ 1;
    writeFileSync(kept, bytes);
    const before = marks.__addonRan;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await loadInstalledModule({ root, signersFile: signers, appVersion: APP_VERSION })).toMatchObject({ state: "refused", reason: expect.stringMatching(/signature/) });
    expect(marks.__addonRan).toBe(before);
    expect(EXTENSIONS).toHaveLength(0);
    expect(existsSync(join(root, "example", "1.2.0", "files"))).toBe(false);
  });

  it("waits when no release fits this version, and installs nothing", async () => {
    const root = join(work, "data-3", "modules");
    const app = await setupApp({}, releaseService({ "1.3.0": realBundle("future", { version: "1.3.0", host: "<0.0.1" }) }), { modules: { root, signersFile: signers, start: { state: "none" } } });
    const put = await app.admin.call("PUT", "/api/modules/code", { code: CODE, password: PASSWORD });
    expect(put.body).toEqual({ state: "waiting" });
    expect(readActive(root)).toBeNull();
  });

  it("never goes back to an older signed release while the installed one fits, and does when it waits for another app version", async () => {
    const root = join(work, "data-5", "modules");
    const newer = realBundle("down-newer", { version: "1.3.0" });
    const older = realBundle("down-older");
    const modules = (start: StartState) => ({ modules: { root, signersFile: signers, start } });
    const first = await setupApp({}, releaseService({ "1.3.0": newer, "1.2.0": older }), modules({ state: "none" }));
    await first.admin.call("PUT", "/api/modules/code", { code: CODE, password: PASSWORD });
    expect(readActive(root)).toEqual({ id: "example", version: "1.3.0" });

    // the release list lost 1.3.0 (deleted, or a list of someone else's): the installed one stays, loaded or not yet
    for (const start of [{ state: "none" }, { state: "connected", id: "example", version: "1.3.0", filesDir: root, css: false }] as StartState[]) {
      const later = await setupApp({}, releaseService({ "1.2.0": older }), modules(start));
      await later.admin.call("PUT", "/api/modules/code", { code: CODE, password: PASSWORD });
      expect(readActive(root), start.state).toEqual({ id: "example", version: "1.3.0" });
    }

    // the app was rolled back and 1.3.0 is not for it: the older one that fits is taken
    const rolledBack = await setupApp({}, releaseService({ "1.2.0": older }), modules({ state: "waiting", id: "example", version: "1.3.0" }));
    await rolledBack.admin.call("PUT", "/api/modules/code", { code: CODE, password: PASSWORD });
    expect(readActive(root)).toEqual({ id: "example", version: "1.2.0" });
  });

  it("is refused when the release service signs with another key, with the reason and not the code", async () => {
    const root = join(work, "data-4", "modules");
    const b = realBundle("foreign");
    const app = await setupApp({}, releaseService({ "1.2.0": { packed: b.packed, signature: signed(b.packed, "foreign-other", otherKey).signature } }), { modules: { root, signersFile: signers, start: { state: "none" } } });
    const put = await app.admin.call("PUT", "/api/modules/code", { code: CODE, password: PASSWORD });
    expect(put.body).toEqual({ state: "refused", reason: "signature does not verify" });
    expect(readActive(root)).toBeNull();
  });
});
