/**
 * An add-on module's notices (`notices` in extensions.ts) join the app's own in `GET /api/security/notices`, each id
 * under the module's id, for the user who asks. A module that fails adds none and takes nothing away. Made up here.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXTENSIONS, type ServerExtension } from "../src/extensions.ts";
import { setupApp } from "./helpers.ts";

afterEach(() => {
  EXTENSIONS.splice(0);
  vi.restoreAllMocks();
});

const noticeModule = (id: string, notices: ServerExtension["notices"]): ServerExtension => ({ id, routes: () => new Hono(), notices });

type Listed = { id: string; kind: string; text: string; seen?: boolean };
const listed = async (c: { call(m: string, p: string): Promise<{ body: { notices: Listed[] } }> }) => (await c.call("GET", "/api/security/notices")).body.notices;

describe("an add-on module's notices", () => {
  it("are in the notice list of the user they are made for, after the app's own", async () => {
    const { admin, member, adminId } = await setupApp();
    const bob = await member("bob");
    EXTENSIONS.push(
      noticeModule("example", async (_s, user) =>
        user.id === adminId ? [{ id: "renew", kind: "example_renew", at: null, text: "Kirjaudu uudelleen viimeistään 7.12." }] : [],
      ),
    );
    const own = await listed(admin);
    expect(own.at(-1)).toEqual({ id: "example:renew", kind: "example_renew", at: null, text: "Kirjaudu uudelleen viimeistään 7.12." });
    expect(own.filter((n) => n.kind === "example_renew")).toHaveLength(1);
    expect((await listed(bob)).some((n) => n.kind === "example_renew")).toBe(false);
  });

  it("are left out when the module fails, and the app's own notices and another module's stay", async () => {
    const { admin, client } = await setupApp();
    // three failed sign-ins make the app's own notice
    for (let i = 0; i < 3; i++) await client().call("POST", "/api/auth/login", { username: "aino", password: `nope-${i}-password` });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    EXTENSIONS.push(
      noticeModule("broken", async () => {
        throw new Error("boom");
      }),
      noticeModule("example", async () => [{ id: "renew", kind: "example_renew", at: null, text: "Muistutus." }]),
    );
    const res = await admin.call("GET", "/api/security/notices");
    expect(res.status).toBe(200);
    const ids = (res.body.notices as Listed[]).map((n) => n.id);
    expect(ids).toContain("fails");
    expect(ids).toContain("example:renew");
    expect(ids.some((id) => id.startsWith("broken:"))).toBe(false);
    expect(error).toHaveBeenCalledWith("notices of broken failed:", "Error");
  });
});
