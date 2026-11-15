import { describe, expect, it } from "vitest";
import { NOW, setupApp } from "./helpers.ts";

const DAY = 86_400_000;

/** The member list as the administrator reads it, `days` after the clock's start. */
async function membersAfter(days: number, change: (t: Awaited<ReturnType<typeof setupApp>>, id: string) => Promise<void> = async () => {}) {
  let time = NOW;
  const t = await setupApp({}, undefined, { now: () => time });
  const created = await t.admin.call("POST", "/api/users", { username: "eero", displayName: "Eero" });
  time = new Date(NOW.getTime() + days * DAY);
  await change(t, created.body.user.id);
  const list = (await t.admin.call("GET", "/api/users")).body.users as { username: string; mustChangePassword: boolean; temporaryLong: boolean }[];
  return Object.fromEntries(list.map((u) => [u.username, u]));
}

describe("GET /api/users temporaryLong", () => {
  it("is false for a temporary password set within a week and true after it", async () => {
    expect((await membersAfter(6)).eero).toMatchObject({ mustChangePassword: true, temporaryLong: false });
    expect((await membersAfter(8)).eero).toMatchObject({ mustChangePassword: true, temporaryLong: true });
  });

  it("counts from the administrator's reset, not from the day the member was added", async () => {
    const reset = await membersAfter(20, async (t, id) => {
      await t.admin.call("POST", `/api/users/${id}/reset-password`);
    });
    expect(reset.eero).toMatchObject({ mustChangePassword: true, temporaryLong: false });
  });

  it("is false for a member with a password of their own", async () => {
    const own = await membersAfter(30, async (t) => {
      const eero = (await t.s.users.findForLogin("eero"))!;
      await t.s.users.setPassword(eero.id, eero.passwordHash, false);
    });
    expect(own.eero).toMatchObject({ mustChangePassword: false, temporaryLong: false });
    expect(own.aino).toMatchObject({ temporaryLong: false });
  });
});
