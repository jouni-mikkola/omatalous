/** Säästövinkit's list: the tips stand by the yearly figure they show, and a tip with a deadline is one of them. */
import type { AreaView, Finding } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Soon, Tips } from "../src/components/optimise/Tips.tsx";

const TODAY = "2026-10-09";

function finding(id: string, area: Finding["area"], midCents: number, decideBy: string | null = null): Finding {
  return {
    id,
    area,
    kind: "k",
    subject: null,
    title: `Otsikko ${id}`,
    action: "",
    euros: { lowCents: midCents, midCents, highCents: midCents },
    decideBy,
    weaknesses: [],
    shared: false,
    calc: [],
    rows: [],
    struck: [],
    claims: [],
    measure: { kind: "category", keys: ["restaurants"] },
    facts: [],
    certainty: { level: "korkea", reason: "" },
  };
}

const view = (id: AreaView["id"], findings: Finding[]): AreaView => ({ id, label: id, findings, checks: [], weightCents: 0 });
const quote = finding("insurance:quote", "insurance", 100000, "2026-10-20");
const AREAS = [view("food", [finding("food:b", "food", 14400)]), view("insurance", [quote])];
const noop = () => {};

describe("Säästövinkit's tips", () => {
  it("lists a tip with a deadline by its yearly figure, above a smaller tip with none", () => {
    const out = renderToStaticMarkup(createElement(Tips, { areas: AREAS, today: TODAY, scope: "own", onChanged: noop, area: null, onArea: noop }));
    expect(out.indexOf("Otsikko insurance:quote")).toBeGreaterThan(-1);
    expect(out.indexOf("Otsikko insurance:quote")).toBeLessThan(out.indexOf("Otsikko food:b"));
  });

  it("shows the 60 days as a line of dates and not as a second list of the same tips", () => {
    const out = renderToStaticMarkup(createElement(Soon, { soon: [quote], today: TODAY, short: (f) => f.id }));
    expect(out).toContain("due-line");
    expect(out).not.toContain('class="tip"');
  });
});
