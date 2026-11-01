import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { AGE_RECIPIENT, isSshKey, newAgeKey, newSshKey, sshPublicLine } from "../src/security/offsite-keys.ts";
import { SecretBox } from "../src/security/secretbox.ts";
import { KEY, queueOffsiteDaily } from "../src/services/offsite.ts";
import { resealAll } from "../src/services/secret-rotation.ts";
import { scratchDir, setupApp } from "./helpers.ts";

type Services = Awaited<ReturnType<typeof setupApp>>["s"];
const PASSWORD = "aino-salasana-123";
const TARGET = { host: "nas.example.com", port: 2222, user: "omatalous", dir: "backups/omatalous" };

/** Runs the ops CLI the way the helper does and returns the one JSON line it prints. */
async function cli(s: Services, args: string[], stdin = "") {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(m));
  try {
    expect(await runCli(s, ["ops", ...args], { readStdin: async () => stdin })).toBe(0);
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(lines[0]!);
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function world(helper = "6") {
  const dir = scratchDir("talous-offsite-");
  dirs.push(dir);
  mkdirSync(join(dir, "backups"));
  const app = await setupApp({}, undefined, { backupDir: join(dir, "backups") });
  await cli(app.s, ["state", "--helper", helper], "{}");
  const keys = () => app.admin.call("POST", "/api/admin/offsite/keys", { password: PASSWORD });
  const save = (body: Record<string, unknown>) => app.admin.call("PUT", "/api/admin/offsite", { password: PASSWORD, ...TARGET, ...body });
  return { ...app, dir, file: join(dir, "ops", "offsite-request.json"), keys, save };
}

describe("offsite keys", () => {
  it("makes an age pair that has the shapes age reads, and an ssh key openssh reads", () => {
    const a = newAgeKey();
    expect(a.recipient).toMatch(AGE_RECIPIENT);
    expect(a.secret).toMatch(/^AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}$/);
    const pem = newSshKey();
    expect(isSshKey(pem)).toBe(true);
    expect(sshPublicLine(pem)).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}$/);
    expect(isSshKey("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n")).toBe(false);
  });
});

describe("the copy to another machine", () => {
  it("refuses a target before there are keys and a wrong password at any time", async () => {
    const w = await world();
    expect((await w.save({ enabled: false })).status).toBe(400);
    expect((await w.admin.call("POST", "/api/admin/offsite/keys", { password: "väärä" })).status).toBe(403);
    expect(await w.s.settings.get(KEY)).toBeNull();
  });

  it("hands the age secret over once, and stores neither it nor the ssh key in the clear", async () => {
    const w = await world();
    const made = (await w.keys()).body;
    expect(made.ageSecret).toMatch(/^AGE-SECRET-KEY-1/);
    expect(made.recipient).toMatch(AGE_RECIPIENT);
    expect(made.enabled).toBe(false);
    const stored = (await w.s.settings.get(KEY))!;
    expect(stored).not.toContain(made.ageSecret);
    expect(stored).not.toContain("PRIVATE KEY");
    expect(stored).not.toContain(made.recipient);
    const again = JSON.stringify((await w.admin.call("GET", "/api/admin/offsite")).body);
    expect(again).not.toContain(made.ageSecret);
    expect(again).not.toContain("PRIVATE KEY");
    expect(again).toContain(made.sshPublic);
  });

  it("checks every value of the target and wants the key confirmed before it turns on", async () => {
    const w = await world();
    await w.keys();
    for (const bad of [{ host: "a b" }, { host: "-x.example" }, { host: "nas;rm" }, { port: 0 }, { port: "22" }, { user: "-x" }, { user: "a b" }, { dir: "../x" }, { dir: "a/../b" }, { dir: "-x" }, { dir: "a b" }, { dir: "a;b" }, { recipient: "age1short" }]) {
      expect((await w.save({ enabled: false, ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await w.save({ enabled: true })).status).toBe(400);
    const ok = await w.save({ enabled: true, keyConfirmed: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ enabled: true, configured: true, host: TARGET.host, port: 2222 });
    const events = JSON.stringify(await w.s.security.list({ kind: "offsite_changed", limit: 10 }));
    expect(events).not.toContain("PRIVATE");
  });

  it("queues a copy for the password, prepares the file, hands it to a helper of version 6 only, and removes it when the helper reports", async () => {
    const w = await world();
    const made = (await w.keys()).body;
    await w.save({ enabled: true, keyConfirmed: true });
    expect((await w.admin.call("POST", "/api/ops/request", { action: "offsite" })).status).toBe(400);
    expect((await w.admin.call("POST", "/api/admin/offsite/run", { password: "väärä" })).status).toBe(403);
    expect(existsSync(w.file)).toBe(false);
    const run = await w.admin.call("POST", "/api/admin/offsite/run", { password: PASSWORD });
    expect(run.status).toBe(200);
    const id = run.body.id;
    expect(existsSync(w.file)).toBe(true);
    expect(await cli(w.s, ["offsite", "--helper", "5"])).toEqual({ host: null });
    const line = await cli(w.s, ["offsite", "--helper", "6"]);
    expect(Object.keys(line)).toEqual(["host", "port", "user", "dir", "recipient", "key"]);
    expect(line).toMatchObject({ ...TARGET, recipient: made.recipient });
    expect(Buffer.from(line.key, "base64").toString()).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(await cli(w.s, ["poll", "--helper", "6", "--done", ""])).toMatchObject({ request: { id, action: "offsite" } });
    const pem = Buffer.from(line.key, "base64").toString();
    await cli(w.s, ["report", "--helper", "6"], JSON.stringify({ id, status: "ok", exit_code: 0, summary: "Salattu kopio vietiin.", output: `ssh said\n${pem}\n${line.key}` }));
    expect(existsSync(w.file)).toBe(false);
    const row = JSON.stringify(await w.s.ops.get(id));
    expect(row).not.toContain("PRIVATE KEY");
    expect(row).not.toContain(line.key);
    const view = (await w.admin.call("GET", "/api/admin/offsite")).body;
    expect(view.last).toMatchObject({ ok: true, summary: "Salattu kopio vietiin." });
    expect(view.stale).toBe(false);
  });

  it("is refused for a helper that is too old, and leaves no file", async () => {
    const w = await world("5");
    await w.keys();
    await w.save({ enabled: true, keyConfirmed: true });
    expect((await w.admin.call("POST", "/api/admin/offsite/run", { password: PASSWORD })).status).toBe(409);
    expect(existsSync(w.file)).toBe(false);
  });

  it("queues the nightly copy once a day, only while it is on", async () => {
    const w = await world();
    await w.keys();
    await w.save({ enabled: false });
    await queueOffsiteDaily(w.s, "2026-10-30");
    expect(existsSync(w.file)).toBe(false);
    await w.save({ enabled: true, keyConfirmed: true });
    await queueOffsiteDaily(w.s, "2026-10-30");
    expect(existsSync(w.file)).toBe(true);
    const queued = (await w.s.ops.recent(10)).filter((r) => r.action === "offsite");
    expect(queued).toHaveLength(1);
    await queueOffsiteDaily(w.s, "2026-10-30");
    expect((await w.s.ops.recent(10)).filter((r) => r.action === "offsite")).toHaveLength(1);
  });

  it("is re-sealed with the app secret, under its own context", async () => {
    const w = await world();
    await w.keys();
    await w.save({ enabled: false });
    const before = JSON.parse((await w.s.settings.get(KEY))!).keyEnc as string;
    const old = w.s.config.appSecret!;
    const next = "another-app-secret-with-enough-length-0123456789";
    await resealAll(w.s, old, next);
    const after = JSON.parse((await w.s.settings.get(KEY))!).keyEnc as string;
    expect(after).not.toBe(before);
    const box = await SecretBox.fromSecret(next);
    expect(JSON.parse(await box.open(after, "instance:offsite"))).toMatchObject({ host: TARGET.host });
    await expect(box.open(after, "instance:notices")).rejects.toThrow();
  });

  it("removing the target removes the keys and the file", async () => {
    const w = await world();
    await w.keys();
    await w.save({ enabled: true, keyConfirmed: true });
    const gone = await w.admin.call("DELETE", "/api/admin/offsite", { password: PASSWORD });
    expect(gone.status).toBe(200);
    expect(await w.s.settings.get(KEY)).toBeNull();
    expect(gone.body).toMatchObject({ hasKeys: false, enabled: false });
  });
});
