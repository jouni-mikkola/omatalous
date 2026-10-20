import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkCell } from "../src/components/table/Cells.tsx";
import { MerchantAvatar, initialsOf, tintOf } from "../src/components/MerchantAvatar.tsx";

describe("MerchantAvatar", () => {
  it("has two initials, without a company form or a word in brackets", () => {
    expect(initialsOf("Prisma Esimerkki")).toBe("PE");
    expect(initialsOf("K-Market Oy")).toBe("KM");
    expect(initialsOf("Elisa")).toBe("EL");
    expect(initialsOf("Äänekosken Ö-kauppa")).toBe("ÄÖ");
    expect(initialsOf("Käyttötili (esimerkki)")).toBe("KÄ");
    expect(initialsOf("Nordea Gold (esimerkki)")).toBe("NG");
    expect(initialsOf("123 456")).toBe("?");
  });

  it("gives a name one tint on every page: MarkCell draws MerchantAvatar", () => {
    expect(tintOf("Wolt")).toBe(tintOf("WOLT"));
    for (const n of ["Wolt", "Alko", "Apple"]) {
      const mark = renderToStaticMarkup(createElement(MerchantAvatar, { name: n }));
      expect(renderToStaticMarkup(createElement(MarkCell, { name: n }))).toContain(mark);
    }
  });

  it("gives the name of a person the glyph, never initials, and a business its initials", () => {
    const person = renderToStaticMarkup(createElement(MerchantAvatar, { name: "Matti Meikäläinen" }));
    expect(person).toContain("<svg");
    expect(person).not.toContain("data-tint");
    expect(renderToStaticMarkup(createElement(MerchantAvatar, { name: "Wolt" }))).toContain("data-tint");
    expect(renderToStaticMarkup(createElement(MerchantAvatar, { name: "Wolt", person: true }))).toContain("<svg");
  });
});
