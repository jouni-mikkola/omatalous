/** Raportit > Yhteiset menot: the member bars and their place in the settlement block. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
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
      ["Maksanut 300,00 €", "Osuus 200,00 €"],
      ["Maksanut 100,00 €", "Osuus 200,00 €"],
    ]);
  });

  it("is read as text, with the over line of a member under their name", () => {
    const members = [{ ...MEMBERS[0]!, over: { label: "Maksoi yli osuutensa", cents: 10000 } }, { ...MEMBERS[1]!, over: null }];
    const { container } = render(createElement(MemberBars, { members, paidLabel: "Maksanut", shareLabel: "Osuus" }));
    expect(container.querySelector("[aria-hidden]")).toBeNull();
    expect([...container.querySelectorAll(".mbr-over")].map((o) => plain(o.textContent))).toEqual(["Maksoi yli osuutensa 100,00 €"]);
    expect(container.querySelector(".mbr-member .mbr-over")?.parentElement?.querySelector(".mbr-name")?.textContent).toBe("Aino");
  });

  it("puts the figure of a bar on the line above that bar", () => {
    const css = readFileSync(new URL("../src/styles/member-bars.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.mbr-line\s*\{[^}]*grid-template-columns/);
    expect(css).toMatch(/\.mbr-fig\s*\{[^}]*order: -1;/);
  });

  it("names the payment that settles the month as a tile", async () => {
    stubApi({ "GET /api/settlement": pool({ members: [{ owner: "u1", paid: 30000, owed: 20000, over: 10000 }, { owner: "u2", paid: 10000, owed: 20000, over: -10000 }] }) });
    const { container } = render(createElement(section.Component, { ctx: context }));
    await screen.findByRole("group", { name: "Yhteiset menot: Yhteistili" });
    expect([...container.querySelectorAll(".strip-item")].map((i) => [plain(i.querySelector(".strip-label")!.textContent), plain(i.querySelector(".strip-figure")!.textContent)])).toEqual([["Eero → Aino", "100 €"]]);
  });

  it("draws a bar of a negative figure with no width", () => {
    const { container } = render(createElement(MemberBars, { members: [{ key: "u1", name: "Aino", paidCents: -2000, shareCents: 4000 }], paidLabel: "Maksanut", shareLabel: "Osuus" }));
    expect([...container.querySelectorAll(".mbr-track > span")].map(widthOf)).toEqual(["0.0%", "100.0%"]);
  });
});

const empty = { status: { open: true }, unknownPaid: 0, unknownOwed: 0, unknownPaidBy: [], unknownOwedBy: [], unknownHolder: [], netCost: 0, lines: [], agreements: [], incomeMissing: false, fellBack: false };
const pool = (settlement: object, firstMonth: string | null = "2026-10") => ({ month: "2026-10", pools: [{ accountId: "acc-1", name: "Yhteistili", firstMonth, names: { u1: "Aino", u2: "Eero" }, removed: [], labels: {}, settlement: { month: "2026-10", ...empty, ...settlement } }] });
const context = { meta: { today: "2026-10-09", accounts: [{ id: "acc-1" }], sharedAccounts: [] }, range: { from: "2026-10-01", to: "2026-10-09" } } as unknown as ReportContext;

beforeEach(() => queryClient.clear());

describe("Yhteiset menot: the month menu", () => {
  const months = () => [...screen.getByRole("combobox").querySelectorAll("option")].map((o) => o.value);
  const settled = { members: [{ owner: "u1", paid: 30000, owed: 20000, over: 10000 }, { owner: "u2", paid: 10000, owed: 20000, over: -10000 }] };

  it("reaches back to the month of the pool's first row, however old", async () => {
    stubApi({ "GET /api/settlement": pool(settled, "2024-02") });
    render(createElement(section.Component, { ctx: context }));
    await screen.findByRole("group", { name: "Yhteiset menot: Yhteistili" });
    await waitFor(() => expect(months()).toHaveLength(33));
    expect([months()[0], months()[32]]).toEqual(["2026-10", "2024-02"]);
  });

  it("offers no month before the first row", async () => {
    stubApi({ "GET /api/settlement": pool(settled, "2026-08") });
    render(createElement(section.Component, { ctx: context }));
    await screen.findByRole("group", { name: "Yhteiset menot: Yhteistili" });
    await waitFor(() => expect(months()).toEqual(["2026-10", "2026-09", "2026-08"]));
  });
});

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
    expect([...bars.querySelectorAll(".mbr-fig")].map((f) => plain(f.textContent))).toEqual(["Maksanut 300,00 €", "Osuus 200,00 €", "Maksanut 100,00 €", "Osuus 200,00 €"]);
  });

  it("prints each member's Maksanut and Osuus once, the over line once, and sends the reader nowhere", async () => {
    stubApi({
      "GET /api/settlement": pool({
        members: [
          { owner: "u1", paid: 30000, owed: 20000, over: 10000 },
          { owner: "u2", paid: 10000, owed: 20000, over: -10000 },
        ],
        unknownPaidBy: [{ owner: "x", cents: -684 }],
        untold: [{ key: "bill", day: 20500, cents: 4000 }],
      }),
    });
    const { container } = render(createElement(section.Component, { ctx: context }));
    const group = await screen.findByRole("group", { name: "Yhteiset menot: Yhteistili" });
    const text = plain(group.textContent);
    expect(text.match(/Maksanut 300,00 €/g)).toHaveLength(1);
    expect(text.match(/Maksanut 100,00 €/g)).toHaveLength(1);
    expect(text.match(/Osuus 200,00 €/g)).toHaveLength(2);
    expect(text.match(/Maksoi yli osuutensa 100,00 €/g)).toHaveLength(1);
    expect(text.match(/Maksoi osuuttaan vähemmän 100,00 €/g)).toHaveLength(1);
    expect(text).not.toContain("Kuka on velkaa kenelle");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(text).not.toContain("Kerro, miten tili jakautuu");
    // the answer's blocks keep their names for readers of the page
    expect(screen.getByRole("group", { name: "Et ole kertonut jakoa" })).toBeTruthy();
    expect(screen.getByText("Muiden maksamat")).toBeTruthy();
    expect(screen.queryByText("Ei tiedossa")).toBeNull();
  });

  it("has one row for the money of others, with the open sum and its sources under it", async () => {
    stubApi({
      "GET /api/settlement": pool({
        members: [
          { owner: "u1", paid: 30000, owed: 20000, over: 10000 },
          { owner: "u2", paid: 10000, owed: 20000, over: -15000 },
        ],
        unknownPaidBy: [{ owner: "x", cents: 5000 }],
      }),
    });
    const { container } = render(createElement(section.Component, { ctx: context }));
    await screen.findByRole("group", { name: "Yhteiset menot: Yhteistili" });
    const drill = container.querySelector("details")!;
    const summary = plain(drill.querySelector("summary .st-name")!.textContent);
    expect(summary).toBe("Muiden maksamat");
    expect(plain(drill.querySelector("summary .st-num")!.textContent)).toBe("50,00 €");
    expect(plain(drill.textContent)).toContain("Maksanut: Nimetön maksaja");
    const sources = [...drill.querySelectorAll(":scope > div.st-row .st-name")].map((n) => plain(n.textContent));
    expect(sources).toEqual(["Maksanut: Nimetön maksaja"]);
    expect(sources).not.toContain(summary);
  });

  it("names the open sum by its direction: others still owe it when the members paid more than their shares", async () => {
    stubApi({
      "GET /api/settlement": pool({
        members: [
          { owner: "u1", paid: 30000, owed: 20000, over: 10000 },
          { owner: "u2", paid: 20000, owed: 20000, over: 5000 },
        ],
        unknownOwedBy: [{ owner: "x", cents: 15000 }],
      }),
    });
    const { container } = render(createElement(section.Component, { ctx: context }));
    await screen.findByRole("group", { name: "Yhteiset menot: Yhteistili" });
    const drill = container.querySelector("details")!;
    const summary = plain(drill.querySelector("summary .st-name")!.textContent);
    expect(summary).toBe("Muilta saamatta");
    expect(plain(drill.querySelector("summary .st-num")!.textContent)).toBe("150,00 €");
    expect(plain(drill.textContent)).toContain("Osuus: Nimetön maksaja");
    const sources = [...drill.querySelectorAll(":scope > div.st-row .st-name")].map((n) => plain(n.textContent));
    expect(sources).toEqual(["Osuus: Nimetön maksaja"]);
    expect(sources).not.toContain(summary);
    expect(sources).not.toContain("Muiden maksamat");
  });

  it("folds the corrections to months over a year back and lists the newer ones", async () => {
    const correction = (key: string, cents: number) => ({ kind: "late_change", key, day: 1, cents, paid: [], owed: [] });
    stubApi({
      "GET /api/settlement": pool({
        members: [
          { owner: "u1", paid: 30000, owed: 20000, over: 10000 },
          { owner: "u2", paid: 10000, owed: 20000, over: -10000 },
        ],
        lines: [correction("2026-05", 1200), correction("2025-09", -3400), correction("2025-10", 560)],
      }),
    });
    const { container } = render(createElement(section.Component, { ctx: context }));
    await screen.findByRole("group", { name: "Yhteiset menot: Yhteistili" });
    const folded = [...container.querySelectorAll("details")].find((d) => plain(d.querySelector("summary")!.textContent) === "Korjaukset yli 12 kk:n takaa")!;
    expect(plain(folded.textContent)).toContain("syyskuu 2025");
    expect(plain(folded.textContent)).not.toContain("toukokuu 2026");
    expect(plain(folded.textContent)).not.toContain("lokakuu 2025");
    const shown = [...container.querySelectorAll(".st-chips .badge")].filter((c) => !c.closest("details")).map((c) => plain(c.textContent));
    expect(shown).toEqual(["Korjaus aiempaan kuukauteen: toukokuu 2026 +12,00 €", "Korjaus aiempaan kuukauteen: lokakuu 2025 +5,60 €"]);
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
