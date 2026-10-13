import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarRuler, rulerStyle } from "../src/components/overview/BarRuler.tsx";
import { rulerOf } from "../src/components/overview/ruler.ts";

/** The label as `money` writes it: a no-break space inside the figure and before the unit. */
const LABEL = "1 500 €";

describe("the ruler over the category bars", () => {
  it("steps by the first tick and names the first and the last value", () => {
    const ruler = rulerOf(188_389)!;
    expect(ruler.step).toBe("26.54%");
    expect(ruler.ticks.map((t) => [t.at + 0, t.label])).toEqual([[0, "0"], [26.54, null], [53.08, null], [79.62, LABEL]]);
    expect(rulerStyle(ruler)).toEqual({ "--bar-step": "26.54%" });
  });

  it("is none where there is no longest row, and the head cell is then the empty one", () => {
    for (const none of [0, -500]) expect(rulerOf(none)).toBeNull();
    expect(rulerStyle(null)).toBeUndefined();
    expect(renderToStaticMarkup(createElement(BarRuler, { ruler: null, className: "themes-bar" }))).toBe('<td class="category-bar themes-bar"></td>');
  });

  it("draws the two values at their places, hidden from a reader of the table", () => {
    const html = renderToStaticMarkup(createElement(BarRuler, { ruler: rulerOf(188_389) }));
    expect(html).toBe(`<th class="category-bar bar-ruler" aria-hidden="true"><i style="left:0%">0</i><i style="left:79.62%">${LABEL}</i></th>`);
  });
});
