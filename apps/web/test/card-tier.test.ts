import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardFace } from "../src/components/holdings/CardFace.tsx";
import { barPercent, cardTier } from "../src/components/holdings/card-tier.ts";
import type { DashboardData } from "../src/types.ts";

describe("cardTier", () => {
  it("reads gold from the name in either case, in Finnish and in English", () => {
    for (const name of ["Esimerkkikortti Gold", "ESIMERKKIKORTTI GOLD", "esimerkkikortti gold", "Esimerkki Kultakortti", "KULTAKORTTI", "Kulta-kortti"]) {
      expect(cardTier(name), name).toBe("gold");
    }
  });

  it("reads platinum from the name in either case, in Finnish and in English", () => {
    for (const name of ["Esimerkkikortti Platinum", "PLATINUM VISA", "platinum", "Esimerkki Platinakortti", "PLATINA", "Platinan luottokortti"]) {
      expect(cardTier(name), name).toBe("platinum");
    }
  });

  it("gives the higher tier when a name has both words", () => {
    expect(cardTier("Gold Platinum")).toBe("platinum");
  });

  it("is plain for a name with none of the words, an empty name included", () => {
    for (const name of ["Esimerkkikortti", "Visa Classic", "Luottokortti (Eero)", "Käyttötili", ""]) {
      expect(cardTier(name), name).toBe("plain");
    }
  });
});

describe("barPercent", () => {
  it("is the used share of the limit in whole percent", () => {
    expect(barPercent(120_000, 500_000)).toBe(24);
    expect(barPercent(500_000, 500_000)).toBe(100);
  });

  it("shows a small debt as a sliver and nothing used as no bar", () => {
    expect(barPercent(100, 500_000)).toBe(2);
    expect(barPercent(0, 500_000)).toBe(0);
  });

  it("stops at the full width when more is used than the limit", () => {
    expect(barPercent(620_000, 500_000)).toBe(100);
  });
});

type Card = DashboardData["holdings"]["cards"][number];
const card = (over: Partial<Card> = {}): Card => ({ id: "c1", name: "Esimerkkikortti Gold", bank: "ESIMERKKIPANKKI", ownerName: null, mask: "•••• 1234", limitCents: 500_000, usedCents: 120_000, freeCents: 380_000, overCents: 0, balanceAt: "2026-10-09", ...over });
const face = (c: Card, since: string | null = null) => renderToStaticMarkup(createElement("ul", null, createElement(CardFace, { card: c, logo: null, since })));
// the euro sign and the spaces of a figure come from Intl: compare the digits
const digits = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/[\s ]+/g, " ");

describe("CardFace", () => {
  it("draws the name, the mask as given and a bar of the used share with used, limit and free beside it", () => {
    const html = face(card());
    expect(html).toContain("card-face-gold");
    expect(html).toContain("Esimerkkikortti Gold");
    // a name cut with an ellipsis on a phone stays whole in its title
    expect(html).toContain('title="Esimerkkikortti Gold"');
    expect(html).toContain("•••• 1234");
    expect(html).toContain('width="24%"');
    expect(digits(html)).toMatch(/Käytössä 1 200,00 € Luottoraja 5 000,00 € Vapaana 3 800,00 €/);
  });

  it("marks a card over its limit in words and in the bar", () => {
    const html = face(card({ usedCents: 520_000, freeCents: 0, overCents: 20_000 }));
    expect(html).toContain("card-meter over");
    expect(html).toContain('width="100%"');
    expect(digits(html)).toContain("Yli luottorajan");
    expect(digits(html)).not.toContain("Vapaana");
  });

  it("says over the limit when the card's own figure says it, and not on a comparison of its own", () => {
    // the face reads `overCents`: a used figure above the limit with none over, and the reverse, show what the card says
    expect(digits(face(card({ usedCents: 520_000, freeCents: 0, overCents: 0 })))).not.toContain("Yli luottorajan");
    expect(face(card({ overCents: 5_000 }))).toContain("card-meter over");
    // at the limit is full, not over: nothing free, no excess
    const full = face(card({ usedCents: 500_000, freeCents: 0, overCents: 0 }));
    expect(full).toContain('width="100%"');
    expect(full).not.toContain("card-meter over");
    expect(digits(full)).toContain("Vapaana 0,00 €");
  });

  it("has no bar without a limit, only the debt, and says so when there is none", () => {
    const html = face(card({ name: "Esimerkkikortti", mask: null, limitCents: null, freeCents: null, overCents: null }));
    expect(html).toContain("card-face-plain");
    expect(html).not.toContain("card-meter");
    expect(digits(html)).toContain("Velkaa 1 200,00 €");
    expect(digits(face(card({ limitCents: null, freeCents: null, overCents: null, usedCents: 0 })))).toContain("Ei velkaa");
  });

  it("tells a missing balance and an old one", () => {
    expect(digits(face(card({ usedCents: null, freeCents: null, overCents: null })))).toContain("Saldo puuttuu");
    expect(digits(face(card(), "Saldo päivältä 7.10.2026"))).toContain("Saldo päivältä 7.10.2026");
  });
});
