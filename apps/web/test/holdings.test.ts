import { FIGURE_UNKNOWN } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Holdings } from "../src/components/holdings/Holdings.tsx";
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
const answer = (over: Partial<Answer> = {}): Answer => ({ accounts: [], accountsCents: null, cards: [], loans: [], debtCents: 0, ...over });
const html = (h: Answer) => renderToStaticMarkup(createElement(Holdings, { holdings: h, meta }));
// the euro sign and the spaces of a figure come from Intl: compare the digits
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/[\s ]+/g, " ");
const headings = (markup: string, tag: "h2" | "h3") => [...markup.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, "g"))].map((m) => m[1]);

describe("Holdings", () => {
  it("is nothing for a household with no account, card or loan", () => {
    expect(html(answer())).toBe("");
  });

  it("is one card headed Varallisuus with a group under it for each of accounts, credit cards and loans, and leaves an empty group out", () => {
    const all = html(answer({ accounts: [account("a", "Käyttötili", 100_000)], accountsCents: 100_000, cards: [card()], loans: [loan()], debtCents: 12_000_000 }));
    expect(headings(all, "h2")).toEqual(["Varallisuus"]);
    expect(headings(all, "h3")).toEqual(["Tilit", "Luottokortit", "Lainat"]);
    expect(headings(html(answer({ accounts: [account("a", "Käyttötili", 100_000)], accountsCents: 100_000, loans: [loan()] })), "h3")).toEqual(["Tilit", "Lainat"]);
    expect(headings(html(answer({ cards: [card()] })), "h3")).toEqual(["Luottokortit"]);
  });

  describe("Tilit", () => {
    it("opens with the total core gives, before the accounts, and says nothing of a balance that is missing when none is", () => {
      const markup = html(answer({ accounts: [account("a", "Käyttötili", 120_050), account("b", "Säästötili", -2_000)], accountsCents: 118_050 }));
      expect(text(markup)).toContain("Yhteensä 1 180,50 € Käyttötili 1 200,50 € Säästötili −20,00 €");
      expect(markup).not.toContain("Ilman");
    });

    it("tells how many accounts are left out of the total for want of a balance, and shows a dash for a total with none", () => {
      const one = html(answer({ accounts: [account("a", "Käyttötili", 120_050), account("b", "Säästötili", null)], accountsCents: 120_050 }));
      expect(text(one)).toContain("Yhteensä Ilman 1 tilin saldoa 1 200,50 €");
      const two = html(answer({ accounts: [account("a", "Käyttötili", null), account("b", "Säästötili", null)], accountsCents: null }));
      expect(text(two)).toContain("Yhteensä Ilman 2 tilin saldoa –");
    });

    it("adds the last four characters after the name of accounts that share one, and after no other", () => {
      const markup = html(answer({ accounts: [account("a", "Käyttötili", 1_000, "1234"), account("b", "Käyttötili", 2_000, "5678"), account("c", "Säästötili", 3_000, "9999")], accountsCents: 6_000 }));
      expect(text(markup)).toContain("Käyttötili ·· 1234");
      expect(text(markup)).toContain("Käyttötili ·· 5678");
      expect(markup).not.toContain("9999");
    });

    it("folds the accounts under a euro into one line of five or more accounts, and lists four whole", () => {
      const accounts = [account("a", "Käyttötili", 120_050), account("b", "Säästötili", 50), account("c", "Vanha tili", 0), account("d", "Toinen tili", -99), account("e", "Rahastotili", 100)];
      const folded = html(answer({ accounts, accountsCents: 120_101 }));
      expect(text(folded)).toContain("Muut tilit (3)");
      const [list, fold] = folded.split("<details");
      expect(list).toContain("Käyttötili");
      expect(list).toContain("Rahastotili");
      expect(list).not.toContain("Vanha tili");
      expect(fold).toContain("Vanha tili");
      expect(fold).toContain("Säästötili");
      expect(html(answer({ accounts: accounts.slice(0, 4), accountsCents: 120_000 }))).not.toContain("<details");
    });
  });

  describe("Lainat", () => {
    it("shows each loan with what is left and the instalment, and leaves the instalment out when the answer has none", () => {
      const markup = html(answer({ loans: [loan(), loan({ id: "l2", name: "Autolaina", lender: null, leftCents: 800_000, monthlyPaymentCents: null })], debtCents: 12_800_000 }));
      expect(text(markup)).toContain("Kodin laina Esimerkkirahoitus Oy Lainaa jäljellä 120 000,00 € Kuukausierä 1 000,00 €");
      expect(text(markup)).toContain("Autolaina Lainaa jäljellä 8 000,00 € Lainat yhteensä");
      expect(text(markup.slice(markup.indexOf("Autolaina")))).not.toContain("Kuukausierä");
    });

    it("a loan another member typed in says who under the lender and the part, and the viewer's own says nothing", () => {
      const theirs = loan({ id: "l2", name: "Autolaina", part: { from: 3, to: 5, of: 5 }, typedBy: "Aino" });
      const markup = html(answer({ loans: [loan(), theirs], debtCents: 16_800_000 }));
      expect(text(markup)).toContain("Autolaina Esimerkkirahoitus Oy osuutesi 40 % Lisännyt Aino Lainaa jäljellä");
      expect(markup).toContain('<div class="holding-sub">Lisännyt Aino</div>');
      expect(text(markup.slice(0, markup.indexOf("Autolaina")))).not.toContain("Lisännyt");
      // the row is told and nothing on it opens the loan
      expect(markup).not.toContain("<a ");
      expect(markup).not.toContain("<button");
    });

    it("says the unknown for a loan that has no figure, and carries the note of a debt that may be there twice", () => {
      const markup = html(answer({ loans: [loan({ leftCents: null, maybeTwice: true })], debtCents: 0 }));
      expect(text(markup)).toContain(`Lainaa jäljellä ${FIGURE_UNKNOWN}`);
      expect(markup).toContain("holding-note");
    });

    it("calls the total the loans when no card owes anything, and the debts when one does", () => {
      const loans = answer({ loans: [loan()], debtCents: 12_000_000 });
      expect(text(html({ ...loans, cards: [card({ usedCents: 0 })] }))).toContain("Lainat yhteensä 120 000,00 €");
      expect(text(html({ ...loans, cards: [card({ usedCents: null, freeCents: null, overCents: null })] }))).toContain("Lainat yhteensä");
      const owing = html({ ...loans, cards: [card({ usedCents: 50_000, freeCents: 250_000 })], debtCents: 12_050_000 });
      expect(text(owing)).toContain("Velat yhteensä 120 500,00 €");
      expect(owing).not.toContain("Lainat yhteensä");
    });

    it("has no total row for a household that owes nothing", () => {
      expect(text(html(answer({ loans: [loan({ leftCents: 0 })], debtCents: 0 })))).not.toContain("yhteensä");
    });
  });
});
