/** Bank credentials, consents and synchronisation for the signed-in user. */
import { type Context, Hono } from "hono";
import { removeConnection } from "../connectors/enable-banking/connector.ts";
import { removeCredentials, saveCredentials } from "../connectors/enable-banking/credentials.ts";
import { completeConnection, startConnection } from "../connectors/enable-banking/link.ts";
import { psuHeaders } from "../connectors/enable-banking/psu.ts";
import { LinkFailure, returnedWithError } from "../connectors/link-state.ts";
import { openSync } from "../connectors/open-sync.ts";
import type { UserHeaders } from "../connectors/types.ts";
import { syncUser } from "../connectors/sync.ts";
import { clientIp } from "../auth/middleware.ts";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { body, requestInfo } from "./shared.ts";

/** Work that finishes after the response: the Node process keeps it running, a failure is only logged. */
function inBackground(task: Promise<unknown>): void {
  task.catch((err) => console.error("background task failed:", err));
}

/**
 * The member's Psu headers (psu.ts) from this request, for each bank's own list of them; undefined when the request
 * cannot even give the default pair.
 */
function headersOf(s: Services, c: Context<AppEnv>): UserHeaders | undefined {
  const ip = clientIp(c, s);
  const header = (name: string) => c.req.header(name);
  return psuHeaders(ip, header) ? (required) => psuHeaders(ip, header, required) : undefined;
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
    if (error) return back(`error=${(await returnedWithError(s, user.id, state, error)).reason}`);
    if (!code || !state) return back("error=cancelled");
    try {
      const r = await completeConnection(s, s.finance(user.id), code, state);
      inBackground(syncUser(s, user.id, "connect", headersOf(s, c)));
      return back(`connected=${r.accounts}`);
    } catch (err) {
      // a reason of the link itself (LINK_FAILURES); setup: bank keys missing or unreadable, an admin has to look; failed: anything else
      if (err instanceof LinkFailure) return back(`error=${err.reason}`);
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
    // the test of the pair comes back too: a key can be saved while the application is still inactive
    return c.json({ ok: true, result: await saveCredentials(s, c.get("user").id, appId, privateKeyPem, requestInfo(c, s)) });
  });

  app.delete("/bank/credentials", async (c) => {
    await removeCredentials(s, c.get("user").id, requestInfo(c, s));
    return c.json({ ok: true });
  });

  // ── consents ───────────────────────────────────────
  app.post("/connections/start", async (c) => {
    const { bank, returnTo } = strictObject(await body(c), ["bank", "returnTo"] as const);
    return c.json(await startConnection(s, c.get("user").id, bank ?? undefined, returnTo));
  });

  /** Fallback when the browser did not come back by itself: the address the bank sent you to, or only its query. */
  app.post("/connections/complete", async (c) => {
    const { url = "" } = strictObject(await body(c), ["url"] as const);
    const params = pastedParams(typeof url === "string" ? url : "");
    if (!params) throw new UserError("Liitä koko osoite selaimen osoiteriviltä.");
    const code = params.get("code");
    const state = params.get("state");
    const user = c.get("user");
    // the bank's error page: pasting it again would only get the same answer, so the message says what happened
    const error = params.get("error");
    if (error) throw await returnedWithError(s, user.id, state, error);
    if (!code || !state) throw new UserError("Osoite on vajaa. Liitä koko osoite.");
    const r = await completeConnection(s, s.finance(user.id), code, state);
    inBackground(syncUser(s, user.id, "connect", headersOf(s, c)));
    return c.json(r);
  });

  app.delete("/connections/:id", async (c) => {
    await removeConnection(s, s.finance(c.get("user").id), c.req.param("id"));
    return c.json({ ok: true });
  });

  // ── sync ───────────────────────────────────────────
  app.post("/sync", async (c) => c.json(await syncUser(s, c.get("user").id, "manual", headersOf(s, c))));
  // a member opened the app: fetch their own connections if the rows are old, with their address and browser when those can be given
  app.post("/sync/open", async (c) => c.json(await openSync(s, c.get("user").id, headersOf(s, c) ?? null)));
  app.get("/sync/runs", async (c) => c.json({ runs: await s.finance(c.get("user").id).listSyncRuns(20) }));

  return app;
}
