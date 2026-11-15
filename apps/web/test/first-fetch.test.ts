import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirstFetch, fetchLines } from "../src/components/home/FirstFetch.tsx";
import { rowsSoFar } from "../src/first-fetch.ts";
import type { Account, Connection, SyncRun } from "../src/types.ts";

const conn = (id: string, institution = "Nordea", state: Connection["state"] = "active") => ({ id, institution, state }) as Connection;
const acc = (connectionId: string, lastSyncedAt: string | null = null) => ({ connectionId, lastSyncedAt, problem: null }) as unknown as Account;

describe("the front page after a bank is linked", () => {
  it("names each bank that has not answered and what it waits for", () => {
    const meta = { connections: [conn("a"), conn("b", "OP"), conn("c", "S-Pankki")], accounts: [acc("a"), acc("a"), acc("b", "2026-10-08T09:30:00.000Z")] };
    expect(fetchLines(meta)).toEqual([
      { id: "a", bank: "Nordea", text: "2 tiliä odottaa hakua" },
      { id: "c", bank: "S-Pankki", text: "haemme tilejä" },
    ]);
  });

  it("is drawn while a fetch is open and not once every account has an answer", () => {
    const waiting = renderToStaticMarkup(createElement(FirstFetch, { meta: { connections: [conn("a")], accounts: [] } }));
    expect(waiting).toContain("Ensimmäinen haku on kesken");
    expect(waiting).toContain("Nordea: haemme tilejä");
    const done = renderToStaticMarkup(createElement(FirstFetch, { meta: { connections: [conn("a")], accounts: [acc("a", "2026-10-08T09:30:00.000Z")] } }));
    expect(done).toBe("");
  });

  it("says how many rows have come while the fetch runs, and nothing of rows when none runs", () => {
    const run = (status: SyncRun["status"], fetched: number) => ({ status, fetched }) as SyncRun;
    expect(rowsSoFar(run("running", 1234))).toBe(1234);
    expect(rowsSoFar(run("running", 0))).toBe(0);
    expect(rowsSoFar(run("ok", 1234))).toBeNull();
    expect(rowsSoFar(null)).toBeNull();
    const waiting = { connections: [conn("a")], accounts: [acc("a")] };
    const running = renderToStaticMarkup(createElement(FirstFetch, { meta: { ...waiting, lastSync: run("running", 1234) } }));
    expect(running.replace(/\s/g, " ")).toContain("Haetaan tapahtumia… 1 234 haettu");
    for (const lastSync of [run("failed", 12), null]) expect(renderToStaticMarkup(createElement(FirstFetch, { meta: { ...waiting, lastSync } }))).not.toContain("Haetaan tapahtumia");
    // every account has its answer: the card is gone, whatever the run says
    expect(renderToStaticMarkup(createElement(FirstFetch, { meta: { connections: [conn("a")], accounts: [acc("a", "2026-10-08T09:30:00.000Z")], lastSync: run("running", 5) } }))).toBe("");
  });
});
