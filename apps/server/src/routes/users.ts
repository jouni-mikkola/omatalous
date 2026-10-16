/** Household members (admin only). */
import { Hono } from "hono";
import { UserError } from "../platform/errors.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { removeFactorByAdmin } from "../services/second-factor.ts";
import { createUser, deleteUser, resetPassword, type Role } from "../services/users.ts";
import { strictObject } from "../platform/validate.ts";
import { body, optionalString, requestInfo } from "./shared.ts";

const ROLES: Role[] = ["admin", "member"];

export function userRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json({ users: await s.users.list() }));

  /** Returns a temporary password to hand over once; it must be changed at first login. */
  app.post("/", async (c) => {
    const raw = strictObject(await body(c), ["username", "displayName", "role"] as const);
    const role = ROLES.includes(raw.role as Role) ? (raw.role as Role) : "member";
    const { user, temporaryPassword } = await createUser(s, {
      username: optionalString(raw.username, 64) ?? "",
      displayName: optionalString(raw.displayName, 80) ?? "",
      role,
    });
    return c.json({ user, temporaryPassword }, 201);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const raw = strictObject(await body(c), ["displayName", "role"] as const);
    const input = { displayName: optionalString(raw.displayName, 80)?.trim() || undefined, role: optionalString(raw.role) as Role | undefined };
    if (input.role && !ROLES.includes(input.role)) throw new UserError("Tuntematon rooli.");
    if (input.role === "member" && id === c.get("user").id && (await s.users.countAdmins()) <= 1) {
      throw new UserError("Et voi poistaa ylläpito-oikeutta viimeiseltä ylläpitäjältä.");
    }
    await s.users.update(id, input);
    return c.json({ user: await s.users.get(id) });
  });

  app.post("/:id/reset-password", async (c) => c.json({ temporaryPassword: await resetPassword(s, c.req.param("id"), c.get("user"), requestInfo(c, s)) }));

  /** A lost phone: takes a member's second factor away. An admin's own is removed by that admin alone (POST /api/security/factor/remove). */
  app.delete("/:id/factor", async (c) => {
    await removeFactorByAdmin(s, c.get("user"), c.req.param("id"), requestInfo(c, s));
    return c.json({ ok: true });
  });

  app.delete("/:id", async (c) => {
    const removal = await deleteUser(s, c.get("user"), c.req.param("id"), requestInfo(c, s));
    return c.json({ ok: true, ...removal });
  });

  return app;
}
