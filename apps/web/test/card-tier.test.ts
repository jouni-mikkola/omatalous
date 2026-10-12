import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardRow } from "../src/components/holdings/CardFace.tsx";
import { barPercent, cardName, cardTier } from "../src/components/holdings/card-tier.ts";
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

describe("cardName", () => {
  it("drops the type a bank adds in brackets, in either case and with the spaces around it", () => {
    for (const [name, plain] of [
      ["Esimerkkikortti Gold (credit)", "Esimerkkikortti Gold"],
      ["Esimerkkikortti (debit)", "Esimerkkikortti"],
      ["Esimerkkikortti (CREDIT)", "Esimerkkikortti"],
      ["Esimerkkikortti ( Credit Card )", "Esimerkkikortti"],
      ["Esimerkkikortti(luotto)", "Esimerkkikortti"],
      ["  Esimerkkikortti   (kredit)  ", "Esimerkkikortti"],
    ] as const) {
      expect(cardName(name), name).toBe(plain);
    }
  });

  it("keeps a bracket that is not a type: the owner of a shared card, a word of the name", () => {
    for (const name of ["Esimerkkikortti (Eero)", "Nordea Gold (esimerkki)", "Esimerkkikortti (credits)", "Esimerkkikortti (credit limit)", "Esimerkkikortti Credit"]) {
      expect(cardName(name), name).toBe(name);
    }
  });

  it("takes the type out in front of an owner's name too, and out of the middle of a name", () => {
    expect(cardName("Esimerkkikortti (credit) (Eero)")).toBe("Esimerkkikortti (Eero)");
    expect(cardName("Esimerkki (debit) Gold")).toBe("Esimerkki Gold");
  });

  it("never leaves a card without a name", () => {
    expect(cardName("(credit)")).toBe("(credit)");
    expect(cardName("")).toBe("");
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
const face = (c: Card, since: string | null = null) => renderToStaticMarkup(createElement("ul", null, createElement(CardRow, { card: c, logo: null, since })));
// the euro sign and the spaces of a figure come from Intl: compare the digits
const digits = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/[\s ]+/g, " ");

describe("CardRow", () => {
  it("draws a face for the eye alone and beside it the name, then used, limit and free, then a bar of the used share", () => {
    const html = face(card());
    expect(html).toContain('class="card-face card-face-gold" aria-hidden="true"');
    // the mask is on the face, and in the text for a reader who does not see the face
    expect(html).toMatch(/card-face-mask">•••• 1234</);
    expect(html).toContain('<span class="sr-only"> •••• 1234</span>');
    expect(html).toContain('width="24%"');
    const beside = digits(html.slice(html.indexOf("holding-card-text")));
    expect(beside).toMatch(/Esimerkkikortti Gold •••• 1234 Käytetty luotto 1 200,00 € Luottoraja 5 000,00 € Käytettävissä 3 800,00 €/);
  });

  it("names the card without the type in brackets and draws its tier from the whole name", () => {
    const html = face(card({ name: "Esimerkkikortti Gold (credit)" }));
    expect(html).toContain("card-face-gold");
    expect(html).toContain('holding-name">Esimerkkikortti Gold<');
    expect(html).not.toContain("(credit)");
  });

  it("marks a card over its limit in words with the sum over, and in the bar", () => {
    const html = face(card({ usedCents: 520_000, freeCents: 0, overCents: 20_000 }));
    expect(html).toContain("card-meter over");
    expect(html).toContain('width="100%"');
    expect(html).toContain('class="holding-figure-warn"');
    expect(digits(html)).toContain("Käytetty luotto 5 200,00 € Luottoraja 5 000,00 € Luottoraja ylitetty 200,00 €");
    expect(digits(html)).not.toContain("Käytettävissä");
  });

  it("says over the limit when the card's own figure says it, and not on a comparison of its own", () => {
    // the row reads `overCents`: a used figure above the limit with none over, and the reverse, show what the card says
    expect(digits(face(card({ usedCents: 520_000, freeCents: 0, overCents: 0 })))).not.toContain("Luottoraja ylitetty");
    expect(face(card({ overCents: 5_000 }))).toContain("card-meter over");
    // at the limit is full, not over: nothing free, no excess
    const full = face(card({ usedCents: 500_000, freeCents: 0, overCents: 0 }));
    expect(full).toContain('width="100%"');
    expect(full).not.toContain("card-meter over");
    expect(digits(full)).not.toContain("Luottoraja ylitetty");
    expect(digits(full)).toContain("Käytettävissä 0,00 €");
  });

  it("has no bar and no limit line without a limit: only what is used, and 0,00 € when nothing is", () => {
    const html = face(card({ name: "Esimerkkikortti", mask: null, limitCents: null, freeCents: null, overCents: null }));
    expect(html).toContain("card-face-plain");
    expect(html).not.toContain("card-meter");
    expect(html).not.toContain("sr-only");
    expect(digits(html)).toContain("Käytetty luotto 1 200,00 €");
    expect(digits(html)).not.toContain("Luottoraja");
    const none = digits(face(card({ limitCents: null, freeCents: null, overCents: null, usedCents: 0 })));
    expect(none).toContain("Käytetty luotto 0,00 €");
    expect(none).not.toMatch(/Velkaa|Ei velkaa/);
  });

  it("tells a missing balance, with the limit when there is one and without a bar, and an old balance", () => {
    const unknown = face(card({ usedCents: null, freeCents: null, overCents: null }));
    expect(digits(unknown)).toContain("Käytetty luotto Ei tiedossa Luottoraja 5 000,00 €");
    expect(unknown).not.toContain("card-meter");
    expect(digits(face(card({ limitCents: null, usedCents: null, freeCents: null, overCents: null })))).toContain("Käytetty luotto Ei tiedossa");
    expect(digits(face(card(), "Saldo päivältä 7.10.2026"))).toContain("Saldo päivältä 7.10.2026");
    expect(digits(face(card()))).not.toContain("Saldo päivältä");
  });

  it("shows the bank's name on the face when the app has no logo for it, and nothing without a bank", () => {
    expect(face(card())).toContain('card-face-bank">ESIMERKKIPANKKI<');
    expect(face(card({ bank: null }))).not.toContain("card-face-bank");
  });
});
