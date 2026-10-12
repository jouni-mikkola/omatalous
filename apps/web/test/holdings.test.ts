import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Holdings } from "../src/components/holdings/Holdings.tsx";
import { money } from "../src/format.ts";
import { partText } from "../src/part.ts";
import type { DashboardData, Meta } from "../src/types.ts";

type Answer = DashboardData["holdings"];
const meta = { today: "2026-10-12", bank: { banks: [] } } as unknown as Meta;
const account = (id: string, name: string, balanceCents: number | null, mask: string | null = null): Answer["accounts"][number] => ({
  id, name, type: "checking", bank: null, ownerName: null, balanceCents, balanceAt: balanceCents === null ? null : "2026-10-12", mask,
});
const card = (over: Partial<Answer["cards"][number]> = {}): Answer["cards"][number] => ({
  id: "k1", name: "Esimerkkikortti", bank: null, ownerName: null, mask: null, limitCents: 300_000, usedCents: 0, freeCents: 300_000, overCents: 0, balanceAt: "2026-10-12", ...over,
});
const loan = (over: Partial<Answer["loans"][number]> = {}): Answer["loans"][number] => ({
  id: "l1", name: "Kodin laina", lender: "Esimerkkirahoitus Oy", kind: "mortgage", ownerName: null, leftCents: 12_000_000, monthlyPaymentCents: 100_000, source: "typed", maybeTwice: false, ...over,
});
const answer = (over: Partial<Answer> = {}): Answer => ({ accounts: [], accountsCents: null, cards: [], cardsCents: null, loans: [], loansCents: null, debtCents: 0, ...over });
const html = (h: Answer) => renderToStaticMarkup(createElement(Holdings, { holdings: h, meta }));
// the euro sign and the spaces of a figure come from Intl: compare the digits
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/[\s ]+/g, " ");
const headings = (markup: string, tag: "h2" | "h3") => [...markup.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "g"))].map((m) => m[1]);
const links = (markup: string) => [...markup.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);

describe("Holdings", () => {
  it("is nothing for a household with no account, card or loan", () => {
    expect(html(answer())).toBe("");
  });

  it("is one card headed Varallisuus with a group under it for each of accounts, credit cards and loans, and leaves an empty group out", () => {
    const all = html(answer({ accounts: [account("a", "Käyttötili", 100_000)], accountsCents: 100_000, cards: [card()], loans: [loan()], loansCents: 12_000_000, debtCents: 12_000_000 }));
    expect(headings(all, "h2")).toEqual(["Varallisuus"]);
    expect(headings(all, "h3")).toEqual(["Tilit", "Luottokortit", "Lainat"]);
    expect(headings(html(answer({ accounts: [account("a", "Käyttötili", 100_000)], accountsCents: 100_000, loans: [loan()] })), "h3")).toEqual(["Tilit", "Lainat"]);
    expect(headings(html(answer({ cards: [card()] })), "h3")).toEqual(["Luottokortit"]);
  });

  describe("Tilit", () => {
    it("ends with the total core gives, after the accounts, and has no total row before them", () => {
      const markup = html(answer({ accounts: [account("a", "Käyttötili", 120_050), account("b", "Säästötili", -2_000)], accountsCents: 118_050 }));
      expect(text(markup)).toContain("Käyttötili 1 200,50 € Säästötili −20,00 € Tilit yhteensä 1 180,50 €");
      expect(text(markup).startsWith(" Varallisuus Tilit Käyttötili")).toBe(true);
      expect(text(markup)).not.toContain("Ilman");
      // the total is the last row of the group, in the form of a total
      expect(markup).toMatch(/<div class="st-row st-total"><dt class="st-name">Tilit yhteensä<\/dt><dd class="st-num">[^<]*<\/dd><\/div><\/dl><\/section>/);
    });

    it("tells how many accounts are left out of the total for want of a balance, and shows a dash for a total with none", () => {
      const one = html(answer({ accounts: [account("a", "Käyttötili", 120_050), account("b", "Säästötili", null)], accountsCents: 120_050 }));
      expect(text(one)).toContain("Tilit yhteensä 1 200,50 € Ilman 1 tilin saldoa");
      const two = html(answer({ accounts: [account("a", "Käyttötili", null), account("b", "Säästötili", null)], accountsCents: null }));
      expect(text(two)).toContain("Tilit yhteensä – Ilman 2 tilin saldoa");
    });

    it("adds the last four characters after the name of accounts that share one, and after no other", () => {
      const markup = html(answer({ accounts: [account("a", "Käyttötili", 1_000, "1234"), account("b", "Käyttötili", 2_000, "5678"), account("c", "Säästötili", 3_000, "9999")], accountsCents: 6_000 }));
      expect(text(markup)).toContain("Käyttötili ·· 1234");
      expect(text(markup)).toContain("Käyttötili ·· 5678");
      expect(markup).not.toContain("9999");
    });

    it("lists six accounts with next to nothing in them as six rows in core's order, with no fold", () => {
      const tiny = [account("a", "Käyttötili", 120_050), account("b", "Säästötili", 50), account("c", "Vanha tili", 0), account("d", "Toinen tili", -99), account("e", "Rahastotili", 100), account("f", "Kuudes tili", 1)];
      const markup = html(answer({ accounts: tiny, accountsCents: 120_102 }));
      expect(markup).not.toContain("<details");
      expect(markup).not.toContain("Muut tilit");
      expect(markup.match(/<li class="st-row">/g)).toHaveLength(6);
      expect(text(markup)).toContain("Käyttötili 1 200,50 € Säästötili 0,50 € Vanha tili 0,00 € Toinen tili −0,99 € Rahastotili 1,00 € Kuudes tili 0,01 € Tilit yhteensä 1 201,02 €");
    });
  });

  describe("Lainat", () => {
    it("shows each loan with what is left and the instalment, and leaves the instalment out when the answer has none", () => {
      const markup = html(answer({ loans: [loan(), loan({ id: "l2", name: "Autolaina", lender: null, leftCents: 800_000, monthlyPaymentCents: null })], loansCents: 12_800_000, debtCents: 12_800_000 }));
      expect(text(markup)).toContain("Kodin laina Esimerkkirahoitus Oy Lainaa jäljellä 120 000,00 € Kuukausierä 1 000,00 €");
      expect(text(markup)).toContain("Autolaina Lainaa jäljellä 8 000,00 € Lainat yhteensä 128 000,00 €");
      expect(text(markup.slice(markup.indexOf("Autolaina")))).not.toContain("Kuukausierä");
    });

    it("a loan another member typed in says who under the lender and the part, and the viewer's own says nothing", () => {
      const theirs = loan({ id: "l2", name: "Autolaina", part: { from: 3, to: 5, of: 5 }, typedBy: "Aino" });
      const markup = html(answer({ loans: [loan(), theirs], debtCents: 16_800_000 }));
      expect(text(markup)).toContain("Autolaina Esimerkkirahoitus Oy osuutesi 40 % Lisännyt Aino Lainaa jäljellä");
      expect(markup).toContain('<span class="st-sub">Lisännyt Aino</span>');
      expect(text(markup.slice(0, markup.indexOf("Autolaina")))).not.toContain("Lisännyt");
      // the row is told and nothing on it changes the loan: the name leads to the report and there is no button
      expect(links(markup)).toEqual(["#/reports#lainat", "#/reports#lainat"]);
      expect(markup).not.toContain("<button");
    });

    it("shows a dash for a loan that has no figure, and carries the note of a debt that may be there twice", () => {
      const markup = html(answer({ loans: [loan({ leftCents: null, maybeTwice: true })], debtCents: 0 }));
      expect(text(markup)).toContain("Lainaa jäljellä –");
      expect(markup).toContain('<p class="st-note">');
    });

    it("ends with the total core gives as the last row, whatever the loans' own figures are, and gives none when core has none", () => {
      const total = (over: Partial<Answer>) => text(html(answer({ loans: [loan(), loan({ id: "l2", leftCents: null })], debtCents: 0, ...over })));
      // the sum is core's, so a loan without a balance changes nothing here
      expect(total({ loansCents: 12_000_000 })).toContain("Lainaa jäljellä – Kuukausierä 1 000,00 € Lainat yhteensä 120 000,00 €");
      expect(html(answer({ loans: [loan()], loansCents: 12_000_000, debtCents: 12_000_000 }))).toMatch(/Lainat yhteensä<\/dt><dd class="st-num">[^<]*<\/dd><\/div><\/dl><\/section>/);
      expect(total({ loansCents: null })).not.toContain("yhteensä");
    });

    it("has no total row for a household that owes nothing", () => {
      expect(text(html(answer({ loans: [loan({ leftCents: 0 })], loansCents: 0, debtCents: 0 })))).not.toContain("yhteensä");
    });
  });

  describe("Velat yhteensä", () => {
    const owing = (used: number | null) => card({ usedCents: used, freeCents: used === null ? null : 300_000 - used, overCents: used === null ? null : 0 });
    /** The block's markup split where the foot starts: what the groups hold, and what stands under all of them. */
    const foot = (h: Answer) => {
      const markup = html(h);
      const at = markup.indexOf('class="st-rows holding-foot"');
      return { groups: at < 0 ? markup : markup.slice(0, at), foot: at < 0 ? "" : text(markup.slice(at)) };
    };

    it("is a row of the whole block under the groups when a card has something used and there are loans, and not in the Lainat column", () => {
      const both = foot(answer({ cards: [owing(50_000)], cardsCents: 50_000, loans: [loan()], loansCents: 12_000_000, debtCents: 12_050_000 }));
      expect(both.foot).toContain("Velat yhteensä 120 500,00 €");
      expect(both.groups).not.toContain("Velat yhteensä");
      // the column has its own sum, the loans'
      expect(text(both.groups)).toContain("Lainat yhteensä 120 000,00 €");
    });

    it("is not there for a card at zero or without a balance, nor for cards alone, where it would repeat a single row", () => {
      expect(foot(answer({ cards: [owing(0)], loans: [loan()], debtCents: 12_000_000 })).foot).toBe("");
      expect(foot(answer({ cards: [owing(null)], loans: [loan()], debtCents: 12_000_000 })).foot).toBe("");
      expect(foot(answer({ cards: [owing(50_000)], debtCents: 50_000 })).foot).toBe("");
      expect(foot(answer({ loans: [loan()], debtCents: 12_000_000 })).foot).toBe("");
    });

    it("is the debt total core gives, also when a loan has no balance and is not in it", () => {
      const markup = foot(answer({ cards: [owing(50_000)], loans: [loan({ leftCents: null })], debtCents: 50_000 }));
      expect(markup.foot).toContain("Velat yhteensä 500,00 €");
      expect(text(markup.groups)).not.toContain("Lainat yhteensä");
    });
  });

  describe("the statement look", () => {
    const three = answer({ accounts: [account("a", "Käyttötili", 100_000)], accountsCents: 100_000, cards: [card()], loans: [loan()], loansCents: 12_000_000, debtCents: 12_000_000 });
    const columns = (h: Answer) => /<div class="(st-cols[^"]*)"/.exec(html(h))?.[1];

    it("puts the groups on the three columns of the page's blocks: three are thirds, two are marked so the second takes two thirds, one has the whole width", () => {
      expect(columns(three)).toBe("st-cols st-cols-3 holding-cols-3");
      expect(columns({ ...three, cards: [] })).toBe("st-cols st-cols-3 holding-cols-2");
      expect(columns({ ...three, cards: [], loans: [], debtCents: 0 })).toBe("st-cols st-cols-3 holding-cols-1");
    });

    it("makes the name of an account and of a card a link to its rows in Tapahtumat and a loan's the report Lainat, and no total a link", () => {
      const markup = html({ ...three, accounts: [account("a b", "Käyttötili", 100_000)] });
      expect(links(markup)).toEqual(["#/transactions?accountId=a+b", "#/transactions?accountId=k1", "#/reports#lainat"]);
      const names = [...markup.matchAll(/<a href="[^"]*">(.*?)<\/a>/g)].map((m) => m[1]);
      expect(names).toEqual(["Käyttötili", "Esimerkkikortti", "Kodin laina"]);
    });

  });

  describe("Luottokortit", () => {
    const withCards = (cards: Answer["cards"], cardsCents: number | null = null) => html(answer({ cards, cardsCents }));

    it("gives every card its face at the left of its unit, hidden from a screen reader, and no meter, bar or sentence of its own", () => {
      const two = withCards([card({ bank: "ESIMERKKIPANKKI", mask: "•••• 4321", name: "Esimerkkikortti Gold" }), card({ id: "k2", name: "Toinen kortti" })]);
      const units = two.split('<li class="holding-unit holding-unit-faced">').slice(1);
      expect(units).toHaveLength(2);
      for (const unit of units) {
        expect(unit.startsWith('<div class="card-face card-face-'), "the face comes first, before the name").toBe(true);
        expect(unit).toMatch(/^<div class="card-face [^"]*" aria-hidden="true">/);
        expect(unit.match(/class="card-face /g)).toHaveLength(1);
      }
      for (const gone of ["card-meter", "<button", "<img"]) expect(two, gone).not.toContain(gone);
      // the number is on the face of the card that has one, and the face of the other has none
      expect(units[0]).toContain("•••• 4321");
      expect(units[1]).not.toContain("••••");
      // Tilit and Lainat are rows: no face, no picture
      const rest = html(answer({ accounts: [account("a", "Käyttötili", 100_000, "1234")], accountsCents: 100_000, loans: [loan()], loansCents: 12_000_000 }));
      for (const gone of ["card-face", "card-chip", "<svg", "<img", "holding-unit-body"]) expect(rest, gone).not.toContain(gone);
    });

    it("leaves the name, its lines and the figures of a card as the block drew them before the face: the same markup, now beside it", () => {
      const markup = withCards([card({ name: "Esimerkkipankki Gold (credit)", bank: "Esimerkkipankki", mask: "•••• 4321", usedCents: 120_000, freeCents: 180_000, balanceAt: "2026-10-09", part: { from: 1, to: 2, of: 2 } })]);
      const figureRow = (label: string, cents: number) => `<div class="st-row"><dt class="st-name holding-label">${label}</dt><dd class="st-num">${money(cents)}</dd></div>`;
      const before =
        '<div class="st-row holding-unit-head"><span class="st-name holding-name" title="Esimerkkipankki Gold"><a href="#/transactions?accountId=k1">Esimerkkipankki Gold</a></span>' +
        `<span class="st-sub">${partText({ from: 1, to: 2, of: 2 }, "debt")}</span><span class="st-sub">Saldo päivältä 9.10.2026</span></div>` +
        `<dl class="st-rows">${figureRow("Käytetty luotto", 120_000)}${figureRow("Luottoraja", 300_000)}${figureRow("Käytettävissä", 180_000)}</dl>`;
      expect(markup).toContain(`<div class="holding-unit-body">${before}</div></li>`);
      // all the unit's text is in the body: what stands before it is the face, which a screen reader leaves out
      const open = '<li class="holding-unit holding-unit-faced">';
      const face = markup.slice(markup.indexOf(open) + open.length, markup.indexOf('<div class="holding-unit-body">'));
      expect(face).toMatch(/^<div class="card-face card-face-gold" aria-hidden="true">.*<\/div>$/);
      expect(face).not.toMatch(/<(a|button|input|select)[ >]/);
    });

    it("is the card's name as a link, then its three rows indented under it, as a loan is", () => {
      const markup = withCards([card({ usedCents: 120_000, freeCents: 180_000 })]);
      expect(text(markup)).toContain("Esimerkkikortti Käytetty luotto 1 200,00 € Luottoraja 3 000,00 € Käytettävissä 1 800,00 €");
      expect(markup).toContain('<div class="holding-unit-body"><div class="st-row holding-unit-head">');
      expect(markup).toContain('<a href="#/transactions?accountId=k1">Esimerkkikortti</a>');
      // a loan has the same unit, without the face
      expect(html(answer({ loans: [loan()], loansCents: 12_000_000 }))).toContain('<li class="holding-unit"><div class="st-row holding-unit-head">');
    });

    it("shows the bank's logo on the face from the same place as Asetukset does: bundled, served by the server, else the bank's name", () => {
      const withBanks = (bank: string, banks: unknown[]) => renderToStaticMarkup(createElement(Holdings, { holdings: answer({ cards: [card({ bank })] }), meta: { today: "2026-10-12", bank: { banks } } as unknown as Meta }));
      expect(withBanks("Nordea", [])).toContain('<img src="/banks/nordea.png" alt="Nordea"');
      expect(withBanks("OP", [{ id: "op-fi", logo: true }])).toContain('<img src="/api/bank/logos/op-fi" alt="OP"');
      const named = withBanks("OP", [{ id: "op-fi", logo: false }]);
      expect(named).toContain('<span class="card-face-bank">OP</span>');
      expect(named).not.toContain("<img");
      expect(withBanks("Esimerkkipankki", [])).toContain('<span class="card-face-bank">Esimerkkipankki</span>');
    });

    it("has one row for a card without a limit, and a dash for one the bank gave no balance", () => {
      const bare = withCards([card({ limitCents: null, usedCents: 47_987, freeCents: null, overCents: null })]);
      expect(text(bare)).toContain("Esimerkkikortti Käytetty luotto 479,87 €");
      expect(bare).not.toContain("Luottoraja");
      expect(bare.match(/<dt /g)).toHaveLength(1);
      expect(bare).not.toContain('class="st-sub"');
      const unknown = text(withCards([card({ usedCents: null, freeCents: null, overCents: null })]));
      expect(unknown).toContain("Käytetty luotto – Luottoraja 3 000,00 €");
      expect(unknown).not.toContain("Käytettävissä");
    });

    it("draws what is used of a card over its limit in the colour of what is wrong, with the amount over, and no other card", () => {
      const over = withCards([card({ usedCents: 320_000, freeCents: 0, overCents: 20_000 }), card({ id: "k2", name: "Toinen kortti" })]);
      expect(text(over)).toContain("Käytetty luotto 3 200,00 € Luottoraja 3 000,00 € Luottoraja ylitetty 200,00 €");
      expect(over).not.toContain("Käytettävissä 0,00");
      expect(over.match(/holding-bad/g)).toHaveLength(1);
      expect(over).toMatch(/Käytetty luotto<\/dt><dd class="st-num holding-bad">/);
      // at the limit is not over: nothing free, nothing wrong
      const full = withCards([card({ usedCents: 300_000, freeCents: 0, overCents: 0 })]);
      expect(text(full)).toContain("Käytettävissä 0,00 €");
      expect(full).not.toContain("holding-bad");
    });

    it("names the card without the type its bank adds in brackets, and tells the date of an old balance and the part", () => {
      const markup = withCards([card({ name: "Esimerkkikortti Gold (credit)", balanceAt: "2026-10-09", part: { from: 1, to: 2, of: 2 } })]);
      expect(markup).toContain(">Esimerkkikortti Gold</a>");
      expect(markup).not.toContain("(credit)");
      expect(text(markup)).toContain("Esimerkkikortti Gold osuutesi 50 % Saldo päivältä 9.10.2026 Käytetty luotto");
      expect(text(withCards([card()]))).not.toContain("Saldo päivältä");
    });

    it("carries the last four digits of two cards that share a name, and of no other, in the text beside the face", () => {
      const spoken = (markup: string) => markup.split("<li ").slice(1).map((li) => li.slice(li.indexOf('<div class="holding-unit-body">'))).join("");
      const twin = (id: string, mask: string, name = "Esimerkkikortti") => card({ id, name, mask });
      const two = withCards([twin("a", "•••• 1234"), twin("b", "•••• 5678"), twin("c", "•••• 9999", "Toinen kortti")]);
      expect(text(spoken(two))).toContain("Esimerkkikortti ·· 1234");
      expect(text(spoken(two))).toContain("Esimerkkikortti ·· 5678");
      expect(spoken(two)).not.toContain("9999");
      expect(spoken(withCards([twin("a", "•••• 1234")]))).not.toContain("1234");
      // the faces show the number of every card that has one
      expect(two.match(/<span class="card-face-mask">/g)).toHaveLength(3);
    });

    it("ends with the total core gives, as the last row, with two cards or more, and has none for one", () => {
      const two = withCards([card({ usedCents: 120_000, freeCents: 180_000 }), card({ id: "k2", usedCents: 30_000, freeCents: 270_000 })], 150_000);
      expect(text(two)).toContain("Käytetty luotto 300,00 € Luottoraja 3 000,00 € Käytettävissä 2 700,00 € Luottokortit yhteensä 1 500,00 €");
      expect(two).toMatch(/Luottokortit yhteensä<\/dt><dd class="st-num">[^<]*<\/dd><\/div><\/dl><\/section>/);
      expect(text(withCards([card()], 0))).not.toContain("yhteensä");
      // a total core does not know is a dash
      expect(text(withCards([card({ usedCents: null }), card({ id: "k2", usedCents: null })], null))).toContain("Luottokortit yhteensä –");
    });
  });
});
