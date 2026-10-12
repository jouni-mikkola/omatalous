import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bankIdForInstitution, bankLogo, logoForInstitution } from "../src/banks.ts";
import { BankConnections } from "../src/pages/settings/BankConnections.tsx";
import type { Account, Connection, Meta } from "../src/types.ts";

const BANKS = [{ id: "nordea-fi", name: "Nordea", country: "FI" }];

describe("bankIdForInstitution", () => {
  it("finds the bank of a consent by the name the bank reported", () => {
    expect(bankIdForInstitution(BANKS, "Nordea")).toBe("nordea-fi");
    expect(bankIdForInstitution(BANKS, " nordea ")).toBe("nordea-fi");
    expect(bankIdForInstitution(BANKS, "Nordea Bank Abp")).toBe("nordea-fi");
  });

  it("is null for a bank the server no longer offers, so the picker opens instead", () => {
    expect(bankIdForInstitution(BANKS, "OP")).toBeNull();
    expect(bankIdForInstitution(BANKS, "")).toBeNull();
    expect(bankIdForInstitution([], "Nordea")).toBeNull();
  });

  // every bank of the server's list (apps/server/src/connectors/enable-banking/banks.ts), with the names Enable Banking may report
  const ALL: [id: string, name: string, reported: string[]][] = [
    ["nordea-fi", "Nordea", ["Nordea"]],
    ["op-fi", "OP", ["OP", "op"]],
    ["danske-fi", "Danske Bank", ["Danske Bank", "Danske"]],
    ["s-pankki-fi", "S-Pankki", ["S-Pankki", "s pankki"]],
    ["saastopankki-fi", "Säästöpankki", ["Säästöpankki", "Saastopankki"]],
    ["omasp-fi", "Oma Säästöpankki", ["Oma Säästöpankki", "OmaSp"]],
    ["pop-fi", "POP Pankki", ["POP Pankki", "POP"]],
    ["aktia-fi", "Aktia", ["Aktia"]],
    ["alandsbanken-fi", "Ålandsbanken", ["Ålandsbanken", "Alandsbanken Abp"]],
    ["bank-norwegian-fi", "Bank Norwegian", ["Bank Norwegian"]],
    ["resurs-fi", "Resurs Bank", ["Resurs Bank", "Resurs"]],
    ["morrow-fi", "Morrow Bank", ["Morrow Bank", "Komplett Bank"]],
    ["eurocard-fi", "Eurocard", ["Eurocard"]],
    ["finnair-plus-fi", "Finnair Plus Mastercard", ["Finnair Plus Mastercard", "Finnair Plus MC"]],
    ["sas-eurobonus-fi", "SAS EuroBonus Mastercard", ["SAS EuroBonus Mastercard", "SAS EuroBonus MC"]],
    ["holvi-fi", "Holvi", ["Holvi"]],
    ["revolut-fi", "Revolut", ["Revolut"]],
  ];
  const offered = ALL.map(([id, name]) => ({ id, name, country: "FI" }));

  it("has the names of every bank the server can start, so a bank added there is found by a consent too", () => {
    // read from the server's file: the web app keeps its own names (the offered list has no aliases and only the banks the live list has)
    const source = readFileSync(new URL("../../server/src/connectors/enable-banking/banks.ts", import.meta.url), "utf8");
    const server = [...source.matchAll(/^\s*fi\("([a-z-]+)", "([^"]+)"/gm)].map((m) => ({ id: m[1]!, name: m[2]! }));
    expect(server.length).toBeGreaterThan(10);
    expect(ALL.map(([id, name]) => ({ id, name }))).toEqual(server);
    // a list that offers the bank under a name of nothing finds it through the web app's own names alone
    for (const { id, name } of server) expect(bankIdForInstitution([{ id, name: "-" }], name), id).toBe(id);
  });

  it("finds every bank of the list by each name Enable Banking may report", () => {
    for (const [id, , reported] of ALL) for (const name of reported) expect(bankIdForInstitution(offered, name), name).toBe(id);
  });

  it("does not take one bank for another whose name it holds", () => {
    // POP Pankki holds the letters of OP, Oma Säästöpankki the name of Säästöpankki
    const without = (id: string) => offered.filter((b) => b.id !== id);
    expect(bankIdForInstitution(without("pop-fi"), "POP Pankki")).toBeNull();
    expect(bankIdForInstitution(without("omasp-fi"), "Oma Säästöpankki")).toBeNull();
    expect(bankIdForInstitution(offered, "Shop Bank")).toBeNull();
  });
});

describe("logos", () => {
  it("has Nordea's artwork and none yet for the others, by id and by the name of a consent", () => {
    expect(bankLogo("nordea-fi")).toBe("/banks/nordea.png");
    expect(logoForInstitution("Nordea Bank Abp", [])).toBe("/banks/nordea.png");
    for (const id of ["op-fi", "s-pankki-fi", "revolut-fi", "unknown"]) expect(bankLogo(id), id).toBeNull();
    for (const name of ["OP", "S-Pankki", "Oma Säästöpankki", "Tuntematon pankki", ""]) expect(logoForInstitution(name, []), name).toBeNull();
  });
});

const conn = (id: string, state: Connection["state"], daysLeft: number | null, extra: Partial<Connection> = {}): Connection => ({
  id,
  institution: "Nordea",
  status: state === "active" ? "active" : "expired",
  state,
  history: false,
  replaced: false,
  validUntil: "2026-12-01T00:00:00Z",
  createdAt: "2026-06-01T00:00:00Z",
  lastSyncedAt: null,
  daysLeft,
  ...extra,
});

const TODAY = "2026-10-12";
const meta = (connections: Connection[], configured = true, accounts: Partial<Account>[] = [], role = "member", source = "instance") =>
  ({ today: TODAY, user: { role }, bank: { configured, banks: BANKS, redirectMode: "own", source }, connections, accounts }) as unknown as Meta;
const html = (connections: Connection[], configured?: boolean, accounts: Partial<Account>[] = [], connected?: number | null, role?: string, source?: string) =>
  renderToStaticMarkup(createElement(BankConnections, { meta: meta(connections, configured, accounts, role, source), pickerOpen: false, connected, onChange: () => {}, onMessage: () => {} }));
const renews = (out: string) => out.split("Yhdistä uudelleen").length - 1;

describe("Pankkiyhteydet: Yhdistä uudelleen", () => {
  it("is on every connection, before it ends too", () => {
    expect(renews(html([conn("a", "lapsed", null)]))).toBe(1);
    expect(renews(html([conn("a", "broken", null)]))).toBe(1);
    expect(renews(html([conn("a", "active", 3)]))).toBe(1);
    expect(renews(html([conn("a", "active", 15)]))).toBe(1);
    expect(renews(html([conn("a", "active", 93)]))).toBe(1);
    // each row has its own
    expect(renews(html([conn("a", "lapsed", null), conn("b", "active", 93), conn("c", "active", 5)]))).toBe(3);
  });

  it("is not on a connection that was removed", () => {
    expect(renews(html([conn("a", "removed", null)]))).toBe(0);
  });

  it("an expiring connection keeps Poista beside it", () => {
    const out = html([conn("a", "active", 5)]);
    expect(out).toContain("Poista");
    expect(out).toContain("vanhenee pian");
  });

  it("gives the phone layout to the table, with a label on every cell that has a column head", () => {
    const out = html([conn("a", "active", 93)]);
    expect(out.match(/<table class="conn-table"/g)).toHaveLength(1);
    expect(out).toContain('data-label="Tila"');
    expect(out).toContain('data-label="Haettu"');
  });

  it("lists no earlier consents: two that own no account are left out, and one whose date passed keeps its renewal", () => {
    const earlier = [conn("h1", "broken", null, { history: true, institution: "Aktia" }), conn("h2", "lapsed", null, { history: true, institution: "Holvi" })];
    const out = html([conn("a", "lapsed", null, { validUntil: "2026-09-01T00:00:00Z" }), ...earlier]);
    expect(out).not.toContain("Aiemmat yhteydet");
    expect(out).not.toContain("Poista listalta");
    expect(out).not.toContain("Aktia");
    expect(out).not.toContain("Holvi");
    expect(out.match(/<table class="conn-table"/g)).toHaveLength(1);
    // the one that still owns its accounts shows its end and the way to renew
    expect(out).toContain("vanhentui 1.9.2026");
    expect(renews(out)).toBe(1);
  });
});

describe("Pankkiyhteydet: when the consent ends", () => {
  it("says it in words, with the date and, in the last month, the days left", () => {
    expect(html([conn("a", "active", 93, { validUntil: "2027-01-14T00:00:00Z" })])).toContain("voimassa 14.1.2027 asti");
    expect(html([conn("a", "active", 93, { validUntil: "2027-01-14T00:00:00Z" })])).not.toContain("vielä 93");
    expect(html([conn("a", "active", 1, { validUntil: "2026-10-13T00:00:00Z" })])).toContain("voimassa 13.10.2026 asti, vielä 1 päivä");
    expect(html([conn("a", "active", 0, { validUntil: "2026-10-12T00:00:00Z" })])).toContain("voimassa enää tänään");
  });

  it("an ended consent keeps its own words, and there is no second column for the date", () => {
    const out = html([conn("a", "lapsed", null, { validUntil: "2026-09-01T00:00:00Z" }), conn("b", "broken", null)]);
    expect(out).toContain("vanhentui 1.9.2026");
    expect(out).toContain("katkesi");
    expect(out).not.toContain("voimassa");
    expect(out).not.toContain("<th>Voimassa</th>");
  });

  it("offers the calendar reminder while its day has not passed, and not on an ended consent", () => {
    const out = html([conn("a", "active", 93, { validUntil: "2027-01-14T00:00:00Z" })]);
    expect(out).toContain("Muistutus kalenteriin");
    expect(out).toContain("7.1.2027");
    // the reminder day was 10.10.: the renewal button is the way
    expect(html([conn("a", "active", 5, { validUntil: "2026-10-17T00:00:00Z" })])).not.toContain("Muistutus kalenteriin");
    expect(html([conn("a", "lapsed", null)])).not.toContain("Muistutus kalenteriin");
  });
});

const account = (id: string, connectionId: string, extra: Partial<Account> = {}): Partial<Account> => ({
  id,
  connectionId,
  name: id,
  bankName: id,
  iban: null,
  cardMask: null,
  lastSyncedAt: "2026-10-12T06:00:00Z",
  problem: null,
  ...extra,
});
const notLinked = { kind: "not_linked", message: "tiliä ei ole linkitetty Enable Bankingissa." } as const;

describe("Pankkiyhteydet: accounts that are not linked in the Control Panel", () => {
  const cs = [conn("c", "active", 93)];

  it("says nothing when every account is read", () => {
    expect(html(cs, true, [account("Käyttötili", "c"), account("Nordea Gold", "c", { cardMask: "•••• 1144" })])).not.toContain("Enable Bankingissa.");
  });

  it("names one account by the bank's name and the last four digits, and the one step", () => {
    const out = html(cs, true, [account("Käyttötili", "c", { iban: "FI2112345600000785", problem: notLinked }), account("Nordea Gold", "c")], undefined, "admin");
    expect(out).toContain("Yksi tili ei ole linkitetty Enable Bankingissa.");
    expect(out).toContain("<li>Käyttötili · •••• 0785</li>");
    expect(out).not.toContain("Nordea Gold ·");
    expect(out).toContain("Linkitä se Control Panelissa (API applications &gt; Omatalous &gt; Link accounts). Paina sen jälkeen Hae nyt.");
    expect(out).toContain('href="https://enablebanking.com/cp/applications"');
  });

  it("lists three accounts, each once, and tells a member to ask the administrator", () => {
    const accounts = [
      account("Käyttötili", "c", { iban: "FI2112345600000785", problem: notLinked }),
      account("Nordea Gold", "c", { cardMask: "•••• 1144", problem: notLinked }),
      account("Säästötili", "c", { iban: "FI4950009420028730", problem: notLinked }),
    ];
    const out = html(cs, true, accounts);
    expect(out).toContain("3 tiliä ei ole linkitetty Enable Bankingissa.");
    expect(out.match(/<li>/g)).toHaveLength(3);
    expect(out).toContain("<li>Nordea Gold · •••• 1144</li>");
    expect(out).toContain("<li>Säästötili · •••• 8730</li>");
    expect(out).toContain("Ylläpitäjä linkittää ne Control Panelissa (API applications &gt; Omatalous &gt; Link accounts). Paina sen jälkeen Hae nyt.");
    expect(out).not.toContain("Avaa Control Panel");
  });

  it("a member with an own key can open the Control Panel, and with two banks each line carries the bank's name", () => {
    const two = [conn("c", "active", 93), conn("d", "active", 90, { institution: "OP" })];
    const out = html(two, true, [account("Käyttötili", "c", { problem: notLinked }), account("OP-tili", "d", { problem: notLinked })], undefined, "member", "user");
    expect(out).toContain("<li>Nordea · Käyttötili</li>");
    expect(out).toContain("<li>OP · OP-tili</li>");
    expect(out).toContain("Avaa Control Panel");
  });
});

describe("Pankkiyhteydet: the add button", () => {
  it("reads Yhdistä pankki, with a connection or without", () => {
    for (const connections of [[], [conn("a", "active", 90)], [conn("a", "lapsed", null)]]) {
      const out = html(connections);
      expect(out).toContain("Yhdistä pankki");
      expect(out).not.toContain("Yhdistä toinen pankki");
      expect(out).not.toContain("Lisää seuraava tili");
    }
  });

  it("reads Yhdistä toinen pankki after a bank brought accounts, and not after one that brought none", () => {
    const out = html([conn("a", "active", 90)], true, [account("Käyttötili", "a", { lastSyncedAt: null })], 2);
    expect(out).toMatch(/<button[^>]*btn-primary[^>]*>Yhdistä toinen pankki<\/button>/);
    expect(out).not.toContain("Yhdistä pankki");
    const none = html([conn("a", "active", 90)], true, [], 0);
    expect(none).toContain("Yhdistä pankki");
    expect(none).not.toContain("Yhdistä toinen pankki");
  });
});
