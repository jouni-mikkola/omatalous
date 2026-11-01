/**
 * The kit of the tests that click and type in a page (`*.dom.test.ts`, run in happy-dom). The server is a table of
 * answers by "METHOD /path": a request nobody listed fails the test, so a page cannot ask for more than the test knows.
 */
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

export interface Seen {
  method: string;
  path: string;
  body: unknown;
}

type Answer = unknown | { status: number; json?: unknown } | ((seen: Seen) => unknown);

/** An answer with a status other than 200. */
export const failing = (status: number, json: unknown) => ({ __status: status, json });

/** Replaces `fetch` with the table; returns the requests seen so far, in order. */
export function stubApi(table: Record<string, Answer>): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
      const url = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      const one: Seen = { method, path: url.pathname, body: init?.body ? JSON.parse(init.body) : undefined };
      seen.push(one);
      const key = `${method} ${url.pathname}`;
      if (!(key in table)) throw new Error(`no answer listed for ${key}`);
      const raw = table[key];
      const answer = typeof raw === "function" ? (raw as (s: Seen) => unknown)(one) : raw;
      const bad = answer as { __status?: number; json?: unknown } | null;
      const status = bad?.__status ?? 200;
      const json = bad?.__status ? bad.json : answer;
      return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return seen;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

/**
 * The real server in the same process, with the demo household loaded, behind `fetch`: a page reads real answers and a
 * click writes to a real database. The cookie jar is the browser's: sign in through the form, or pass `signedIn`.
 */
export async function startServer(opts: { demo?: boolean; signedIn?: boolean; wizard?: boolean; env?: Record<string, string> } = {}) {
  const { setupApp } = await import("../../server/test/helpers.ts");
  const { loadDemoData } = await import("../../server/src/demo.ts");
  const server = await setupApp(opts.env);
  if (opts.demo !== false) await loadDemoData(server.s.finance(server.adminId), server.s.settings, server.s.today());
  // the first-run wizard is its own test; the others open the app as a household that has been through it
  if (opts.wizard !== true) await server.s.instance.completeSetup();
  const seen: Seen[] = [];
  let cookie = opts.signedIn === false ? "" : server.admin.cookie;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      const url = new URL(input, "http://localhost:8080");
      seen.push({ method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(init.body) : undefined });
      const res = await server.app.request(url.href, { ...init, headers: { ...init?.headers, ...(cookie ? { Cookie: cookie } : {}) } });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!.endsWith("=") ? "" : set.split(";")[0]!;
      return res;
    }),
  );
  return { ...server, seen, password: "aino-salasana-123", username: "aino" };
}

/** Opens the signed-in app at a page (`#/transactions?...`) and waits until the page's own heading is up. */
export async function openApp(hash: string, heading?: string | RegExp) {
  const { render, screen } = await import("@testing-library/react");
  const { createElement } = await import("react");
  const { App } = await import("../src/App.tsx");
  const { router } = await import("../src/router.tsx");
  const { queryClient } = await import("../src/query-client.ts");
  queryClient.clear();
  const view = render(createElement(App));
  // the router is made once, when its module loads: it is moved by its history, as a click on a link would
  await screen.findByRole("navigation", { name: "Päävalikko" }, { timeout: 15000 });
  await router.navigate({ href: hash.replace(/^#/, "") });
  if (heading) await screen.findByRole("heading", { name: heading, level: 1 }, { timeout: 15000 });
  return view;
}
