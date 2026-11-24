/** The sentence each Raportit page opens with. Made-up figures only. */
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { page as spending } from "../src/pages/reports/pages/Spending.tsx";
import { BalancesLead } from "../src/pages/reports/sections/Balances.tsx";
import { SettlementLead } from "../src/pages/reports/sections/Settlement.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import { queryClient } from "../src/query-client.ts";
import { stubApi } from "./dom-kit.ts";

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const lead = (Lead: (props: { ctx: ReportContext }) => unknown, data: Record<string, unknown>) =>
  flat(renderToStaticMarkup(createElement(Lead as never, { ctx: { data, meta: { today: "2026-11-11", accounts: [], sharedAccounts: [] } } as unknown as ReportContext })).replace(/<[^>]*>/g, ""));

describe("Menot kategorioittain: the lead", () => {
  const categories = (more: Record<string, unknown>) => ({ categories: { totalCents: 250_000, debtPaidCents: 0, creditDrawnCents: 0, ...more } });
  const say = (more: Record<string, unknown>) => lead(spending.Lead, categories(more));

  it("says the spending, adding the debt paid and the credit drawn when there are any", () => {
    expect(say({})).toBe("Menoihin meni 2 500 €.");
    expect(say({ debtPaidCents: 80_000 })).toBe("Menoihin meni 2 500 €, josta velkojen maksuun 800 €.");
    expect(say({ creditDrawnCents: 50_000 })).toBe("Menoihin meni 2 500 €, ja uutta luottoa otettiin 500 €.");
    expect(say({ debtPaidCents: 80_000, creditDrawnCents: 50_000 })).toBe("Menoihin meni 2 500 €, josta velkojen maksuun 800 €, ja uutta luottoa otettiin 500 €.");
  });

  it("says nothing when nothing was spent", () => {
    expect(say({ totalCents: 0 })).toBe("");
  });
});

describe("Varat ja velat: the lead", () => {
  const daily = (last: number) => ({ from: "2026-09-01", cents: [null, 100_000, last] });
  const balances = (more: Record<string, unknown>) => ({ balances: { accounts: [{}], daily: daily(120_000), debt: { cents: null }, change: null, ...more } });
  const say = (more: Record<string, unknown>) => lead(BalancesLead, balances(more));

  it("says the balance of the newest day, how it moved and what is owed", () => {
    expect(say({})).toBe("Tilien ja korttien saldo on 1 200 €.");
    expect(say({ debt: { cents: 30_000 } })).toBe("Tilien ja korttien saldo on 1 200 €, ja velkaa on 300 €.");
    expect(say({ change: { cents: 20_000, from: "2026-09-30" } })).toBe("30.9. jälkeen tilien ja korttien saldo on noussut 200 € ja on nyt 1 200 €.");
    expect(say({ change: { cents: -20_000, from: "2026-09-30" }, debt: { cents: 30_000 } })).toBe("30.9. jälkeen tilien ja korttien saldo on laskenut 200 € ja on nyt 1 200 €. Velkaa on 300 €.");
  });

  it("leaves a move under a euro unsaid, and says nothing without an account or a known day", () => {
    expect(say({ change: { cents: 99, from: "2026-09-30" } })).toBe("Tilien ja korttien saldo on 1 200 €.");
    expect(say({ accounts: [] })).toBe("");
    expect(say({ daily: { from: "2026-09-01", cents: [null, null] } })).toBe("");
  });
});

describe("Yhteiset menot: the lead", () => {
  const pool = (members: { owner: string; over: number }[]) => ({
    accountId: "joint",
    name: "Yhteistili",
    firstMonth: null,
    names: { u1: "Aino", u2: "Eero", u3: "Kaisa" },
    removed: [],
    labels: {},
    settlement: { members, unknownHolder: [], untold: [] },
  });

  async function say(pools: unknown[]) {
    queryClient.clear();
    const seen = stubApi({ "GET /api/settlement": { month: "2026-11", pools } });
    const ctx = { meta: { today: "2026-11-11", accounts: [], sharedAccounts: [] } } as unknown as ReportContext;
    const view = render(createElement(SettlementLead, { ctx }));
    await waitFor(() => expect(seen.length).toBe(1));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await new Promise((done) => setTimeout(done, 0));
    return flat(view.container.textContent);
  }

  it("names the one payment that settles the month", async () => {
    expect(await say([pool([{ owner: "u1", over: -12_000 }, { owner: "u2", over: 12_000 }])])).toBe("Tämän kuun yhteisistä menoista Aino maksaa 120 €, ja Eero saa sen.");
  });

  it("counts the payments when there are several", async () => {
    const text = await say([pool([{ owner: "u1", over: -12_000 }, { owner: "u2", over: 7_000 }, { owner: "u3", over: 5_000 }])]);
    expect(text).toBe("Tämän kuun yhteiset menot tasataan 2 maksulla, yhteensä 120 €.");
  });

  it("says nothing when nobody pays anybody", async () => {
    expect(await say([pool([{ owner: "u1", over: 0 }, { owner: "u2", over: 0 }])])).toBe("");
  });
});
