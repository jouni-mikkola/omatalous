import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreditArc } from "../src/components/holdings/CreditArc.tsx";
import { money, percent } from "../src/format.ts";

const arc = (usedCents: number | null, limitCents: number | null) => renderToStaticMarkup(createElement(CreditArc, { usedCents, limitCents }));
const fill = (markup: string) => /class="credit-arc-fill"[^>]*stroke-dasharray="([\d.]+) 999"/.exec(markup)?.[1];

describe("CreditArc", () => {
  it("fills the share used of a three quarter arc, and says the share in its middle", () => {
    // 642,30 of 3 000,00 is 21 %: 21.41 % of 141.37
    const markup = arc(64_230, 300_000);
    expect(fill(markup)).toBe("30.27");
    expect(markup).toContain(`>${percent(0.21)}</text>`);
    // the track is the whole three quarters
    expect(markup).toContain('class="credit-arc-track" cx="36" cy="36" r="30" stroke-dasharray="141.37 999"');
    expect(fill(arc(150_000, 300_000))).toBe("70.69");
  });

  it("names the two figures with the labels of the rows beside it", () => {
    expect(arc(64_230, 300_000)).toContain(`role="img" aria-label="Käytetty luotto ${money(64_230)}, luottoraja ${money(300_000)}"`);
  });

  it("has no arc for a card with no limit, a limit of nothing, or no used figure", () => {
    for (const [used, limit] of [[64_230, null], [64_230, 0], [64_230, -1], [null, 300_000], [null, null]] as const) expect(arc(used, limit), `${used} of ${limit}`).toBe("");
  });

  it("is an empty track at nothing used and for a card in credit, which a refund can leave", () => {
    for (const used of [0, -5_000]) {
      const markup = arc(used, 300_000);
      expect(fill(markup), `${used}`).toBeUndefined();
      expect(markup).toContain("credit-arc-track");
      expect(markup).toContain(`>${percent(0)}</text>`);
      expect(markup).not.toContain("credit-arc-over");
    }
  });

  it("is full at the limit, and over it full and in the colour of what is wrong, with the true share", () => {
    const at = arc(300_000, 300_000);
    expect(fill(at)).toBe("141.37");
    expect(at).not.toContain("credit-arc-over");
    expect(at).toContain(`>${percent(1)}</text>`);
    // a cent over is over; a card used at twice its limit still stops at the end of the arc
    expect(arc(300_001, 300_000)).toContain('class="credit-arc credit-arc-over"');
    const twice = arc(600_000, 300_000);
    expect(fill(twice)).toBe("141.37");
    expect(twice).toContain(`>${percent(2)}</text>`);
  });

  it("gives each arc a gradient of its own, so two on a page do not share one id", () => {
    const both = renderToStaticMarkup(createElement("div", null, createElement(CreditArc, { usedCents: 1, limitCents: 2 }), createElement(CreditArc, { usedCents: 1, limitCents: 2 })));
    const ids = [...both.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toMatch(/^arc-\w+$/);
    // each fill reads its own gradient by that id
    for (const id of ids) expect(both).toContain(`stroke="url(#${id})"`);
  });
});
