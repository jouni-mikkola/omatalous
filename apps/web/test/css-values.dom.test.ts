/** The computed values of the page reach the element through the CSSOM (css.ts), since the policy blocks a style attribute. */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { css } from "../src/css.ts";
import { BarCell } from "../src/components/table/Cells.tsx";

describe("css()", () => {
  it("sets a length, a custom property and text, and removes a property given undefined", () => {
    const { container } = render(createElement("div", { ref: css({ width: 12, "--part": 60, color: "var(--ink)" }) }));
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue("width")).toBe("12px");
    expect(el.style.getPropertyValue("--part")).toBe("60");
    expect(el.style.getPropertyValue("color")).toBe("var(--ink)");
    const view = render(createElement("div", { ref: css({ width: 12 }) }));
    const same = view.container.firstElementChild as HTMLElement;
    expect(same.style.getPropertyValue("width")).toBe("12px");
    css({ width: undefined })(same);
    expect(same.style.getPropertyValue("width")).toBe("");
  });

  it("fills the bar of a table cell to its share", () => {
    const { container } = render(createElement(BarCell, { value: 1, max: 3 }));
    expect(container.innerHTML).not.toContain("style=\"\"");
    expect(container.querySelector(".rt-bar-track span")!.getAttribute("style")).toContain("33.3%");
  });
});
