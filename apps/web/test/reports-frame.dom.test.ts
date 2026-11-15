/** Raportit > frame: the three questions beside the open report, and the reports that refine the open question under its name. */
import type { QuestionId } from "@banking/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { Frame } from "../src/pages/reports/Frame.tsx";
import { listedQuestions } from "../src/pages/reports/question-groups.ts";

afterEach(cleanup);

const ALL: QuestionId[] = ["menot", "tulot", "kiinteat", "saldot", "velat", "yhteiset"];

function draw(current: QuestionId, open: QuestionId[] = ALL, period = "6m") {
  const questions = listedQuestions(open);
  const title = questions.flatMap((q) => q.pages).find((p) => p.id === current)!.title;
  render(createElement(Frame, { current, title, questions, params: new URLSearchParams({ period }), children: createElement("p", null, "sisältö") }));
}

const links = (nav: HTMLElement) => within(nav).getAllByRole("link").map((a) => ({ name: a.textContent, href: a.getAttribute("href"), current: a.getAttribute("aria-current") }));

describe("Raportit: the frame", () => {
  it("lists the three questions, each linking to its first report and keeping the period", () => {
    draw("menot");
    expect(links(screen.getByRole("navigation", { name: "Raportit" }))).toEqual([
      { name: "Rahankäyttö", href: "#/reports?q=menot&period=6m", current: "true" },
      { name: "Rahat ja velat", href: "#/reports?q=saldot&period=6m", current: null },
      { name: "Yhteiset menot", href: "#/reports?q=yhteiset&period=6m", current: null },
    ]);
  });

  it("a question that holds the open report links to that report, not to its first", () => {
    draw("kiinteat");
    const [spending] = links(screen.getByRole("navigation", { name: "Raportit" }));
    expect(spending).toEqual({ name: "Rahankäyttö", href: "#/reports?q=kiinteat&period=6m", current: "true" });
  });

  it("shows the reports of the open question under its name, the open one marked, each with the period", () => {
    draw("tulot");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Tulot");
    expect(links(screen.getByRole("navigation", { name: "Rahankäyttö" }))).toEqual([
      { name: "Rahankäyttö", href: "#/reports?q=menot&period=6m", current: null },
      { name: "Tulot", href: "#/reports?q=tulot&period=6m", current: "page" },
      { name: "Kiinteät menot", href: "#/reports?q=kiinteat&period=6m", current: null },
    ]);
    expect(screen.queryByRole("navigation", { name: "Rahat ja velat" })).toBeNull();
  });

  it("a question with one report has no row of reports", () => {
    draw("yhteiset");
    expect(screen.getAllByRole("navigation").map((n) => n.getAttribute("aria-label"))).toEqual(["Raportit"]);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Yhteiset menot");
  });

  it("a question left with one open report has no row of reports, and the question that has none is not listed", () => {
    draw("saldot", ["menot", "saldot"]);
    expect(screen.getAllByRole("navigation").map((n) => n.getAttribute("aria-label"))).toEqual(["Raportit"]);
    expect(links(screen.getByRole("navigation", { name: "Raportit" })).map((l) => l.name)).toEqual(["Rahankäyttö", "Rahat ja velat"]);
  });

  it("keeps no period in an address when none is open", () => {
    const questions = listedQuestions(["menot", "tulot"]);
    render(createElement(Frame, { current: "menot", title: "Rahankäyttö", questions, params: new URLSearchParams(), children: null }));
    expect(links(screen.getByRole("navigation", { name: "Rahankäyttö" })).map((l) => l.href)).toEqual(["#/reports?q=menot", "#/reports?q=tulot"]);
  });
});
