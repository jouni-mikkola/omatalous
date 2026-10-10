/** Bank credentials, consents and synchronisation for the signed-in user. */
import { Hono } from "hono";
import { AuthStateExpired, completeConnection, removeConnection, saveCredentials, startConnection, syncUser } from "../services/bank.ts";
import { UserError } from "../services/errors.ts";
import { strictObject } from "../services/instance.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { body } from "./shared.ts";

/** Work that finishes after the response: the Node process keeps it running, a failure is only logged. */
function inBackground(task: Promise<unknown>): void {
  task.catch((err) => console.error("background task failed:", err));
}

/**
 * Where the bank redirects the browser after consent. Registered before the
 * login requirement so an expired session gets a friendly redirect instead
 * of a JSON 401; the session cookie (SameSite=Lax) identifies the user.
 */
export function bankCallbackRoute(s: Services) {
  const app = new Hono<AppEnv>();
  app.get("/connections/callback", async (c) => {
    const { code, state, error } = c.req.query();
    // relative, so the user stays on the address they came in through (the session cookie is per host)
    const back = (params: string) => c.redirect(`/#/settings?${params}`);
    // only a short code goes into the address: the page shows its own text for it, so a
    // crafted link (or the bank's error_description) cannot put words into the app
    const user = c.get("user");
    if (!user) return back("error=session");
    if (error || !code || !state) return back("error=cancelled");
    try {
      const r = await completeConnection(s, s.finance(user.id), code, state);
      inBackground(syncUser(s, user.id, "connect"));
      return back(`connected=${r.accounts}`);
    } catch (err) {
      // expired: start again; setup: bank keys missing or unreadable, an admin has to look; failed: anything else
      if (err instanceof AuthStateExpired) return back("error=expired");
      if (err instanceof UserError) return back("error=setup");
      console.error("bank callback failed:", err);
      return back("error=failed");
    }
  });
  return app;
}

/** The query of a pasted address: a full URL, a path with a query, or only the query. */
export function pastedParams(input: string): URLSearchParams | null {
  const text = input.trim().slice(0, 4000);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      return new URL(text).searchParams;
    } catch {
      return null;
    }
  }
  const query = (text.includes("?") ? text.slice(text.indexOf("?") + 1) : text).split("#")[0] ?? "";
  return query.includes("=") ? new URLSearchParams(query) : null;
}

export function bankRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  // ── the user's own Enable Banking application ──────
  app.put("/bank/credentials", async (c) => {
    const { appId, privateKeyPem } = strictObject(await body(c), ["appId", "privateKeyPem"] as const);
    await saveCredentials(s, c.get("user").id, appId, privateKeyPem);
    return c.json({ ok: true });
  });

  app.delete("/bank/credentials", async (c) => {
    await s.users.deleteBankCredentials(c.get("user").id);
    return c.json({ ok: true });
  });

  // ── consents ───────────────────────────────────────
  app.post("/connections/start", async (c) => {
    const { bank, returnTo } = strictObject(await body(c), ["bank", "returnTo"] as const);
    return c.json(await startConnection(s, c.get("user").id, bank ?? undefined, returnTo));
  });

  /** Fallback when the browser did not come back by itself: the address the bank sent you to, or only its query. */
  app.post("/connections/complete", async (c) => {
    const { url = "" } = await body<{ url?: string }>(c);
    const params = pastedParams(typeof url === "string" ? url : "");
    if (!params) throw new UserError("Liitä koko osoite selaimen osoiteriviltä.");
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) throw new UserError("Osoite on vajaa. Liitä koko osoite.");
    const user = c.get("user");
    const r = await completeConnection(s, s.finance(user.id), code, state);
    inBackground(syncUser(s, user.id, "connect"));
    return c.json(r);
  });

  app.delete("/connections/:id", async (c) => {
    await removeConnection(s, s.finance(c.get("user").id), c.req.param("id"));
    return c.json({ ok: true });
  });

  // ── sync ───────────────────────────────────────────
  app.post("/sync", async (c) => c.json(await syncUser(s, c.get("user").id, "manual")));
  app.get("/sync/runs", async (c) => c.json({ runs: await s.finance(c.get("user").id).listSyncRuns(20) }));

  return app;
}
