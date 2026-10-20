import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardFace } from "../src/components/holdings/CardFace.tsx";

type Props = Parameters<typeof CardFace>[0];
const face = (card: Partial<Props["card"]> = {}, bank: Props["bank"] = null) =>
  renderToStaticMarkup(createElement(CardFace, { card: { name: "Esimerkkipankki Luotto", mask: null, ...card }, bank, href: "#/transactions?accountId=k1" }));

describe("CardFace", () => {
  it("has the class of the tone the card's name gives, and the tone's word at the bottom right, in capitals", () => {
    for (const [name, tone, word] of [
      ["Esimerkkipankki Gold", "gold", "GOLD"],
      ["Esimerkkipankki Platinum", "platinum", "PLATINUM"],
      ["Esimerkkipankki Black", "black", "BLACK"],
      ["Esimerkkipankki Silver", "silver", "SILVER"],
    ] as const) {
      const markup = face({ name });
      expect(markup, name).toContain(`<div class="card-face card-face-${tone}">`);
      expect(markup, name).toContain(`<span class="card-face-tone">${word}</span>`);
    }
  });

  it("is plain for any other name, with no word on it", () => {
    const markup = face({ name: "Esimerkkipankki Luotto", mask: "•••• 4321" });
    expect(markup).toContain('<div class="card-face card-face-plain">');
    expect(markup).not.toContain("card-face-tone");
    // the digits stand alone at the bottom
    expect(markup).toContain('<div class="card-face-bottom"><span class="card-face-mask">•••• 4321</span></div>');
  });

  it("shows the last four characters of the number the bank gave as four dots and them", () => {
    expect(face({ mask: "•••• 4321" })).toContain('<span class="card-face-mask">•••• 4321</span>');
    expect(face({ mask: "4321" })).toContain('<span class="card-face-mask">•••• 4321</span>');
    expect(face({ mask: " 5555 6666 7777 4321 " })).toContain('<span class="card-face-mask">•••• 4321</span>');
  });

  it("has no number for a card the bank gave none for, and no bottom line when the tone has no word either", () => {
    for (const mask of [null, "", "  "]) {
      const markup = face({ mask });
      expect(markup, JSON.stringify(mask)).not.toContain("card-face-mask");
      expect(markup).not.toContain("••••");
      expect(markup).not.toContain("card-face-bottom");
    }
    // a gold card without a number still has its word, at the right of an empty bottom
    expect(face({ name: "Gold", mask: null })).toContain('<div class="card-face-bottom"><span class="card-face-tone">GOLD</span></div>');
  });

  it("shows the bank's logo at the top left when the app has one", () => {
    const markup = face({}, { bank: "Nordea", src: "/banks/nordea.png" });
    expect(markup).toContain('<div class="card-face-top"><span class="bank-logo bank-logo-sm"><img src="/banks/nordea.png" alt=""');
    expect(markup).not.toContain("card-face-bank");
  });

  it("shows the bank's name in text for a bank without a logo, and nothing for a card without a bank", () => {
    const named = face({}, { bank: "Esimerkkipankki", src: null });
    expect(named).toContain('<div class="card-face-top"><span class="card-face-bank">Esimerkkipankki</span></div>');
    expect(named).not.toContain("<img");
    expect(face({}, null)).toContain('<div class="card-face-top"></div>');
    expect(face({}, { bank: "", src: null })).toContain('<div class="card-face-top"></div>');
  });

  it("is a link for a pointer that the keyboard and a screen reader leave out: the name beside it is their link", () => {
    const markup = face({ name: "Esimerkkipankki Gold", mask: "•••• 4321" }, { bank: "Esimerkkipankki", src: null });
    expect(markup.startsWith('<a class="card-face-link" href="#/transactions?accountId=k1" tabindex="-1" aria-hidden="true"')).toBe(true);
    expect(markup.match(/aria-hidden/g)).toHaveLength(1);
    expect(markup.match(/<a[ >]/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<(button|input|select|img|image|use|style|link)[ >]/);
    expect(markup).not.toContain("style=");
  });

  it("draws a chip as one small SVG, out of the tab order, and no other sign", () => {
    const markup = face();
    expect(markup).toContain('<span class="card-chip"><svg viewBox="0 0 34 26" focusable="false">');
    expect(markup.match(/<svg /g)).toHaveLength(1);
    expect(markup).not.toContain("contactless");
  });
});

describe("the face in holdings.css", () => {
  const css = readFileSync(new URL("../src/styles/holdings.css", import.meta.url), "utf8").replace(/\/\*[^]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
  // the rules of the face itself; the ring of the focus, which stands on the unit, is the page's and reads its token
  const faceRules = rules.filter((r) => /^\.card-(face|chip)/.test(r.selector));

  it("has the rules of the face, the four tones that are not plain among them, each with a ground of its own", () => {
    for (const tone of ["gold", "platinum", "black", "silver"]) {
      const rule = faceRules.find((r) => r.selector === `.card-face-${tone}`);
      expect(rule?.body, tone).toMatch(/background-image: linear-gradient/);
    }
    expect(faceRules.length).toBeGreaterThan(10);
  });

  it("reads no token of the page: the colours of the face are its own, so no look changes them", () => {
    for (const rule of faceRules) {
      for (const [, name] of rule.body.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, rule.selector).toMatch(/^--face-/);
    }
  });

  it("draws the face by CSS and SVG alone: no image file, no font, nothing fetched", () => {
    for (const rule of faceRules) expect(rule.body, rule.selector).not.toMatch(/url\(|@import|@font-face|image-set\(/);
  });

  it("holds the face still: no turn, no perspective, no light that follows the pointer", () => {
    for (const rule of faceRules) expect(rule.body, rule.selector).not.toMatch(/transform|perspective|transition/);
    expect(css).not.toContain("card-face-tilt");
  });

});
