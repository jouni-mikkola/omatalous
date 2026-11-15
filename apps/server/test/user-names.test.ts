import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db/open.ts";
import { loadConfig } from "../src/platform/config.ts";
import { updateUser } from "../src/services/users.ts";
import { SETUP_CODE, setupApp } from "./helpers.ts";

/** Names nobody can read: a control character or an unseen one, inside a name or alone. */
const BAD = ["\u200B", "\u200B\u200B", "a\u0000\nb", "Ai\u200Bno", "\n", "\u0007", "Aino\u2028", "\u202EAino", "\uFEFF"];
const REFUSED = { status: 400, body: { messageCode: "check.field_bad" } };

/** A server with no user yet, and the call that makes its first admin. */
async function freshApp() {
  const { db } = await openDatabase(":memory:");
  const app = createApp({ db, config: loadConfig({ SETUP_CODE, PASSWORD_MEMORY_KIB: "8", PASSWORD_PASSES: "1", APP_SECRET: "test-secret-that-is-long-enough-0123456789" }) });
  const setup = async (displayName: string) => {
    const res = await app.request("http://localhost:8080/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ code: SETUP_CODE, username: "aino", displayName, password: "aino-salasana-123" }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { app, setup };
}

describe("a member's display name", () => {
  it("refuses an unreadable name for a new member and saves nobody", async () => {
    const { admin, s } = await setupApp();
    for (const name of BAD) {
      const r = await admin.call("POST", "/api/users", { username: "eero", displayName: name });
      expect(r, JSON.stringify(name)).toMatchObject(REFUSED);
    }
    expect(await s.users.count()).toBe(1);
    expect(await s.users.findForLogin("eero")).toBeFalsy();
  });

  it("refuses an unreadable name for the first admin and saves nobody", async () => {
    const { app, setup } = await freshApp();
    for (const name of BAD) expect(await setup(name), JSON.stringify(name)).toMatchObject(REFUSED);
    expect(await app.services.users.count()).toBe(0);
    // the setup code still works after the refusals
    expect(await setup("Aino")).toMatchObject({ status: 200, body: { user: { displayName: "Aino" } } });
  });

  it("refuses an unreadable changed name and keeps the saved one", async () => {
    const { admin, adminId, s } = await setupApp();
    // the route trims before the service: what trim() removes at an end (a line break, U+2028, U+FEFF) never arrives,
    // so the route is asked for the names a trim leaves as they are and the service for all of them
    for (const name of BAD.filter((n) => n.trim() === n)) {
      const r = await admin.call("PATCH", `/api/users/${adminId}`, { displayName: name });
      expect(r, JSON.stringify(name)).toMatchObject(REFUSED);
    }
    const actor = (await s.users.get(adminId))!;
    for (const name of BAD) {
      await expect(updateUser(s, actor, adminId, { displayName: name }, { ip: null, userAgent: null }), JSON.stringify(name)).rejects.toMatchObject({ info: { code: "check.field_bad" } });
    }
    expect((await s.users.get(adminId))!.displayName).toBe("Aino");
    const meta = await admin.call("GET", "/api/meta");
    expect(meta.body.members.map((m: { displayName: string }) => m.displayName)).toEqual(["Aino"]);
  });

  it("does not change the role when the name with it is refused", async () => {
    const { admin, s } = await setupApp();
    const eero = (await admin.call("POST", "/api/users", { username: "eero", displayName: "Eero" })).body.user;
    const r = await admin.call("PATCH", `/api/users/${eero.id}`, { displayName: "E\u200Bero", role: "admin" });
    expect(r).toMatchObject(REFUSED);
    expect(await s.users.get(eero.id)).toMatchObject({ displayName: "Eero", role: "member" });
  });

  it("makes an empty name the user name", async () => {
    const { admin } = await setupApp();
    for (const [username, displayName] of [["eero", ""], ["kaisa", "   "], ["matti", undefined]] as const) {
      const r = await admin.call("POST", "/api/users", { username, displayName });
      expect(r, username).toMatchObject({ status: 201, body: { user: { displayName: username } } });
    }
    const { setup } = await freshApp();
    expect(await setup("")).toMatchObject({ status: 200, body: { user: { displayName: "aino" } } });
  });

  it("saves a readable name trimmed, and a changed one", async () => {
    const { admin, s } = await setupApp();
    const made = await admin.call("POST", "/api/users", { username: "eero", displayName: "  Eero Mäkelä-Öhman 🙂 " });
    expect(made).toMatchObject({ status: 201, body: { user: { displayName: "Eero Mäkelä-Öhman 🙂" } } });
    const id = made.body.user.id as string;
    expect(await admin.call("PATCH", `/api/users/${id}`, { displayName: " Eero M. " })).toMatchObject({ status: 200, body: { user: { displayName: "Eero M." } } });
    // an empty changed name keeps the saved one
    expect(await admin.call("PATCH", `/api/users/${id}`, { displayName: "" })).toMatchObject({ status: 200, body: { user: { displayName: "Eero M." } } });
    expect((await s.users.get(id))!.displayName).toBe("Eero M.");
  });
});
