/**
 * The lowest-balance line of Yhteenveto's Nyt block: core's day and sum, and the reason core gives while there is no
 * figure. The web adds up nothing.
 */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { LowPoint } from "../src/components/home/LowPoint.tsx";
import { Now } from "../src/components/home/Now.tsx";
import { SETTINGS_ANCHOR, settingsCardHash } from "../src/routes.ts";
import type { DashboardData } from "../src/types.ts";

type Low = DashboardData["home"]["lowPoint"];

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const known = (over: Partial<Extract<NonNullable<Low>, { known: true }>> = {}): Low => ({ known: true, date: "2026-12-13", cents: 30_000, lowCents: 12_000, highCents: 48_000, days: 60, line: [], steps: [], startCents: 0, cardDebtCents: 0, spending: [], ...over });
const lineOf = (lowPoint: Low) => flat(render(createElement(LowPoint, { lowPoint })).container.textContent);

describe("LowPoint", () => {
  it("says the day and the sum of the lowest balance, the range stays in the answer", () => {
    expect(lineOf(known())).toBe("Saldo on alimmillaan 13.12., arviolta 300 €");
    expect(lineOf(known({ cents: -30_000, lowCents: -48_000, highCents: -12_000 }))).toBe("Saldo on alimmillaan 13.12., arviolta −300 €");
  });

  it.each([
    ["no-payday", "Alin saldo 60 päivän aikana: Palkkapäivä ei vielä tiedossa"],
    ["late", "Alin saldo 60 päivän aikana: Palkkasi on myöhässä"],
    ["no-balance", "Alin saldo 60 päivän aikana: Käyttötilin saldo puuttuu"],
    ["no-card-balance", "Alin saldo 60 päivän aikana: Kortin saldo puuttuu"],
    ["history", "Alin saldo 60 päivän aikana: Liian lyhyt historia"],
    ["cards", "Alin saldo 60 päivän aikana: Lisää kortin tiliote"],
    ["bills", "Alin saldo 60 päivän aikana: Laskun summa puuttuu"],
  ] as const)("says the reason %s and no figure", (reason, text) => {
    const { container } = render(createElement(LowPoint, { lowPoint: { known: false, reason, days: 60 } }));
    expect(flat(container.textContent)).toBe(text);
    expect(container.querySelector(".home-low-status")?.textContent).not.toMatch(/\d/);
  });

  it.each(["no-balance", "no-card-balance"] as const)("links the reason %s to the state of the fetch, and no other reason", (reason) => {
    const { container } = render(createElement(LowPoint, { lowPoint: { known: false, reason, days: 60 } }));
    expect(container.querySelector(".home-low-status a")?.getAttribute("href")).toBe("#/settings/banks");
  });

  it.each([
    ["cards", "#/review?item=loan-terms", "Lisää kortin tiliote"],
    ["bills", "#/bills", "Laskun summa puuttuu"],
  ] as const)("links the reason %s to where it is mended, in three words at most", (reason, href, text) => {
    const { container } = render(createElement(LowPoint, { lowPoint: { known: false, reason, days: 60 } }));
    const link = container.querySelector(".home-low-status a")!;
    expect(link.getAttribute("href")).toBe(href);
    expect(flat(link.textContent)).toBe(text);
    expect(text.split(" ").length).toBeLessThanOrEqual(3);
  });

  it("links the reason cards to the review while a card row is open there, and to the statement upload once none is", () => {
    const hrefOf = (cardRowOpen: boolean) => render(createElement(LowPoint, { lowPoint: { known: false, reason: "cards", days: 60, cardRowOpen } })).container.querySelector(".home-low-status a")?.getAttribute("href");
    expect(hrefOf(true)).toBe("#/review?item=loan-terms");
    expect(hrefOf(false)).toBe(settingsCardHash(SETTINGS_ANCHOR.statement));
    expect(hrefOf(false)).toMatch(/^#\/settings\/banks/);
  });

  it.each(["no-payday", "late", "history"] as const)("leaves the reason %s as plain text", (reason) => {
    const { container } = render(createElement(LowPoint, { lowPoint: { known: false, reason, days: 60 } }));
    expect(container.querySelector(".home-low-status a")).toBeNull();
  });

  it("shows nothing when core gives nothing", () => {
    expect(render(createElement(LowPoint, { lowPoint: null })).container.textContent).toBe("");
  });
});

describe("Now", () => {
  const runway = { known: true, from: "2026-12-01", payday: { date: "2026-12-10", name: "Työnantaja" }, days: 9, balanceCents: 500_000, freeCents: 400_000, everydayCents: 40_000, billedCents: 0, laterCents: 0, leftCents: 360_000, lowCents: 340_000, highCents: 380_000, months: 6, parts: { balanceCents: 500_000, bills: { cents: -100_000, count: 1 }, cardBills: { cents: 0, count: 0 }, spending: { cents: -40_000, lowCents: -60_000, highCents: -20_000 }, laterCards: { cents: 0, count: 0 } } };
  const nowOf = (lowPoint: Low, leftOnPayday: unknown = { known: false, reason: "no-payday" }) => {
    const data = { nyt: { left: { known: false, reason: "no-payday" } }, home: { lowPoint, runway: { leftOnPayday } } } as unknown as DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };
    return render(createElement(Now, { data })).container.querySelector("section.home-now")!;
  };

  it("stands the line under the sum left on the payday, outside its link", () => {
    const section = nowOf({ known: false, reason: "history", days: 9 });
    const line = section.querySelector("p.home-low")!;
    expect(flat(line.textContent)).toBe("Alin saldo 9 päivän aikana: Liian lyhyt historia");
    expect(line.previousElementSibling?.matches('a[data-tile="left"]')).toBe(true);
    expect(line.closest("a")).toBeNull();
  });

  // the walk ends at the payday, so a known lowest balance is the figure above: on the payday, or on an earlier day that ties
  it("leaves the line out when the lowest balance is known: it is the sum left on the payday", () => {
    expect(nowOf(known({ date: "2026-12-10", cents: 360_000 }), runway).querySelector("p.home-low")).toBeNull();
    expect(nowOf(known({ date: "2026-12-09", cents: 360_000 }), runway).querySelector("p.home-low")).toBeNull();
    // the walk's own estimate of the payday never shows beside the figure, whatever its sum
    expect(nowOf(known({ date: "2026-12-10", cents: 400_000 }), runway).querySelector("p.home-low")).toBeNull();
    expect(nowOf(known({ date: "2026-12-10", cents: 360_000 }), { ...runway, days: 0 }).querySelector("p.home-low")).toBeNull();
  });

  it("does not tell the reason twice: an unknown lowest balance for the reason of the figure's own line has no line", () => {
    const section = nowOf({ known: false, reason: "no-payday", days: 60 });
    expect(flat(section.querySelector(".home-fig-line")?.textContent)).toBe("Palkkapäivä ei vielä tiedossa");
    expect(section.querySelector("p.home-low")).toBeNull();
  });

  it("keeps an unknown lowest balance whose reason is not the figure's", () => {
    expect(nowOf({ known: false, reason: "history", days: 60 }).querySelector("p.home-low")).not.toBeNull();
    expect(nowOf({ known: false, reason: "history", days: 60 }, runway).querySelector("p.home-low")).not.toBeNull();
    // the figure is known and tells no reason, so the line is the one place the reason stands
    expect(nowOf({ known: false, reason: "no-payday", days: 60 }, runway).querySelector("p.home-low")).not.toBeNull();
  });

  it("names the section by its verdict, a heading, which is no part of a link", () => {
    const section = nowOf(known(), runway);
    const heading = section.querySelector("h2")!;
    expect(flat(heading.textContent)).toBe("Riittää palkkapäivään 10.12.");
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(section.querySelector("a h2")).toBeNull();
  });
});
