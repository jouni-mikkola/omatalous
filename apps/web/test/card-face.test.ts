import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardFace } from "../src/pages/reports/holdings/CardFace.tsx";

type Props = Parameters<typeof CardFace>[0];
const face = (card: Partial<Props["card"]> = {}, bank: Props["bank"] = null) =>
  renderToStaticMarkup(createElement(CardFace, { card: { name: "Esimerkkipankki Luotto", mask: null, ...card }, bank, href: "#/transactions?accountId=k1" }));

describe("CardFace", () => {
  it("is a flat row with the card's name, its last four digits as text and its link", () => {
    const markup = face({ name: "Esimerkkipankki Gold", mask: " 5555 6666 7777 4321 " });
    expect(markup).toContain('<a href="#/transactions?accountId=k1">Esimerkkipankki Gold</a>');
    expect(markup).toContain('<span class="card-face-mask">•••• 4321</span>');
    expect(markup).toContain('href="#/transactions?accountId=k1"');
    expect(markup).not.toMatch(/<(svg|img|button|input|style)[ >]/);
    expect(markup).not.toContain("card-chip");
  });

  it("has no number for a card the bank gave none for", () => {
    for (const mask of [null, "", "  "]) expect(face({ mask }), JSON.stringify(mask)).not.toContain("••••");
  });

  it("shows the bank's logo when the app has one, else the bank's name, and nothing for a card without a bank", () => {
    expect(face({}, { bank: "Nordea", src: "/banks/nordea.png" })).toContain('<img src="/banks/nordea.png" alt=""');
    const named = face({}, { bank: "Esimerkkipankki", src: null });
    expect(named).toContain('<span class="card-face-bank">Esimerkkipankki</span>');
    expect(named).not.toContain("<img");
    expect(face({}, null)).not.toContain("card-face-bank");
  });

  it("is one row with one link, its name, that the keyboard and a screen reader reach", () => {
    const markup = face();
    expect(markup.startsWith('<div class="card-face">')).toBe(true);
    expect(markup.match(/<a[ >]/g)).toHaveLength(1);
    expect(markup).not.toContain("aria-hidden");
    expect(markup).not.toContain("tabindex");
  });
});

describe("the card in holdings.css", () => {
  const css = readFileSync(new URL("../src/styles/holdings.css", import.meta.url), "utf8").replace(/\/\*[^]*?\*\//g, "");
  it("holds no gradient, shadow or hex colour", () => {
    expect(css).not.toMatch(/gradient/);
    expect(css.replace(/box-shadow: none/g, "")).not.toMatch(/shadow/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
  it("has no picture rules for the card", () => {
    expect(css).not.toMatch(/card-chip|--face-|aspect-ratio/);
  });
});
