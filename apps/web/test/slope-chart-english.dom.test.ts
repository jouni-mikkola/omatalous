/**
 * The change chart (the slope) in the reader's language: the name of its focusable group, the row a screen reader hears
 * at every arrow key and the sentence under the chart come from the catalogue, so an English reader hears no Finnish.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SlopeChart, type SlopeItem } from "../src/charts/SlopeChart.tsx";
import { setLanguage } from "../src/format.ts";

const item = (label: string, from: number, to: number, strong: boolean): SlopeItem => ({ key: label, label, from, to, change: to - from, strong, tone: to > from ? "bad" : "good" });
/** A strong line that sets the scale, and context lines far above it: they do not fit and are named under the chart. */
const COFFEE = item("Coffee", 4000, 5200, true);
const far = (names: readonly string[]) => names.map((name, n) => item(name, 900_000 + n * 1000, 910_000 + n * 1000, false));

/** A Finnish word of the chart's own texts, or any word with a Finnish letter. */
const FINNISH = /[äöå]|\b(Muutos|ja|ei|Sen|Niiden|mahdu|kuvaan|luvut|ovat|taulukossa|rivin|viivasta|toiseen)\b/i;

/** The chart drawn and moved one line on with an arrow key: the three texts a reader gets. */
function heard(off: readonly string[], label: string) {
  const { container } = render(createElement(SlopeChart, { items: [COFFEE, ...far(off)], fromLabel: "2025", toLabel: "2026", label }));
  const group = container.querySelector<SVGGElement>("g[tabindex]")!;
  fireEvent.keyDown(group, { key: "ArrowRight" });
  return { name: group.getAttribute("aria-label")!, live: container.querySelector("[aria-live]")!.textContent!, under: container.querySelector(".slope-off")!.textContent! };
}

describe("SlopeChart in the reader's language", () => {
  // happy-dom lays nothing out: the chart measures its own width, so every element is 900 px wide here
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  beforeAll(() => Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 }));
  afterAll(() => {
    if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  });
  afterEach(() => {
    cleanup();
    setLanguage("fi");
  });

  it("has no Finnish word in English with one line that does not fit", () => {
    setLanguage("en");
    const { name, live, under } = heard(["Rent"], "Spending by category");
    expect(name).toBe("Spending by category. Arrow keys move from line to line, Enter shows the row in the table.");
    expect(live).toMatch(/^Coffee: 2025 .*, 2026 .*, Change /);
    expect(under).toBe("Rent does not fit in the chart. Its figures are in the table.");
    for (const text of [name, live, under]) expect(text).not.toMatch(FINNISH);
  });

  it("has no Finnish word in English with three lines that do not fit", () => {
    setLanguage("en");
    const { name, live, under } = heard(["Rent", "Car", "Travel"], "Spending by category");
    expect(under).toBe("Rent, Car and Travel do not fit in the chart. Their figures are in the table.");
    for (const text of [name, live, under]) expect(text).not.toMatch(FINNISH);
  });

  it("reads in Finnish as before", () => {
    setLanguage("fi");
    const one = heard(["Asuminen"], "Menot kategorioittain");
    expect(one.name).toBe("Menot kategorioittain. Nuolinäppäimet siirtävät viivasta toiseen, Enter näyttää rivin taulukossa.");
    expect(one.live).toMatch(/^Coffee: 2025 .*, 2026 .*, Muutos /);
    expect(one.under).toBe("Asuminen ei mahdu kuvaan. Sen luvut ovat taulukossa.");
    cleanup();
    expect(heard(["Asuminen", "Auto", "Matkat"], "Menot kategorioittain").under).toBe("Asuminen, Auto ja Matkat eivät mahdu kuvaan. Niiden luvut ovat taulukossa.");
  });
});
