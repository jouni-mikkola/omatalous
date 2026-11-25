/** Varat ja velat: the credits answered "Maksettu pois" stay on the page as ended, with the day of their last payment. */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { EndedCredits } from "../src/pages/reports/sections/Balances.tsx";

const credit = (payee: string, lastDate: string) => ({ key: `series:${payee}`, payee, accountId: "acc-1", lastDate, count: 6, cents: 12000 });

describe("Päättyneet on Varat ja velat", () => {
  it("lists each ended credit under its heading with the day it ended, in the server's order", () => {
    const { container } = render(createElement(EndedCredits, { ended: [credit("Esimerkkirahoitus", "2026-09-14"), credit("Mallilaina", "2026-04-02")] }));
    expect(container.querySelector("h3")?.textContent).toBe("Päättyneet");
    const rows = [...container.querySelectorAll(".st-row")].map((r) => (r.textContent ?? "").replace(/\s+/g, " "));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^Esimerkkirahoitus.*päättyi 14\.9\./);
    expect(rows[1]).toMatch(/^Mallilaina.*päättyi 2\.4\./);
  });

  it("draws nothing when no credit has ended", () => {
    const { container } = render(createElement(EndedCredits, { ended: [] }));
    expect(container.innerHTML).toBe("");
  });
});
