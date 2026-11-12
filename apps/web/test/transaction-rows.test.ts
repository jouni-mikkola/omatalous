import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLanguage } from "../src/format.ts";
import { type DaySum, type ListedRow, ownerLink, rowFacts, TxTable } from "../src/pages/TransactionRows.tsx";

const row = (over: Partial<ListedRow> = {}): ListedRow =>
  ({ id: "t1", accountId: "a/1", bookingDate: "2026-10-05", merchant: "ESIMERKKI OY", amountCents: 80_000, own: false, status: "booked", category: "other", ...over }) as ListedRow;
const props = { categories: [], pending: null, onCategory: () => {}, account: "Yhteistili" };
const list = (t: ListedRow, open = false) =>
  renderToStaticMarkup(createElement(TxTable, { items: [t], severalAccounts: true, today: "2026-10-05", daySums: new Map(), rowProps: (r: ListedRow) => ({ t: r, ...props, onStatement: () => {} }), scope: "own", open: open ? t.id : null, onOpen: () => {}, view: { query: "", chip: null, group: null, sort: null }, onView: () => {}, filters: null, searchLabel: "Hae" }));
// the list has one layout; the old phone and wide forms are both this one
const phone = list;
const wide = list;

describe("the link of a row whose payer is not told", () => {
  it("leads to the account's parts on Tilit for a row with an open sum", () => {
    expect(ownerLink(row({ openCents: 55_219 }))).toBe("#/settings/banks#tili-a/1");
    // the link stands in the row's menu, which draws its items only when it is opened
    expect(list(row({ openCents: 55_219 }))).not.toContain("Muuta:");
    expect(list(row({ openCents: 55_219 }), true)).toContain('aria-label="Muuta: ESIMERKKI OY"');
  });

  it("is not there for a row with nothing open, or with the field left out", () => {
    for (const t of [row(), row({ openCents: 0 })]) {
      expect(ownerLink(t)).toBeNull();
      expect(phone(t)).not.toContain("Muuta:");
      expect(wide(t)).not.toContain("Valitse, kenen osuus");
    }
  });
});

describe("a row with no payee", () => {
  it("names the payee in the reader's language, in the row and in what an opened row says", () => {
    const unnamed = row({ merchant: "Tuntematon", own: true });
    try {
      for (const html of [list(unnamed), list(unnamed, true)]) expect(html).toContain('<span class="tx-name">Tuntematon</span>');
      setLanguage("en");
      for (const html of [list(unnamed), list(unnamed, true)]) {
        expect(html).toContain('<span class="tx-name">Unknown</span>');
        // the link to the payee's rows still asks for the stored name; nothing the reader sees or hears has it
        expect(html.replaceAll("merchant=Tuntematon", "")).not.toContain("Tuntematon");
      }
      expect(list(unnamed, true)).toContain('aria-label="Change: Unknown"');
      // a payee with a name of its own stays as the bank wrote it
      expect(list(row())).toContain('<span class="tx-name">ESIMERKKI OY</span>');
    } finally {
      setLanguage("fi");
    }
  });
});

describe("an opened row", () => {
  const facts = (t: ListedRow) => Object.fromEntries(rowFacts(t, "Yhteistili").map(([name, value]) => [name, value]));

  it("says what the bank sent, each field by its name, at every width", () => {
    const t = row({ amountCents: -12_000, counterparty: "ESIMERKKI OY", counterpartyIban: "FI21 1234 5600 0007 85", description: "Lasku 1234", reference: "1232", valueDate: "2026-10-06" });
    expect(facts(t)).toMatchObject({ Tili: "Yhteistili", "Saaja pankin mukaan": "ESIMERKKI OY", "Saajan tili": "FI21 1234 5600 0007 85", Viesti: "Lasku 1234", Viite: "1232", "Kirjauspäivä": "5.10.", "Arvopäivä": "6.10." });
    // money in names its payer; a field the bank left empty is not there
    const paid = facts(row({ amountCents: 5_000, counterparty: "ESIMERKKI OY", description: " " }));
    expect(paid["Maksaja pankin mukaan"]).toBe("ESIMERKKI OY");
    expect(Object.keys(paid)).not.toContain("Viesti");
    expect(Object.keys(paid)).not.toContain("Arvopäivä");
    // the facts are drawn in the opened row, not hidden for a wide screen
    const html = list(t, true);
    expect(html).toContain('class="rt-kv tx-detail-facts"');
    expect(html).toContain("<dt>Viesti</dt><dd>Lasku 1234</dd>");
  });

  it("says a reservation is not booked yet", () => {
    expect(facts(row({ status: "pending" })).Tila).toContain("ei ole vielä kirjannut");
    expect(Object.keys(facts(row()))).not.toContain("Tila");
  });

  it("says why the row has its category", () => {
    const why = (over: Partial<ListedRow>) => facts(row({ amountCents: -1_000, ...over }))["Miksi tämä kategoria"];
    expect(why({ categorySource: "user", category: "groceries" })).toBe("Valitsit sen itse.");
    expect(why({ categorySource: "rule", category: "restaurants", ownRule: { field: "merchant", pattern: "Kahvila" } })).toBe("Oma sääntösi, Kauppias: Kahvila");
    expect(why({ categorySource: "rule", category: "groceries" })).toBe("Sovelluksen sääntö tunnisti sen pankin tekstistä.");
    expect(why({ categorySource: "mcc", category: "groceries", mcc: "5411" })).toBe("Kortin toimialakoodista 5411.");
    expect(why({ categorySource: "industry", category: "restaurants", industry: { companyName: "Esimerkki Oy", businessId: null, label: "Ravintolat" } })).toBe("Kaupparekisterin toimialasta: Esimerkki Oy, Ravintolat.");
    expect(why({ categorySource: "rule", category: "transfer", isTransfer: true })).toContain("omien tiliesi välillä");
    expect(why({ categorySource: "default", category: "other" })).toBe("Sovellus ei tunnistanut tätä.");
  });
});

// the figures of a piece of markup in the order they stand, in cents ("−36,24 €" is -3624)
const figures = (html: string, cls: string): number[] =>
  [...html.matchAll(new RegExp(`class="${cls}[^"]*">(?:<button[^>]*>)?([^<]*)`, "g"))].map((m) => Math.round(Number(m[1]!.replace(/[^\d,+−-]/g, "").replace("−", "-").replace(",", ".")) * 100));

describe("one control per closed transaction row", () => {
  it("keeps even a card bill and a shared row's secondary actions in its detail", () => {
    const bill = row({ own: true, category: "card_bill", amountCents: -60_000 });
    const shared = row({ amountCents: -60_000, partCents: -30_000, openCents: 10_000 });
    // the toolbar over the table has its own buttons (clear the search, Lataa CSV) and the heads sort: count the rows' only
    const inRows = (html: string) => html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>")).match(/<button\b/g);
    for (const t of [bill, shared]) expect(inRows(list(t))).toHaveLength(1);
    // the secondary actions are the items of one menu in the opened row
    expect(list(bill)).not.toContain("Muuta:");
    expect(list(bill, true)).toContain("Muuta: ESIMERKKI OY");
    expect(list(shared, true)).toContain("Muuta: ESIMERKKI OY");
  });
});

describe("the amount cell of a row", () => {
  // the amount cells of a list in the order they stand, each as the classes of the elements right inside it
  const amountCells = (html: string): string[][] =>
    [...html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>")).matchAll(/<td\b[^>]*data-rt="main"[^>]*>(.*?)<\/td>/g)].map((m) => {
      const inside: string[] = [];
      let depth = 0;
      for (const tag of m[1]!.matchAll(/<(\/?)(\w+)\b([^>]*)>/g)) {
        if (tag[1]) depth--;
        else if (depth++ === 0) inside.push(/class="([^"]*)"/.exec(tag[3]!)?.[1] ?? tag[2]!);
      }
      return inside;
    });

  it("is the sum and, on a joint row, the share part: nothing is drawn after them on a day of several rows", () => {
    // a day of two rows of different sizes, one of them joint: the smaller one had the bar against the day's largest
    const items = [row({ id: "big", amountCents: -60_000 }), row({ id: "small", amountCents: -15_000 }), row({ id: "joint", amountCents: -40_000, partCents: -20_000 }), row({ id: "in", amountCents: 5_000 })];
    const html = renderToStaticMarkup(createElement(TxTable, { items, severalAccounts: true, today: "2026-10-05", daySums: new Map(), rowProps: (t: ListedRow) => ({ t, ...props }), scope: "own", open: null, onOpen: () => {}, view: { query: "", chip: null, group: null, sort: null }, onView: () => {}, filters: null, searchLabel: "Hae" }));
    expect(figures(html, "tx-amount")).toEqual([-60_000, -15_000, -20_000, 5_000]);
    expect(amountCells(html)).toEqual([["tx-amount"], ["tx-amount"], ["tx-amount", "tx-part"], ["tx-amount in"]]);
  });
});

describe("the part of a joint account's row", () => {
  it("is the row's plain figure, with its basis in the opened detail and the bank's amount under it", () => {
    for (const show of [phone, wide]) {
      const html = show(row({ amountCents: -60_000, partCents: -30_000 }));
      expect(figures(html, "tx-amount")).toEqual([-30_000]);
      expect(html).not.toContain("why-door");
      expect(html).toContain('<span class="tx-part">koko summa −600,00');
      expect(list(row({ amountCents: -60_000, partCents: -30_000 }), true)).toContain('class="why-door');
    }
  });

  it("near misses: a part equal to the amount is the whole row, a row the server gives no part shows the bank's amount, a part of nothing is 0 and opens nothing", () => {
    for (const show of [phone, wide]) {
      for (const t of [row({ amountCents: 20_000, partCents: 20_000 }), row({ amountCents: 20_000 })]) {
        expect(figures(show(t), "tx-amount")).toEqual([20_000]);
        expect(show(t)).not.toContain("koko summa");
      }
      const none = show(row({ amountCents: 20_000, partCents: 0 }));
      expect(figures(none, "tx-amount")).toEqual([0]);
      expect(none).not.toContain("why-door");
      expect(none).toContain("koko summa +200,00");
    }
  });

  it("makes a day's rows add up to the day's sum the server gives, with a joint row among them", () => {
    // Pe 18.9 of the report: the joint row's bank amount is −36,24 €, the viewer's part −21,74 €, the head −167,73 €
    const items = [row({ id: "j", bookingDate: "2026-09-18", amountCents: -3_624, partCents: -2_174 }), row({ id: "o", accountId: "a/2", bookingDate: "2026-09-18", amountCents: -14_599 })];
    const daySums = new Map<string, DaySum>([["2026-09-18", { date: "2026-09-18", count: 2, inCents: 0, outCents: 16_773 }]]);
    const rowProps = (t: ListedRow) => ({ t, ...props });
    const lists = [renderToStaticMarkup(createElement(TxTable, { items, severalAccounts: true, today: "2026-10-05", daySums, rowProps, scope: "own", open: null, onOpen: () => {}, view: { query: "", chip: null, group: null, sort: null }, onView: () => {}, filters: null, searchLabel: "Hae" }))];
    for (const html of lists) {
      expect(figures(html, "rt-sub")).toEqual([-16_773]);
      expect(figures(html, "tx-amount").reduce((a, b) => a + b, 0)).toBe(-16_773);
    }
  });
});

describe("the counts of the toolbar's chips", () => {
  const chips = (whole: boolean, chip: string | null = null) => {
    const items = [row({ id: "p", status: "pending" }), row({ id: "m", categorySource: "user" }), row({ id: "b" })];
    const html = renderToStaticMarkup(createElement(TxTable, { items, whole, total: 796, severalAccounts: true, today: "2026-10-05", daySums: new Map(), rowProps: (t: ListedRow) => ({ t, ...props }), scope: "own", open: null, onOpen: () => {}, view: { query: "", chip, group: null, sort: null }, onView: () => {}, filters: null, searchLabel: "Hae" }));
    return [...html.matchAll(/class="rtb-chip"[^>]*>(.*?)<\/button>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
  };

  it("on a page of a longer list: the head says the count, so Kaikki has no number, and neither has a chip, whose rows can be on another page", () => {
    expect(chips(false)).toEqual(["Kaikki", "Käsin luokitellut", "Varaukset"]);
  });

  it("on a whole list: the rows the table has, and Kaikki without a number while the head says it", () => {
    expect(chips(true)).toEqual(["Kaikki", "Käsin luokitellut 1", "Varaukset 1"]);
  });

  it("under a chip the head is not there, so Kaikki says how many rows it would bring back", () => {
    expect(chips(true, "manual")).toEqual(["Kaikki 3", "Käsin luokitellut 1", "Varaukset 1"]);
  });
});

describe("a chip that no row of the whole list has", () => {
  // a page of a longer list offers every chip; the whole list behind the chip can then have no row with the mark
  const html = renderToStaticMarkup(createElement(TxTable, { items: [row({ id: "b1" }), row({ id: "b2", merchant: "TOINEN OY" })], severalAccounts: true, today: "2026-10-05", daySums: new Map(), rowProps: (t: ListedRow) => ({ t, ...props }), scope: "own", open: null, onOpen: () => {}, view: { query: "", chip: "pending", group: null, sort: null }, onView: () => {}, filters: null, searchLabel: "Hae" }));
  const chips = [...html.matchAll(/class="rtb-chip"[^>]*>(.*?)<\/button>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));

  it("stays chosen with its count of none, so the reader sees what the list is narrowed to and can leave it", () => {
    expect(chips).toEqual(["Kaikki 2", "Varaukset 0"]);
  });

  it("narrows the list to no rows instead of showing every row", () => {
    expect(html).not.toContain("ESIMERKKI OY");
    expect(html).not.toContain("TOINEN OY");
    expect(html).toContain("Ei yhtään riviä, joka täsmää.");
  });
});
