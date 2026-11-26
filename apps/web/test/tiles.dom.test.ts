/** Tiles: a delta chip shows the caller's text and takes the caller's colour; a tile without one has no chip. */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Tiles } from "../src/components/Tiles.tsx";

afterEach(cleanup);

describe("Tiles", () => {
  it("draws the delta as given and colours it by the caller's verdict", () => {
    const { container } = render(
      createElement(Tiles, {
        items: [
          { label: "A", figure: "100 €", delta: { text: "+10 €", good: true } },
          { label: "B", figure: "200 €", delta: { text: "+20 €", good: false } },
          { label: "C", figure: "300 €" },
        ],
      }),
    );
    const chips = [...container.querySelectorAll(".strip-delta")];
    expect(chips.map((c) => [c.textContent, c.classList.contains("good"), c.classList.contains("bad")])).toEqual([
      ["+10 €", true, false],
      ["+20 €", false, true],
    ]);
  });
});
