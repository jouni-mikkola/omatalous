import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { accountNumber, formatIban } from "../src/format.ts";
import { Accounts } from "../src/pages/settings/Accounts.tsx";
import { BankConnections, fetchedText } from "../src/pages/settings/BankConnections.tsx";
import type { Account, Connection, Meta } from "../src/types.ts";

describe("formatIban", () => {
  it("groups an IBAN by four, whatever spacing or case it came in", () => {
    expect(formatIban("FI2112345600000785")).toBe("FI21 1234 5600 0007 85");
    expect(formatIban("fi21 1234 5600 0007 85")).toBe("FI21 1234 5600 0007 85");
    expect(formatIban(" FI96 1234 5600 0007 93 ")).toBe("FI96 1234 5600 0007 93");
  });

  it("gives an empty text for none, and leaves a short one whole", () => {
    expect(formatIban(null)).toBe("");
    expect(formatIban(undefined)).toBe("");
    expect(formatIban("FI21")).toBe("FI21");
  });
});

describe("accountNumber", () => {
  it("is the IBAN in groups, else the card's masked number, else nothing", () => {
    expect(accountNumber({ iban: "FI7412345600000801", cardMask: null })).toBe("FI74 1234 5600 0008 01");
    expect(accountNumber({ iban: null, cardMask: "•••• 1144" })).toBe("•••• 1144");
    expect(accountNumber({ iban: null })).toBe("");
  });
});

describe("fetchedText: the Haettu column of a connection in Pankkiyhteydet", () => {
  const conn = { id: "c1", state: "active" as const, lastSyncedAt: null };
  const acc = (extra: Record<string, unknown> = {}) => ({ connectionId: "c1", lastSyncedAt: null, problem: null, ...extra }) as Parameters<typeof fetchedText>[1][number];

  it("is the latest fetch of its accounts", () => {
    const text = fetchedText(conn, [acc({ lastSyncedAt: "2026-10-01T08:00:00Z" }), acc({ lastSyncedAt: "2026-10-03T08:00:00Z" }), acc({ connectionId: "c2", lastSyncedAt: "2026-10-09T08:00:00Z" })]);
    expect(text).toContain("3.10.2026");
  });

  it("says it waits for the first fetch while nothing went wrong", () => {
    expect(fetchedText(conn, [acc(), acc()])).toBe("Odottaa ensimmäistä hakua");
  });

  it("says the account is not linked in the Control Panel, before any other reason", () => {
    const notLinked = { kind: "not_linked" as const, message: "x" };
    expect(fetchedText(conn, [acc({ problem: { kind: "failed", message: "y" } }), acc({ problem: notLinked })])).toBe("Ei linkitetty Control Panelissa");
  });

  it("says a failed first fetch", () => {
    expect(fetchedText(conn, [acc({ problem: { kind: "failed", message: "y" } })])).toBe("Haku epäonnistui");
  });

  it("keeps the date of the last run for a consent that ended or owns nothing", () => {
    expect(fetchedText({ ...conn, state: "broken", lastSyncedAt: "2026-10-03T08:00:00Z" }, [acc()])).toContain("3.10.2026");
    expect(fetchedText({ ...conn, lastSyncedAt: null }, [])).toBe("–");
  });
});

const account = (extra: Partial<Account>): Account => ({
  id: "a1",
  userId: "u1",
  name: "Käyttötili",
  bankName: "Käyttötili",
  customName: null,
  holder: null,
  cardMask: null,
  creditLimitCents: null,
  iban: null,
  currency: "EUR",
  type: "checking",
  provider: "enablebanking",
  connectionId: "c1",
  balanceCents: null,
  balanceAt: null,
  lastSyncedAt: null,
  problem: null,
  ...extra,
});
const connection = (id: string): Connection => ({ id, institution: "Nordea", status: "active", state: "active", history: false, replaced: false, validUntil: "2027-03-01T00:00:00Z", createdAt: "2026-09-01T00:00:00Z", lastSyncedAt: null, daysLeft: 140 });
const metaOf = (accounts: Account[], connections: Connection[]) => ({ user: { id: "u1", role: "member" }, members: [{ id: "u1", displayName: "Matti" }], shares: [], bank: { configured: true, banks: [], redirectMode: "own", source: "user" }, connections, accounts }) as unknown as Meta;
/** What a reader sees: no tags, no React text separators, one kind of space. */
const text = (markup: string) => markup.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Pankkiyhteydet: the accounts a connection reads", () => {
  it("tells two connections of one holder apart by account name and IBAN, and says why one has not fetched", () => {
    const accounts = [
      account({ id: "a1", connectionId: "c1", iban: "FI2112345600000785", holder: "Testi Esimerkki", lastSyncedAt: "2026-10-03T08:00:00Z" }),
      account({ id: "a2", connectionId: "c2", name: "Pikasäästötili", bankName: "Pikasäästötili", iban: "FI7412345600000801", holder: "Testi Esimerkki" }),
      account({ id: "a3", connectionId: "c1", name: "Nordea Gold", bankName: "Nordea Gold", type: "credit_card", cardMask: "•••• 1144", lastSyncedAt: "2026-10-03T08:00:00Z" }),
    ];
    const out = text(renderToStaticMarkup(createElement(BankConnections, { meta: metaOf(accounts, [connection("c1"), connection("c2")]), pickerOpen: false, onChange: () => {}, onMessage: () => {} })));
    expect(out).toContain("Käyttötili · FI21 1234 5600 0007 85");
    expect(out).toContain("Nordea Gold · •••• 1144");
    expect(out).toContain("Pikasäästötili · FI74 1234 5600 0008 01");
    expect(out).toContain("3.10.2026");
    expect(out).toContain("Odottaa ensimmäistä hakua");
  });
});

describe("Tilit: what tells accounts apart", () => {
  const render = (accounts: Account[]) => text(renderToStaticMarkup(createElement(Accounts, { meta: metaOf(accounts, [connection("c1")]), onChange: () => {} })));

  it("shows the own name first with the bank's name under it, the holder, the IBAN in groups and a card's limit and use", () => {
    const out = render([
      account({ name: "Yhteinen tili", customName: "Yhteinen tili", iban: "FI2112345600000785", holder: "Testi Esimerkki, Maija Mallikas" }),
      account({ id: "a2", name: "Nordea Gold", bankName: "Nordea Gold", type: "credit_card", cardMask: "•••• 1144", creditLimitCents: 200000, balanceCents: -34000, holder: "Testi Esimerkki" }),
    ]);
    expect(out).toContain("Yhteinen tili FI21 1234 5600 0007 85 Pankin nimi: Käyttötili Testi Esimerkki, Maija Mallikas");
    expect(out).toContain("Nordea Gold •••• 1144 Testi Esimerkki Luottoraja 2 000 €, käytössä 340 €");
    expect(out).not.toContain("yli luottorajan");
  });

  it("says in words that a card is over its limit and by how much: the bar tells it by colour and is hidden from a screen reader", () => {
    const card = (balanceCents: number) => account({ id: "a2", name: "Nordea Gold", bankName: "Nordea Gold", type: "credit_card", creditLimitCents: 300000, balanceCents });
    expect(render([card(-320000)])).toContain("Luottoraja 3 000 €, käytössä 3 200 €, yli luottorajan 200 €");
    // at the limit nothing is over
    const full = render([card(-300000)]);
    expect(full).toContain("Luottoraja 3 000 €, käytössä 3 000 €");
    expect(full).not.toContain("yli luottorajan");
  });

  it("has a column of users only when some account has a choice to make, and a row under a joint account for its split", () => {
    const alone = render([account({})]);
    expect(alone).not.toContain("Käyttäjä");
    expect(alone).not.toContain("Prosentit");
    const use = { users: [{ userId: "u1", label: "Matti", weight: 1 }, { userId: null, label: "Maija Mallikas", weight: 1 }], source: "bank" as const };
    const joint = render([account({ use })]);
    expect(joint).toContain("Käyttäjä");
    expect(joint).toContain("Sen mukaan, kuka tilille on maksanut Tasan Prosentit");
    // near miss: the same two holders but one user's part is 0, so the account is one user's and has no parts to open
    expect(render([account({ use: { ...use, users: [{ ...use.users[0]!, weight: 1 }, { ...use.users[1]!, weight: 0 }] } })])).not.toContain("Prosentit");
  });

  it("does not say the holder twice when the bank gave no product and the name is the holder", () => {
    const out = render([account({ name: "Testi Esimerkki", bankName: "Testi Esimerkki", holder: "Testi Esimerkki", iban: "FI2112345600000785" })]);
    expect(out.split("Testi Esimerkki").length - 1).toBe(1);
  });

  it("has no Haettu column and names no provider after the number: the table is the account, its type, its balance and Muokkaa", () => {
    const out = render([account({ iban: "FI2112345600000785", lastSyncedAt: "2026-10-03T08:00:00Z" }), account({ id: "a2", provider: "demo", connectionId: null })]);
    expect(out).not.toContain("Haettu");
    expect(out).not.toContain("3.10.2026");
    expect(out).not.toMatch(/pankkiyhteys|demo|CSV/);
    expect(out).toMatch(/Tili Tyyppi Saldo/);
  });

  it("says only 'Ei tilejä.' when there is no account", () => {
    expect(render([])).toContain("Ei tilejä.");
    expect(render([])).not.toContain("Yhdistä");
  });

  it("every account has Muokkaa, a bank account too", () => {
    expect(render([account({}), account({ id: "a2", provider: "csv", connectionId: null })]).split("Muokkaa").length - 1).toBe(2);
  });
});
