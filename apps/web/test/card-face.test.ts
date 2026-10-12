import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardFace } from "../src/components/holdings/CardFace.tsx";

type Props = Parameters<typeof CardFace>[0];
const face = (card: Partial<Props["card"]> = {}, logo: string | null = null) =>
  renderToStaticMarkup(createElement(CardFace, { card: { name: "Esimerkkipankki Luotto", bank: null, mask: null, ...card }, logo }));

describe("CardFace", () => {
  it("has the class of the tone the card's name gives, and the tone's word at the bottom right, in capitals", () => {
    for (const [name, tone, word] of [
      ["Esimerkkipankki Gold", "gold", "GOLD"],
      ["Esimerkkipankki Platinum", "platinum", "PLATINUM"],
      ["Esimerkkipankki Black", "black", "BLACK"],
      ["Esimerkkipankki Silver", "silver", "SILVER"],
    ] as const) {
      const markup = face({ name });
      expect(markup, name).toContain(`<div class="card-face card-face-${tone}" aria-hidden="true">`);
      expect(markup, name).toContain(`<span class="card-face-tone">${word}</span>`);
    }
  });

  it("is plain for any other name, with no word on it", () => {
    const markup = face({ name: "Esimerkkipankki Luotto", mask: "•••• 4321" });
    expect(markup).toContain('<div class="card-face card-face-plain" aria-hidden="true">');
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
    const markup = face({ bank: "Nordea" }, "/banks/nordea.png");
    expect(markup).toContain('<div class="card-face-top"><span class="bank-logo bank-logo-sm"><img src="/banks/nordea.png" alt="Nordea"');
    expect(markup).not.toContain("card-face-bank");
  });

  it("shows the bank's name in text for a bank without a logo, and nothing for a card without a bank", () => {
    const named = face({ bank: "Esimerkkipankki" });
    expect(named).toContain('<div class="card-face-top"><span class="card-face-bank">Esimerkkipankki</span></div>');
    expect(named).not.toContain("<img");
    expect(face({ bank: null })).toContain('<div class="card-face-top"></div>');
    expect(face({ bank: "" })).toContain('<div class="card-face-top"></div>');
  });

  it("is hidden from a screen reader whole, and holds no link, control or picture file of its own", () => {
    const markup = face({ name: "Esimerkkipankki Gold", bank: "Esimerkkipankki", mask: "•••• 4321" });
    expect(markup.startsWith('<div class="card-face card-face-gold" aria-hidden="true">')).toBe(true);
    expect(markup.match(/aria-hidden/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<(a|button|input|select|img|image|use|style|link)[ >]/);
    expect(markup).not.toContain("style=");
    // the chip and the sign are drawn, and out of the tab order
    expect(markup.match(/<svg /g)).toHaveLength(2);
    expect(markup.match(/focusable="false"/g)).toHaveLength(2);
  });

  it("draws a chip and, at its right, the contactless sign as three strokes", () => {
    const markup = face();
    expect(markup).toContain('<span class="card-chip"><svg width="20" height="15"');
    expect(markup).toMatch(/<\/span><svg class="card-contactless"[^>]*><path d="[^"]*"><\/path><\/svg>/);
    expect(markup.match(/<path d="[^"]*"/g)?.[1]?.match(/M/g)).toHaveLength(3);
  });
});

describe("the face in holdings.css", () => {
  const css = readFileSync(new URL("../src/styles/holdings.css", import.meta.url), "utf8").replace(/\/\*[^]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
  const faceRules = rules.filter((r) => /\.card-(face|chip|contactless)/.test(r.selector));

  it("has the rules of the face, the five tones among them", () => {
    for (const tone of ["gold", "platinum", "black", "silver"]) expect(faceRules.map((r) => r.selector), tone).toContain(`.card-face-${tone}`);
    expect(faceRules.length).toBeGreaterThan(10);
  });

  it("reads no token of the page: every colour of the face is a custom property of the face, so no look changes it", () => {
    for (const rule of faceRules) {
      for (const [, name] of rule.body.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, rule.selector).toMatch(/^--face-/);
    }
    expect(css.match(/--face-[\w-]+\s*:/g)?.length).toBeGreaterThan(20);
  });

  it("draws the face by CSS and SVG alone: no image file, no font, nothing fetched", () => {
    for (const rule of faceRules) expect(rule.body, rule.selector).not.toMatch(/url\(|@import|@font-face|image-set\(/);
  });
});
