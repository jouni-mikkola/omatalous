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
    ["no-payday", "Alin saldo 60 pv: Palkkapäivä ei vielä tiedossa"],
    ["late", "Alin saldo 60 pv: Palkkasi on myöhässä"],
    ["no-balance", "Alin saldo 60 pv: Käyttötilin saldo puuttuu"],
    ["no-card-balance", "Alin saldo 60 pv: Kortin saldo puuttuu"],
    ["history", "Alin saldo 60 pv: Liian lyhyt historia"],
    ["cards", "Alin saldo 60 pv: Lisää kortin tiliote"],
    ["bills", "Alin saldo 60 pv: Laskun summa puuttuu"],
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
  const runway = { known: true, from: "2026-12-01", payday: { date: "2026-12-10", name: "Työnantaja" }, days: 9, balanceCents: 500_000, freeCents: 400_000, everydayCents: 40_000, billedCents: 0, laterCents: 0, leftCents: 360_000, lowCents: 340_000, highCents: 380_000, months: 6 };
  const nowOf = (lowPoint: Low, leftOnPayday: unknown = { known: false, reason: "no-payday" }) => {
    const data = { nyt: { left: { known: false, reason: "no-payday" } }, home: { lowPoint, runway: { leftOnPayday } } } as unknown as DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };
    return render(createElement(Now, { data })).container.querySelector("section.home-now")!;
  };

  it("stands the line under the sum left on the payday, outside its link", () => {
    const section = nowOf(known());
    const line = section.querySelector("p.home-low")!;
    expect(flat(line.textContent)).toBe("Saldo on alimmillaan 13.12., arviolta 300 €");
    expect(line.previousElementSibling?.matches('a[data-tile="left"]')).toBe(true);
    expect(line.closest("a")).toBeNull();
  });

  it("leaves the line out when the lowest balance falls before the payday: it is the sum above it", () => {
    expect(nowOf(known({ date: "2026-12-09" }), runway).querySelector("p.home-low")).toBeNull();
  });

  // core takes the payday's own bills off before the pay lands, so a lowest balance dated the payday is below the figure of that day: two sums for one day
  it("leaves the line out when the lowest balance falls on the payday, also when the payday is today", () => {
    expect(nowOf(known({ date: "2026-12-10" }), runway).querySelector("p.home-low")).toBeNull();
    expect(nowOf(known({ date: "2026-12-10" }), { ...runway, days: 0 }).querySelector("p.home-low")).toBeNull();
  });

  it("keeps the line when the lowest balance falls after the payday", () => {
    expect(nowOf(known({ date: "2026-12-11" }), runway).querySelector("p.home-low")).not.toBeNull();
    expect(nowOf(known({ date: "2027-01-22" }), runway).querySelector("p.home-low")).not.toBeNull();
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

  it("names the section by its question, a heading, and the figure is the link", () => {
    const section = nowOf(known(), runway);
    const heading = section.querySelector("h2")!;
    expect(flat(heading.textContent)).toBe("Jää palkkapäivänä 10.12.");
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(section.querySelector("a[data-tile=left] h2")).toBeNull();
  });
});
