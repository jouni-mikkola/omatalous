/**
 * Asetukset > Pankit ja tilit > the cards whose purchases are missing: core's list of bills by card, with the sum, the
 * period and one action each: "Yhdistä" for a card that is not connected, "Lisää tiliote" for one that is.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { LowPoint } from "../src/components/home/LowPoint.tsx";
import { MissingCards } from "../src/pages/settings/MissingCards.tsx";
import { CONNECT_BANK_HASH, SETTINGS_ANCHOR, settingsCardHash } from "../src/routes.ts";
import type { Meta } from "../src/types.ts";
import { stubApi } from "./dom-kit.ts";

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

/** One meta per test: the answer of the dashboard is cached by its address, which holds the day. */
const metaOn = (today: string, accounts = 1) => ({ today, accounts: Array.from({ length: accounts }, (_, i) => ({ id: `a${i}` })) }) as unknown as Meta;

const answer = (cardBills: unknown[]) => ({ "GET /api/dashboard": { questions: { cardBills } } });

const bill = (over: Record<string, unknown>) => ({ issuer: "Esimerkkikortti", label: "Esimerkkikortti", cents: 120_000, count: 4, lastDate: "2026-09-20", reason: "not_connected", since: null, ...over });

describe("MissingCards", () => {
  it("lists each card with its sum and period, and one action: connect, or add a statement", async () => {
    stubApi(
      answer([
        bill({ issuer: "Esimerkkikortti", label: "Esimerkkikortti", cents: 250_000, lastDate: "2026-09-20", reason: "not_connected", since: null }),
        bill({ issuer: "Toinen Kortti", label: "Toinen Kortti", cents: 80_000, lastDate: "2026-09-15", reason: "before_history", since: "2026-09-10" }),
      ]),
    );
    const { container } = render(createElement(MissingCards, { meta: metaOn("2026-10-01") }));
    await screen.findByRole("heading", { name: "Kortit, joiden ostot puuttuvat" });
    const rows = [...container.querySelectorAll("tbody tr")].map((r) => flat(r.textContent));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Esimerkkikortti");
    expect(rows[0]).toContain("2 500");
    expect(rows[0]).toContain("20.9. asti");
    expect(rows[1]).toContain("Toinen Kortti");
    expect(rows[1]).toContain("800");
    expect(rows[1]).toContain("Ennen 10.9.");
    const connect = screen.getByRole("link", { name: "Yhdistä: Esimerkkikortti" });
    expect(connect.getAttribute("href")).toBe(CONNECT_BANK_HASH);
    const statement = screen.getByRole("link", { name: "Lisää tiliote: Toinen Kortti" });
    expect(statement.getAttribute("href")).toBe(settingsCardHash(SETTINGS_ANCHOR.statement));
    // one action a card, and the card itself is what the front page's link names
    expect(within(container).getAllByRole("link")).toHaveLength(2);
    expect(container.querySelector(`#${SETTINGS_ANCHOR.missingCards}`)).not.toBeNull();
  });

  it("gives a connected card whose bills pair with no row the statement too", async () => {
    stubApi(answer([bill({ label: "Kolmas Kortti", issuer: "Kolmas Kortti", reason: "unmatched", since: "2026-03-01" })]));
    render(createElement(MissingCards, { meta: metaOn("2026-10-02") }));
    expect(await screen.findByRole("link", { name: "Lisää tiliote: Kolmas Kortti" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Yhdistä/ })).toBeNull();
  });

  it("draws nothing while no card is missing", async () => {
    const seen = stubApi(answer([]));
    const { container } = render(createElement(MissingCards, { meta: metaOn("2026-10-03") }));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("asks nothing and draws nothing before there is an account", () => {
    const seen = stubApi({});
    const { container } = render(createElement(MissingCards, { meta: metaOn("2026-10-04", 0) }));
    expect(seen).toHaveLength(0);
    expect(container.textContent).toBe("");
  });
});

describe("LowPoint, the reason of the cards", () => {
  it("links the reason to the place a card's statement is added", () => {
    const { container } = render(createElement(LowPoint, { lowPoint: { known: false, reason: "cards", days: 60 } }));
    const link = container.querySelector("a")!;
    expect(flat(link.textContent)).toBe("Lisää kortin tiliote");
    expect(link.getAttribute("href")).toBe(settingsCardHash(SETTINGS_ANCHOR.statement));
  });

  it("links no other reason", () => {
    const { container } = render(createElement(LowPoint, { lowPoint: { known: false, reason: "history", days: 60 } }));
    expect(container.querySelector("a")).toBeNull();
  });
});
