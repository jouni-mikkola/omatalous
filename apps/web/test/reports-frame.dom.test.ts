/** Raportit > frame: the four reports in one list beside the open report, the open one marked. */
import type { QuestionId } from "@banking/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { Frame } from "../src/pages/reports/Frame.tsx";
import { reportPage } from "../src/pages/reports/registry.ts";

afterEach(cleanup);

const ALL: QuestionId[] = ["tulot", "menot", "yhteiset"];

function draw(current: QuestionId, open: QuestionId[] = ALL, period = "6m") {
  const pages = open.map(reportPage);
  render(createElement(Frame, { current, title: reportPage(current).title, pages, params: new URLSearchParams({ period }), children: createElement("p", null, "sisältö") }));
}

const links = (nav: HTMLElement) => within(nav).getAllByRole("link").map((a) => ({ name: a.textContent, href: a.getAttribute("href"), current: a.getAttribute("aria-current") }));

describe("Raportit: the frame", () => {
  it("lists the three reports in one row of links, each keeping the period, the open one marked", () => {
    draw("menot");
    expect(links(screen.getByRole("navigation", { name: "Raportit" }))).toEqual([
      { name: "Tulot ja menot", href: "#/reports?q=tulot&period=6m", current: null },
      { name: "Menot kategorioittain", href: "#/reports?q=menot&period=6m", current: "true" },
      { name: "Yhteiset menot", href: "#/reports?q=yhteiset&period=6m", current: null },
    ]);
  });

  it("names the open report as the heading and has no second row of reports", () => {
    draw("yhteiset");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Yhteiset menot");
    expect(screen.getAllByRole("navigation").map((n) => n.getAttribute("aria-label"))).toEqual(["Raportit"]);
  });

  it("no address is linked twice on the page", () => {
    draw("tulot");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBe(3);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("leaves out a report with nothing to show", () => {
    draw("menot", ["tulot", "menot"]);
    expect(links(screen.getByRole("navigation", { name: "Raportit" })).map((l) => l.name)).toEqual(["Tulot ja menot", "Menot kategorioittain"]);
  });

  it("puts the period switch it is given in the row of the tabs, after them", () => {
    render(createElement(Frame, { current: "tulot", title: "Tulot ja menot", pages: ALL.map(reportPage), params: new URLSearchParams(), period: createElement("div", { "data-testid": "switch" }), children: null }));
    const nav = screen.getByRole("navigation", { name: "Raportit" });
    const switcher = screen.getByTestId("switch");
    expect(switcher.parentElement).toBe(nav.parentElement);
    expect(nav.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps no period in an address when none is open", () => {
    render(createElement(Frame, { current: "menot", title: "Menot kategorioittain", pages: ["tulot", "menot"].map((id) => reportPage(id as QuestionId)), params: new URLSearchParams(), children: null }));
    expect(links(screen.getByRole("navigation", { name: "Raportit" })).map((l) => l.href)).toEqual(["#/reports?q=tulot", "#/reports?q=menot"]);
  });
});
