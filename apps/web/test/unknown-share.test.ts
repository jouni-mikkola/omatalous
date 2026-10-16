import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnknownShare, unknownPercent } from "../src/components/UnknownShare.tsx";

const html = (share: number) => renderToStaticMarkup(createElement(UnknownShare, { share }));

describe("the line about spending that is not itemised", () => {
  it("is not shown at 19 % and 20 %", () => {
    expect(html(0.19)).toBe("");
    expect(html(0.2)).toBe("");
    expect(unknownPercent(0.19)).toBeNull();
  });

  it("is shown at 21 % with the link to Tietojen laatu", () => {
    const out = html(0.21);
    expect(out).toContain("Menoista 21 % on vielä erittelemättä, joten luvut ovat suuntaa-antavia.");
    expect(out).toContain(">Tietojen laatu</a>");
  });

  it("rounds to whole percent", () => {
    expect(unknownPercent(0.2149)).toBe(21);
    expect(unknownPercent(0.2151)).toBe(22);
  });
});
