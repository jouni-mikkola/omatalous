/**
 * A temporary password that has stood over a week is a question of Tarkistettavat (services/review.ts
 * `temporaryPasswords`), asked of the admins only and gone when the password is changed or the account removed.
 * Made-up members; the clock moves by days.
 */
import { describe, expect, it } from "vitest";
import { NOW, setupApp } from "./helpers.ts";

const DAY = 86_400_000;
type Item = { id: string; kind: string; cents: number; [field: string]: unknown };
type Caller = { call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }> };
const temporary = async (c: Caller) => ((await c.call("GET", "/api/review")).body.items as Item[]).filter((i) => i.kind === "temporary_password");

async function household() {
  let time = NOW;
  const t = await setupApp({}, undefined, { now: () => time });
  const created = await t.admin.call("POST", "/api/users", { username: "eero", displayName: "Eero" });
  const eeroId = created.body.user.id as string;
  const bob = await t.member("bob");
  return { t, bob, eeroId, after: (days: number) => void (time = new Date(NOW.getTime() + days * DAY)) };
}

describe("the temporary password in Tarkistettavat", () => {
  it("is not asked within a week of the day it was set", async () => {
    const { t, after } = await household();
    after(6);
    expect(await temporary(t.admin)).toEqual([]);
    expect((await t.admin.call("GET", "/api/review/count")).body.count).toBe(0);
  });

  it("is asked of an admin after a week, once for the member, and counts in the page's mark", async () => {
    const { t, eeroId, after } = await household();
    after(8);
    expect(await temporary(t.admin)).toEqual([{ kind: "temporary_password", id: `temporary_password:${eeroId}`, cents: 0, userId: eeroId, name: "Eero" }]);
    expect((await t.admin.call("GET", "/api/review/count")).body.count).toBe(1);
  });

  it("is not asked of a member who is not an admin", async () => {
    const { t, bob, after } = await household();
    after(8);
    expect(await temporary(bob)).toEqual([]);
    expect(await temporary(t.admin)).toHaveLength(1);
  });

  it("counts from the administrator's reset, not from the day the member was added", async () => {
    const { t, eeroId, after } = await household();
    after(20);
    expect(await temporary(t.admin)).toHaveLength(1);
    await t.admin.call("POST", `/api/users/${eeroId}/reset-password`);
    expect(await temporary(t.admin)).toEqual([]);
    after(29);
    expect(await temporary(t.admin)).toHaveLength(1);
  });

  it("goes when the member sets a password of their own or the account is removed", async () => {
    const { t, eeroId, after } = await household();
    const other = await t.admin.call("POST", "/api/users", { username: "kaisa", displayName: "Kaisa" });
    after(8);
    expect((await temporary(t.admin)).map((i) => i.userId).sort()).toEqual([eeroId, other.body.user.id].sort());
    const eero = (await t.s.users.findForLogin("eero"))!;
    await t.s.users.setPassword(eero.id, eero.passwordHash, false);
    expect((await temporary(t.admin)).map((i) => i.userId)).toEqual([other.body.user.id]);
    await t.admin.call("DELETE", `/api/users/${other.body.user.id}`);
    expect(await temporary(t.admin)).toEqual([]);
  });
});
