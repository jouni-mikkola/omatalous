/** Service tokens (services/service-tokens.ts): read-only, a member's rights, an allowlist of routes, hashed, ending, counted. */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { EXTENSIONS } from "../src/extensions.ts";
import type { AppEnv } from "../src/services/context.ts";
import { createServiceToken, serviceMayRead } from "../src/services/service-tokens.ts";
import { NOW, setupApp } from "./helpers.ts";

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function withClock() {
  let now = NOW;
  const t = await setupApp({}, undefined, { now: () => now });
  return { ...t, set: (d: Date) => (now = d) };
}

describe("service tokens", () => {
  it("read as their user with a member's rights, and only read", async () => {
    const { s, client, adminId } = await setupApp();
    const { token } = await createServiceToken(s, { username: "aino", name: "agent" });
    const agent = client();

    const meta = await agent.call("GET", "/api/meta", undefined, bearer(token));
    expect(meta.status).toBe(200);
    const state = await agent.call("GET", "/api/auth/state", undefined, bearer(token));
    expect(state.body.user).toMatchObject({ id: adminId, role: "member" });
    expect((await agent.call("GET", "/api/transactions", undefined, bearer(token))).status).toBe(200);

    // the admin's own routes, the log, the exports and every write stay shut
    for (const path of ["/api/admin/instance", "/api/users", "/api/security/events", "/api/security/sessions", "/api/export/transactions.csv", "/api/ops/state"]) {
      expect((await agent.call("GET", path, undefined, bearer(token))).status, path).toBe(403);
    }
    expect((await agent.call("POST", "/api/demo", undefined, bearer(token))).status).toBe(403);
    expect((await agent.call("PUT", "/api/admin/features", { optimise: false }, bearer(token))).status).toBe(403);
    expect((await agent.call("POST", "/api/auth/logout", undefined, bearer(token))).status).toBe(403);
  });

  it("is answered by the token alone: an admin's cookie beside it gives no more", async () => {
    const { s, admin } = await setupApp();
    const { token } = await createServiceToken(s, { username: "aino", name: "agent" });
    expect((await admin.call("GET", "/api/admin/instance")).status).toBe(200);
    expect((await admin.call("GET", "/api/admin/instance", undefined, bearer(token))).status).toBe(403);
    expect((await admin.call("GET", "/api/admin/instance", undefined, bearer("omt_wrong"))).status).toBe(401);
  });

  it("stores only the hash, and the user is told", async () => {
    const { s, db, adminId } = await setupApp();
    const made = await createServiceToken(s, { username: "aino", name: "agent", days: "7" });
    expect(made.token).toMatch(/^omt_[A-Za-z0-9_-]{43}$/);
    expect(made.expiresAt).toBe(new Date(NOW.getTime() + 7 * 86_400_000).toISOString());
    const rows = await db.all<Record<string, unknown>>("SELECT * FROM service_tokens");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(made.token.slice(4));
    const events = await s.security.list({ userId: adminId, kind: "service_token_made", limit: 5 });
    expect(events[0]?.detail).toContain("agent");
  });

  it("refuses a bad name, days out of range and an unknown user", async () => {
    const { s } = await setupApp();
    await expect(createServiceToken(s, { username: "aino", name: "" })).rejects.toThrow(/name/);
    await expect(createServiceToken(s, { username: "aino", name: "a;rm" })).rejects.toThrow(/name/);
    await expect(createServiceToken(s, { username: "aino", name: "agent", days: "91" })).rejects.toThrow(/days/);
    await expect(createServiceToken(s, { username: "aino", name: "agent", days: "0" })).rejects.toThrow(/days/);
    await expect(createServiceToken(s, { username: "nobody", name: "agent" })).rejects.toThrow(/not found/);
  });

  it("ends at its time and is removed then", async () => {
    const { s, client, db, set } = await withClock();
    const { token } = await createServiceToken(s, { username: "aino", name: "agent", days: "1" });
    const agent = client();
    expect((await agent.call("GET", "/api/meta", undefined, bearer(token))).status).toBe(200);
    set(new Date(NOW.getTime() + 86_400_000 + 1000));
    expect((await agent.call("GET", "/api/meta", undefined, bearer(token))).status).toBe(401);
    expect(await db.all("SELECT id FROM service_tokens")).toHaveLength(0);
  });

  it("writes its use down once an hour", async () => {
    const { s, client, adminId, set, db } = await withClock();
    const { token } = await createServiceToken(s, { username: "aino", name: "agent" });
    const agent = client();
    for (let i = 0; i < 3; i++) await agent.call("GET", "/api/meta", undefined, bearer(token));
    const used = () => s.security.list({ userId: adminId, kind: "service_token_used", limit: 10 });
    expect(await used()).toHaveLength(1);
    set(new Date(NOW.getTime() + 61 * 60_000));
    await agent.call("GET", "/api/meta", undefined, bearer(token));
    expect(await used()).toHaveLength(2);
    expect((await db.first<{ last_used_at: string }>("SELECT last_used_at FROM service_tokens"))?.last_used_at).toBe(new Date(NOW.getTime() + 61 * 60_000).toISOString());
  });

  it("stops answering an address after 20 wrong tokens, before any lookup", async () => {
    const { s, client } = await setupApp();
    const { token } = await createServiceToken(s, { username: "aino", name: "agent" });
    const agent = client();
    for (let i = 0; i < 20; i++) expect((await agent.call("GET", "/api/meta", undefined, bearer(`omt_${"x".repeat(43)}`))).status).toBe(401);
    expect((await agent.call("GET", "/api/meta", undefined, bearer(token))).status).toBe(429);
    expect(await s.security.list({ kind: "service_token_refused", limit: 5 })).toHaveLength(1);
  });

  it("an admin lists and removes them; a member does not see them", async () => {
    const { s, admin, client, member } = await setupApp();
    const made = await createServiceToken(s, { username: "aino", name: "agent" });
    const listed = await admin.call("GET", "/api/admin/service-tokens");
    expect(listed.body.tokens).toEqual([expect.objectContaining({ id: made.id, username: "aino", name: "agent", lastUsedAt: null })]);
    expect(JSON.stringify(listed.body)).not.toContain(made.token.slice(4));
    const bob = await member("bob");
    expect((await bob.call("GET", "/api/admin/service-tokens")).status).toBe(403);
    expect((await admin.call("DELETE", `/api/admin/service-tokens/${made.id}`)).status).toBe(200);
    expect((await client().call("GET", "/api/meta", undefined, bearer(made.token))).status).toBe(401);
    expect((await admin.call("DELETE", `/api/admin/service-tokens/${made.id}`)).status).toBe(400);
  });

  it("goes with its user", async () => {
    const { s, admin, member, client } = await setupApp();
    const bob = await member("bob");
    const { token } = await createServiceToken(s, { username: "bob", name: "agent" });
    expect((await client().call("GET", "/api/meta", undefined, bearer(token))).status).toBe(200);
    expect((await admin.call("DELETE", `/api/users/${bob.id}`)).status).toBe(200);
    expect((await client().call("GET", "/api/meta", undefined, bearer(token))).status).toBe(401);
  });

  it("is made, listed and removed on the command line", async () => {
    const { s, client } = await setupApp();
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runCli(s, ["service-token", "create", "aino", "--name", "claude", "--days", "14"])).toBe(0);
      const token = out.find((l) => l.startsWith("omt_"))!;
      expect((await client().call("GET", "/api/meta", undefined, bearer(token))).status).toBe(200);
      const id = /Service token (\S+) for aino/.exec(out[0]!)![1]!;
      out.length = 0;
      expect(await runCli(s, ["service-token", "list"])).toBe(0);
      expect(out.join("\n")).toContain(id);
      expect(out.join("\n")).not.toContain(token);
      expect(await runCli(s, ["service-token", "revoke", id])).toBe(0);
      expect(await runCli(s, ["service-token", "revoke", id])).toBe(1);
      expect(await runCli(s, ["service-token", "create", "aino"])).toBe(1);
      expect(await runCli(s, ["service-token", "revoke", "--all"])).toBe(0);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });

  it("names its routes: reads of the data pages only", () => {
    expect(serviceMayRead("GET", "/api/dashboard")).toBe(true);
    expect(serviceMayRead("HEAD", "/api/meta")).toBe(true);
    expect(serviceMayRead("GET", "/api/accounts/a1/sources")).toBe(true);
    expect(serviceMayRead("GET", "/api/connections/callback")).toBe(false);
    expect(serviceMayRead("GET", "/api/security/notices")).toBe(false);
    expect(serviceMayRead("GET", "/api/meta/../admin/instance")).toBe(false);
    expect(serviceMayRead("GET", "/api/data/export")).toBe(false);
  });

  it("reads an extension's GETs only when it says they only read", () => {
    // not a declared flag, as in extension-demo.test.ts
    const reads = { id: "koe" as never, feature: { label: "Esimerkki", stage: "dev", default: false }, routes: () => new Hono<AppEnv>() } as const;
    try {
      EXTENSIONS.push(reads);
      expect(serviceMayRead("GET", "/api/koe/search")).toBe(false);
      EXTENSIONS.splice(0, EXTENSIONS.length, { ...reads, tokenReads: true });
      expect(serviceMayRead("GET", "/api/koe")).toBe(true);
      expect(serviceMayRead("GET", "/api/koe/search")).toBe(true);
      expect(serviceMayRead("HEAD", "/api/koe/a/b")).toBe(true);
      expect(serviceMayRead("POST", "/api/koe/fetch")).toBe(false);
      expect(serviceMayRead("GET", "/api/koetus")).toBe(false);
      expect(serviceMayRead("GET", "/api/koe/../admin/instance")).toBe(false);
      expect(serviceMayRead("GET", "/api/koe//x")).toBe(false);
    } finally {
      EXTENSIONS.splice(0);
    }
  });
});
