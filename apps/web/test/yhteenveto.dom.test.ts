/** Yhteenveto's sum left to the payday. */
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Now } from "../src/components/home/Now.tsx";
import type { DashboardData } from "../src/types.ts";

type NytData = NonNullable<DashboardData["nyt"]>;
type Data = DashboardData & { nyt: NytData };

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");

function nytOf(known: boolean, billsCents = 189954, elsewhereCents = 0, paydayCents = 0): NytData {
  return {
    from: "2026-11-11",
    left: known
      ? { known: true, payday: { date: "2026-11-25", name: "Työnantaja" }, days: 14, balanceCents: 500000, billsCents, cardDebtCents: 0, leftCents: 500000 - billsCents, perDayCents: Math.round((500000 - billsCents) / 14), elsewhereCents, paydayCents }
      : { known: false, reason: "no-payday", found: 1 },
    usualPerDayCents: null,
    pace: { day: 11, spentCents: 123400, usual: null },
  };
}

function data(more: Partial<DashboardData> = {}): Data {
  // only the parts the block reads; the rest of the answer is not drawn here
  const rest = {
    home: { paceGap: null, pace: null, lowPoint: null, runway: { leftOnPayday: { known: false, reason: "history" } } },
  } as unknown as DashboardData;
  return { ...rest, ...more, nyt: nytOf(true) };
}

describe("Yhteenveto's sum left to the payday", () => {
  const left = (d: Data) => {
    const { container } = render(createElement(Now, { data: d }));
    return container.querySelector<HTMLElement>("[data-tile=left]")!;
  };
  /** The question of the section the figure answers: its heading, named by the section. */
  const questionOf = (figure: HTMLElement) => figure.closest("section")!.querySelector("h2")?.textContent;

  it("is the one link to the table of Laskut, with the sum a day and the payday", () => {
    const el = left(data());
    expect(el.getAttribute("href")).toBe("#/bills#laskut-taulukko");
    expect(questionOf(el)).toBe("Käytettävissä palkkapäivään");
    expect(flat(el.querySelector(".fig")?.textContent)).toBe("3 100 €");
    expect(flat(el.querySelector(".home-fig-line")?.textContent)).toBe("221 € päivässä, palkkapäivä 25.11.");
  });

  describe("with the everyday spending expected", () => {
    type Runway = Extract<NonNullable<DashboardData["home"]["runway"]>["leftOnPayday"], { known: true }>;
    const runway = (over: Partial<Runway> = {}): Runway => ({ known: true, from: "2026-11-11", payday: { date: "2026-11-25", name: "Työnantaja" }, days: 14, balanceCents: 500000, freeCents: 310046, everydayCents: 38900, billedCents: 0, laterCents: 0, leftCents: 271146, lowCents: 250000, highCents: 290000, months: 6, parts: { balanceCents: 500000, bills: { cents: -189954, count: 1 }, cardBills: { cents: 0, count: 0 }, spending: { cents: -38900, lowCents: -45000, highCents: -30000 }, laterCards: { cents: 0, count: 0 } }, ...over });
    const withRunway = (r: Runway, nyt: NytData = nytOf(true)) => left({ ...data(), nyt, home: { ...data().home, runway: { leftOnPayday: r } } as never });

    it("is the sum left on the payday after the everyday spending, with a verdict that names the payday and no sum a day", () => {
      const el = withRunway(runway());
      expect(questionOf(el)).toBe("Riittää palkkapäivään 25.11.");
      expect(flat(el.querySelector(".fig")?.textContent)).toBe("2 711 €");
      expect(el.closest("section")!.querySelector(".home-fig-line")).toBeNull();
      expect(el.closest("section")!.classList.contains("home-short")).toBe(false);
    });

    /** The card with the panel of its figure opened. */
    const ledgerOf = (r: Runway) => {
      const d = data();
      const container = render(createElement(Now, { data: { ...d, nyt: nytOf(true), home: { ...d.home, runway: { leftOnPayday: r } } } as never })).container;
      expect(container.querySelector(".home-rows"), "the parts stay in the panel until it is opened").toBeNull();
      fireEvent.click(container.querySelector(".fig-open")!);
      return {
        container,
        figure: flat(container.querySelector("[data-tile=left] .fig")?.textContent),
        rows: [...container.querySelectorAll(".home-rows > div")].map((row) => [row.getAttribute("data-row"), flat(row.querySelector("dd")?.textContent)]),
      };
    };
    /** "−1 500,00 €" as cents, for the check that the rows reconcile with the figure. */
    const centsOf = (text: string) => Math.round(Number(text.replace(/[^\d,−-]/g, "").replace("−", "-").replace(",", ".")) * 100);

    it("links the bills row to the table of Laskut", () => {
      const link = ledgerOf(runway()).container.querySelector<HTMLElement>("[data-row=bills] a")!;
      expect(link.getAttribute("href")).toBe("#/bills#laskut-taulukko");
    });

    it("tells the parts to the cent as rows in the panel, a card row only when a card bill is there, and they add up to the figure", () => {
      // 5 000 on the accounts less 1 500 of bills, 320,50 of card bills and 389,50 of expected spending is 2 790 left
      const parts = { balanceCents: 500000, bills: { cents: -150000, count: 3 }, cardBills: { cents: -32050, count: 2 }, spending: { cents: -38950, lowCents: -45000, highCents: -30000 }, laterCards: { cents: 0, count: 0 } };
      const { figure, rows, container } = ledgerOf(runway({ leftCents: 279000, parts }));
      expect(rows).toEqual([["balance", "5 000,00 €"], ["bills", "−1 500,00 €"], ["cards", "−320,50 €"], ["spending", "−389,50 €"], ["left", "2 790 €"]]);
      expect(rows.slice(0, 4).reduce((sum, [, shown]) => sum + centsOf(shown!), 0)).toBe(279000);
      expect(figure).toBe("2 790 €");
      expect(container.querySelector("details")).toBeNull();
      // a card row has none without a card bill; the bills row tells how many
      expect(flat(container.querySelector("[data-row=bills] dt")?.textContent)).toBe("Muut laskut ennen palkkapäivää 3 laskua");
      expect(flat(container.querySelector("[data-row=cards] dt")?.textContent)).toBe("Korttilaskut ennen palkkapäivää 2 laskua");
      const plain = ledgerOf(runway());
      expect(plain.rows.map((r) => r[0])).toEqual(["balance", "bills", "spending", "left"]);
      expect(flat(plain.container.querySelector("[data-row=bills] dt")?.textContent)).toBe("Laskut ennen palkkapäivää 1 lasku");
      // no bills is no count: "0 laskua" would stand alone on its line
      const none = { ...parts, bills: { cents: 0, count: 0 } };
      expect(flat(ledgerOf(runway({ parts: none })).container.querySelector("[data-row=bills] dt")?.textContent)).toBe("Muut laskut ennen palkkapäivää");
    });

    it("names the range in the spending row and carries no chip", () => {
      const { container } = ledgerOf(runway());
      expect(container.querySelector(".kind-chip")).toBeNull();
      expect(flat(container.querySelector("[data-row=spending] dt")?.textContent)).toBe("Arvioitu kulutus 14 päivältä tavallisesti 300–450 €");
    });

    it("tells a card debt whose bill is after the payday as one quiet line that takes nothing off", () => {
      const parts = { ...runway().parts, laterCards: { cents: 239800, count: 1 } };
      const { container, rows } = ledgerOf(runway({ parts }));
      expect(flat(container.querySelector(".home-later-cards")?.textContent)).toBe("Korttivelka 2 398 €, jonka maksat palkasta 25.11.");
      expect(rows.map((r) => r[0])).toEqual(["balance", "bills", "spending", "left"]);
      expect(ledgerOf(runway()).container.querySelector(".home-later-cards")).toBeNull();
    });

    it("below zero is the problem colour, the verdict tells the sum that is missing and the figure is the answer's", () => {
      const el = withRunway(runway({ leftCents: -213761 }));
      expect(el.closest("section")!.classList.contains("home-short")).toBe(true);
      expect(flat(questionOf(el))).toBe("Puuttuu 2 138 € ennen palkkapäivää");
      expect(flat(el.querySelector(".fig")?.textContent)).toBe("−2 138 €");
      // under 50 cents missing the verdict tells the cents, not 0 €
      expect(flat(questionOf(withRunway(runway({ leftCents: -30 }))))).toBe("Puuttuu 0,30 € ennen palkkapäivää");
      expect(el.closest("section")!.querySelector(".home-fig-line")).toBeNull();
    });

    it("on the payday says so", () => {
      expect(flat(withRunway(runway({ days: 0 })).querySelector(".home-row-note")?.textContent)).toBe("Palkkapäivä tänään");
    });
  });

  it("on the payday says so, not the whole sum as a day's", () => {
    const d = data();
    const today = { ...d.nyt, left: { ...(d.nyt.left as Extract<NytData["left"], { known: true }>), days: 0, perDayCents: 310046 } };
    expect(flat(left({ ...d, nyt: today }).querySelector(".home-fig-line")?.textContent)).toBe("Palkkapäivä tänään");
  });

  it("without its sum says why", () => {
    const el = left({ ...data(), nyt: nytOf(false) });
    expect(flat(el.querySelector(".fig")?.textContent)).toBe("–");
    expect(el.querySelector(".home-fig-line")?.textContent).toBe("Palkkapäivä ei vielä tiedossa");
  });

  it("less left than the bills take is the problem colour", () => {
    const el = left({ ...data(), nyt: nytOf(true, 600000) });
    expect(el.classList.contains("home-short")).toBe(true);
    expect(flat(el.querySelector(".fig")?.textContent)).toBe("−1 000 €");
    // no sum a day below zero: the line tells what is missing
    expect(flat(el.querySelector(".home-fig-line")?.textContent)).toBe("puuttuu 1 000 € ennen palkkapäivää");
  });

  // the notice of the payday's bills stood under the answer; it is no line of the page any more
  it("tells nothing of the payday's own bills", () => {
    const { container } = render(createElement(Now, { data: { ...data(), nyt: nytOf(true, 0, 42182, 123456) } }));
    expect(container.textContent).not.toMatch(/Palkkapäivänä lähtee/);
  });
});
