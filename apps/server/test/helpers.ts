import { type AppDeps, createApp } from "../src/app.ts";
import { loadConfig } from "../src/platform/config.ts";
import { openDatabase } from "../src/db/open.ts";

export const NOW = new Date("2026-10-09T10:00:00Z");
export const SETUP_CODE = "test-setup-code-0001";

export async function waitFor(check: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A browser-like client: keeps the session cookie and sends the CSRF header. */
export interface Client {
  call(method: string, path: string, payload?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any; res: Response }>;
  cookie: string;
}

/** Register lookups are off unless a test turns them on with a fake register, so imports never reach the network. */
export async function setupApp(env: Record<string, string> = {}, fetchMock?: typeof fetch, deps: Partial<AppDeps> = {}) {
  const { db } = await openDatabase(":memory:");
  const config = loadConfig({
    // fast hashing in tests; production uses 600 000 iterations
    PASSWORD_ITERATIONS: "1000",
    APP_SECRET: "test-secret-that-is-long-enough-0123456789",
    SETUP_CODE,
    APP_BASE_URL: "http://localhost:8080",
    INDUSTRY_LOOKUP: "false",
    ...env,
  });
  const app = createApp({ db, config, now: () => NOW, fetch: fetchMock, ...deps });

  const client = (): Client => {
    const c: Client = {
      cookie: "",
      async call(method, path, payload, headers = {}) {
        const res = await app.request(`http://localhost:8080${path}`, {
          method,
          headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(c.cookie ? { Cookie: c.cookie } : {}), ...headers },
          body: payload === undefined ? undefined : JSON.stringify(payload),
        });
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) c.cookie = setCookie.split(";")[0]!.endsWith("=") ? "" : setCookie.split(";")[0]!;
        // response bodies are asserted field by field, so `any` is fine in this helper
        const body: any = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
        return { status: res.status, body, res };
      },
    };
    return c;
  };

  const admin = client();
  const setup = await admin.call("POST", "/api/auth/setup", { code: SETUP_CODE, username: "aino", displayName: "Aino", password: "aino-salasana-123" });
  if (setup.status !== 200) throw new Error(`setup failed: ${JSON.stringify(setup.body)}`);

  /** Adds a household member through the admin API and signs them in with a changed password. */
  async function member(username: string, displayName = username) {
    const created = await admin.call("POST", "/api/users", { username, displayName });
    const m = client();
    await m.call("POST", "/api/auth/login", { username, password: created.body.temporaryPassword });
    await m.call("POST", "/api/auth/password", { current: created.body.temporaryPassword, next: `${username}-uusi-salasana` });
    return Object.assign(m, { id: created.body.user.id as string });
  }

  return { app, db, s: app.services, admin, adminId: setup.body.user.id as string, client, member };
}

/** The signed-in user's checking account as /api/meta lists it (the demo data has one). */
export async function checkingAccount(c: Client): Promise<{ id: string; [field: string]: any }> {
  const account = (await c.call("GET", "/api/meta")).body.accounts.find((a: { type: string }) => a.type === "checking");
  if (!account) throw new Error("no checking account in /api/meta");
  return account;
}
