/** Raportit > Yhteiset menot: the member bars and their place in the settlement block. */
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { MemberBars } from "../src/charts/forms/MemberBars.tsx";
import { section } from "../src/pages/reports/sections/Settlement.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import { queryClient } from "../src/query-client.ts";
import { stubApi } from "./dom-kit.ts";
import "./fixed-clock.ts";

afterEach(cleanup);

const plain = (s: string | null) => (s ?? "").replace(/[\s  ]+/g, " ").trim();
const widthOf = (el: Element | null) => (el as HTMLElement).style.getPropertyValue("width");

const MEMBERS = [
  { key: "u1", name: "Aino", paidCents: 30000, shareCents: 20000 },
  { key: "u2", name: "Eero", paidCents: 10000, shareCents: 20000 },
];

describe("Yhteiset menot: the member bars", () => {
  it("draws every bar on one scale, the largest figure full", () => {
    const { container } = render(createElement(MemberBars, { members: MEMBERS, paidLabel: "Maksanut", shareLabel: "Osuus" }));
    const widths = [...container.querySelectorAll(".mbr-member")].map((m) => [...m.querySelectorAll(".mbr-track > span")].map(widthOf));
    expect(widths).toEqual([
      ["100.0%", "66.7%"],
      ["33.3%", "66.7%"],
    ]);
  });

  it("writes what each bar is on its own line, so no colour has to be told apart", () => {
    const { container } = render(createElement(MemberBars, { members: MEMBERS, paidLabel: "Maksanut", shareLabel: "Osuus" }));
    expect(container.querySelector(".mbr-legend")).toBeNull();
    expect(container.querySelector(".mbr-key")).toBeNull();
    const lines = [...container.querySelectorAll(".mbr-member")].map((m) => [...m.querySelectorAll(".mbr-line .mbr-fig")].map((f) => plain(f.textContent)));
    expect(lines).toEqual([
      ["Maksanut 300 €", "Osuus 200 €"],
      ["Maksanut 100 €", "Osuus 200 €"],
    ]);
  });

  it("draws a bar of a negative figure with no width", () => {
    const { container } = render(createElement(MemberBars, { members: [{ key: "u1", name: "Aino", paidCents: -2000, shareCents: 4000 }], paidLabel: "Maksanut", shareLabel: "Osuus" }));
    expect([...container.querySelectorAll(".mbr-track > span")].map(widthOf)).toEqual(["0.0%", "100.0%"]);
  });
});

const empty = { status: { open: true }, unknownPaid: 0, unknownOwed: 0, unknownPaidBy: [], unknownOwedBy: [], unknownHolder: [], netCost: 0, lines: [], agreements: [], incomeMissing: false, fellBack: false };
const pool = (settlement: object) => ({ month: "2026-10", pools: [{ accountId: "acc-1", name: "Yhteistili", names: { u1: "Aino", u2: "Eero" }, removed: [], labels: {}, settlement: { month: "2026-10", ...empty, ...settlement } }] });
const context = { meta: { today: "2026-10-09", accounts: [{ id: "acc-1" }], sharedAccounts: [] }, range: { from: "2026-10-01", to: "2026-10-09" } } as unknown as ReportContext;

beforeEach(() => queryClient.clear());

describe("Yhteiset menot: the bars in the settlement block", () => {
  it("shows a pair of bars a member from the settlement's paid and share", async () => {
    stubApi({
      "GET /api/settlement": pool({
        members: [
          { owner: "u1", paid: 30000, owed: 20000, over: 10000 },
          { owner: "u2", paid: 10000, owed: 20000, over: -10000 },
        ],
      }),
    });
    const { container } = render(createElement(section.Component, { ctx: context }));
    await screen.findByRole("group", { name: "Yhteiset menot: Yhteistili" });
    const bars = container.querySelector(".member-bars")!;
    expect([...bars.querySelectorAll(".mbr-name")].map((n) => n.textContent)).toEqual(["Aino", "Eero"]);
    expect([...bars.querySelectorAll(".mbr-fig")].map((f) => plain(f.textContent))).toEqual(["Maksanut 300 €", "Osuus 200 €", "Maksanut 100 €", "Osuus 200 €"]);
  });

  it("draws no bars where nobody has told the split: the untold sum is all there is", async () => {
    stubApi({
      "GET /api/settlement": pool({
        members: [
          { owner: "u1", paid: 0, owed: 0, over: 0 },
          { owner: "u2", paid: 0, owed: 0, over: 0 },
        ],
        untold: [{ key: "bill", day: 20500, cents: 4000 }],
      }),
    });
    const { container } = render(createElement(section.Component, { ctx: context }));
    await screen.findByRole("group", { name: "Yhteiset menot: Yhteistili" });
    expect(container.querySelector(".member-bars")).toBeNull();
    expect(screen.getByRole("group", { name: "Et ole kertonut jakoa" })).toBeTruthy();
  });
});
