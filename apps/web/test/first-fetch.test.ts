import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirstFetch, fetchLines } from "../src/components/home/FirstFetch.tsx";
import type { Account, Connection } from "../src/types.ts";

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
});
