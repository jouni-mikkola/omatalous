import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { bankIdForInstitution, bankLogo, logoForInstitution } from "../src/banks.ts";
import { waitsForFirstFetch } from "../src/first-fetch.ts";
import { Accounts } from "../src/pages/settings/Accounts.tsx";
import { BankConnections, connectionStateText, renewalLine } from "../src/pages/settings/BankConnections.tsx";
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
  needsRenewal: state === "lapsed" || state === "broken",
  ...extra,
});

const TODAY = "2026-10-12";
const meta = (connections: Connection[], configured = true, accounts: Partial<Account>[] = [], role = "member", source = "instance") =>
  ({ today: TODAY, user: { role }, bank: { configured, banks: BANKS, redirectMode: "own", source }, connections, accounts, renewal: { due: [], round: null } }) as unknown as Meta;
const html = (connections: Connection[], configured?: boolean, accounts: Partial<Account>[] = [], connected?: number | null, role?: string, source?: string) =>
  renderToStaticMarkup(createElement(BankConnections, { meta: meta(connections, configured, accounts, role, source), pickerOpen: false, connected, onChange: () => {}, onMessage: () => {} }));
const renews = (out: string) => out.split("Yhdistä uudelleen").length - 1;
const count = (out: string, text: string) => out.split(text).length - 1;

describe("Pankkiyhteydet with no connection", () => {
  it("says so in the one empty line of the app, and does not say again what the button says", () => {
    const out = html([]);
    expect(out).toContain('<div class="empty">Ei pankkiyhteyksiä.</div>');
    expect(out).not.toContain("niin haemme");
  });
});

describe("Pankkiyhteydet: a row names its bank in words", () => {
  it("has the bank's name and no picture, for a bank that has artwork too", () => {
    const out = html([conn("a", "active", 40)]);
    expect(out).toContain('<span class="bank-cell">Nordea</span>');
    expect(out).not.toContain("<img");
  });

  it("has the name and no picture in the round that renews every consent", () => {
    const round = { consents: [{ connection: "a", bank: "nordea-fi", done: false }], finished: false };
    const out = renderToStaticMarkup(
      createElement(BankConnections, { meta: { ...meta([conn("a", "active", 5)]), renewal: { due: [], round } } as Meta, pickerOpen: false, onChange: () => {}, onMessage: () => {} }),
    );
    expect(out).toContain("<li>Nordea<span");
    expect(out).not.toContain("<img");
  });
});

describe("Pankkiyhteydet: Yhdistä uudelleen", () => {
  it("is on every connection, before it ends too", () => {
    expect(renews(html([conn("a", "lapsed", null)]))).toBe(1);
    expect(renews(html([conn("a", "broken", null)]))).toBe(1);
    expect(renews(html([conn("a", "active", 3)]))).toBe(1);
    expect(renews(html([conn("a", "active", 15)]))).toBe(1);
    expect(renews(html([conn("a", "active", 93)]))).toBe(1);
    // one for the bank, however many consents it has, and one for each bank
    expect(renews(html([conn("a", "lapsed", null), conn("b", "active", 93), conn("c", "active", 5)]))).toBe(1);
    expect(renews(html([conn("a", "active", 93), conn("b", "active", 93, { institution: "OP" })]))).toBe(2);
  });

  it("is not on a connection that was removed", () => {
    expect(renews(html([conn("a", "removed", null)]))).toBe(0);
  });

  it("an expiring connection says so and has its one Poista", () => {
    const out = html([conn("a", "active", 5)]);
    expect(count(out, ">Poista</button>")).toBe(1);
    expect(out).toContain("vanhenee pian");
  });

  it("gives a label to every cell that has a column head, for the block a phone makes of the row", () => {
    const out = html([conn("a", "active", 93)]);
    expect(out.match(/<table class="rt/g)).toHaveLength(1);
    expect(out).toContain('data-label="Tila"');
    expect(out).toContain('data-label="Päivitetty"');
  });

  it("lists no earlier consents: two that own no account are left out, and one whose date passed keeps its renewal", () => {
    const earlier = [conn("h1", "broken", null, { history: true, institution: "Aktia" }), conn("h2", "lapsed", null, { history: true, institution: "Holvi" })];
    const out = html([conn("a", "lapsed", null, { validUntil: "2026-09-01T00:00:00Z" }), ...earlier]);
    expect(out).not.toContain("Aiemmat yhteydet");
    expect(out).not.toContain("Poista listalta");
    expect(out).not.toContain("Aktia");
    expect(out).not.toContain("Holvi");
    expect(out.match(/<table class="rt/g)).toHaveLength(1);
    // the one that still owns its accounts shows its end and the way to renew
    expect(out).toContain("vanhentui 1.9.");
    expect(renews(out)).toBe(1);
  });
});

describe("Pankkiyhteydet: when the consent ends", () => {
  it("says it in words, with the date and, in the last month, the days left", () => {
    expect(html([conn("a", "active", 93, { validUntil: "2027-01-14T00:00:00Z" })])).toContain("voimassa 14.1.2027 asti");
    expect(html([conn("a", "active", 93, { validUntil: "2027-01-14T00:00:00Z" })])).not.toContain("vielä 93");
    expect(html([conn("a", "active", 1, { validUntil: "2026-10-13T00:00:00Z" })])).toContain("voimassa 13.10. asti, vielä 1 päivä");
    expect(html([conn("a", "active", 0, { validUntil: "2026-10-12T00:00:00Z" })])).toContain("voimassa enää tänään");
  });

  it("an ended consent keeps its own words, and there is no second column for the date", () => {
    const out = html([conn("a", "lapsed", null, { validUntil: "2026-09-01T00:00:00Z" }), conn("b", "broken", null)]);
    expect(out).toContain("vanhentui 1.9.");
    expect(out).toContain("katkesi");
    expect(out).not.toContain("voimassa");
    expect(out).not.toContain("<th>Voimassa</th>");
  });

  it("offers the calendar reminder while its day has not passed, and not on an ended consent", () => {
    const out = html([conn("a", "active", 93, { validUntil: "2027-01-14T00:00:00Z" })]);
    expect(out).toContain("Lisää muistutus kalenteriin");
    expect(out).toContain("7.1.2027");
    // the reminder day was 10.10.: the renewal button is the way
    expect(html([conn("a", "active", 5, { validUntil: "2026-10-17T00:00:00Z" })])).not.toContain("Lisää muistutus kalenteriin");
    expect(html([conn("a", "lapsed", null)])).not.toContain("Lisää muistutus kalenteriin");
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
const notLinked = { kind: "not_linked", message: "tiliä ei ole lisätty Enable Bankingissa." } as const;

describe("Pankkiyhteydet: one row per bank", () => {
  // a row names its bank once
  const rowsOf = (out: string) => count(out, 'class="bank-cell"');
  const JAN = "2027-01-14T00:00:00Z";
  const MAR = "2027-03-20T00:00:00Z";

  it("a bank with one consent is one row with its accounts, its end day printed once and one reminder", () => {
    const out = html([conn("a", "active", 93, { validUntil: JAN })], true, [account("Käyttötili", "a", { iban: "FI2112345600000785" }), account("Säästötili", "a", { iban: "FI4950009420028730" })]);
    expect(rowsOf(out)).toBe(1);
    expect(count(out, "voimassa 14.1.2027 asti")).toBe(1);
    // the end day is in the row alone: no sentence repeats it
    expect(count(out, "14.1.2027")).toBe(1);
    expect(out).not.toContain("Seuraava vanhenee");
    expect(count(out, "Lisää muistutus kalenteriin")).toBe(1);
    expect(count(out, 'aria-label="Lisää muistutus kalenteriin 7.1.2027"')).toBe(1);
    expect(renews(out)).toBe(1);
    // one consent reads both accounts: the bank has one Poista, named by the bank
    expect(count(out, ">Poista</button>")).toBe(1);
    expect(count(out, 'aria-label="Poista pankkiyhteys: Nordea"')).toBe(1);
    expect(out).not.toContain("conn-own-state");
  });

  it("consents of one bank that end the same day are one row: one end day, one reminder, one Poista for the bank", () => {
    const consents = ["a", "b", "c"].map((id) => conn(id, "active", 93, { validUntil: JAN }));
    const out = html(consents, true, [account("Käyttötili", "a"), account("Säästötili", "b"), account("Nordea Gold", "c")]);
    expect(rowsOf(out)).toBe(1);
    expect(count(out, '<span class="bank-cell">Nordea</span>')).toBe(1);
    expect(count(out, "voimassa 14.1.2027 asti")).toBe(1);
    expect(count(out, "Lisää muistutus kalenteriin")).toBe(1);
    expect(renews(out)).toBe(1);
    expect(count(out, "14.1.2027")).toBe(1);
    expect(count(out, ">Poista</button>")).toBe(1);
    expect(out).not.toContain("conn-own-state");
  });

  it("consents that end on different days: the row has the earliest day and its reminder, and the other account says its own day", () => {
    // the later consent is first in the answer: the order does not pick the day
    const out = html([conn("b", "active", 159, { validUntil: MAR }), conn("a", "active", 93, { validUntil: JAN })], true, [account("Käyttötili", "a"), account("Säästötili", "b")]);
    expect(rowsOf(out)).toBe(1);
    expect(count(out, "Lisää muistutus kalenteriin")).toBe(1);
    expect(out).toContain("7.1.2027");
    expect(count(out, "conn-own-state")).toBe(1);
    expect(out).toMatch(/Säästötili<\/div><div class="[^"]*conn-own-state">voimassa 20\.3\.2027 asti<\/div>/);
    expect(count(out, "voimassa 14.1.2027 asti")).toBe(1);
  });

  it("banks that end on different days give the reminder button to the row of the first one, and no sentence", () => {
    const consents = [conn("a", "active", 159, { validUntil: MAR }), conn("o", "active", 93, { validUntil: JAN, institution: "OP" })];
    const out = html(consents, true, [account("Käyttötili", "a"), account("OP-tili", "o")]);
    expect(rowsOf(out)).toBe(2);
    expect(out).not.toContain("Seuraava vanhenee");
    expect(count(out, "Lisää muistutus kalenteriin")).toBe(1);
    // the button sits in the OP row, which is the second one
    expect(out.indexOf("Lisää muistutus kalenteriin")).toBeGreaterThan(out.indexOf('<span class="bank-cell">OP</span>'));
    expect(count(out, "14.1.2027")).toBe(1);
    expect(count(out, "20.3.2027")).toBe(1);
    expect(count(out, "voimassa 14.1.2027 asti")).toBe(1);
    expect(count(out, "voimassa 20.3.2027 asti")).toBe(1);
    expect(count(out, ">Poista</button>")).toBe(2);
    // an ended consent has no day to come
    expect(html([conn("a", "lapsed", null, { validUntil: "2026-09-01T00:00:00Z" })])).not.toContain("Seuraava vanhenee");
  });

  it("an ended consent beside an active one of its bank says so on its account, and two banks stay two rows", () => {
    const consents = [conn("a", "active", 93, { validUntil: JAN }), conn("b", "lapsed", null, { validUntil: "2026-09-01T00:00:00Z", replaced: true }), conn("o", "active", 93, { validUntil: JAN, institution: "OP" })];
    const out = html(consents, true, [account("Käyttötili", "a"), account("Vanha tili", "b"), account("OP-tili", "o")]);
    expect(rowsOf(out)).toBe(2);
    expect(out).toMatch(/Vanha tili<\/div><div class="[^"]*conn-own-state">vanhentui 1\.9\.<\/div>/);
    // one Poista for each bank row, Nordea and OP; the ended consent adds none
    expect(count(out, ">Poista</button>")).toBe(2);
  });
});

describe("Tilit: the form of an account", () => {
  const full = (id: string, connectionId: string | null, extra: Partial<Account> = {}) => ({ ...account(id, connectionId ?? "", extra), connectionId, userId: "u1", holder: null, creditLimitCents: null, customName: null, currency: "EUR", type: "checking", provider: "enablebanking", balanceCents: null, balanceAt: null }) as unknown as Account;
  const markup = (accounts: Account[]) =>
    renderToStaticMarkup(
      createElement(Accounts, {
        meta: { today: TODAY, user: { id: "u1", role: "member" }, members: [{ id: "u1", displayName: "Matti" }], shares: [], bank: { configured: true, banks: BANKS, redirectMode: "own", source: "user" }, connections: [conn("a", "active", 93)], accounts, renewal: { due: [], round: null } } as unknown as Meta,
        onChange: () => {},
      }),
    );

  it("has Muokkaa on every row and no bank connection to remove on a row", () => {
    const out = markup([full("Käyttötili", "a"), full("Tuotu tili", null, { provider: "csv" })]);
    expect(out).not.toContain("pankkiyhteys");
    expect(count(out, "data-edit=")).toBe(2);
  });

  it("tells accounts of one name apart by the last four digits, and leaves a name alone that nothing else has", () => {
    const out = markup([full("a1", "a", { name: "Käyttötili", iban: "FI2112345600000785" }), full("a2", "a", { name: "Käyttötili", iban: "FI4950009420028730" }), full("a3", "a", { name: "Säästötili", iban: "FI1410093000123458" })]);
    expect(out).toContain('<div class="acc-name">Käyttötili •••• 0785</div>');
    expect(out).toContain('<div class="acc-name">Käyttötili •••• 8730</div>');
    expect(out).toContain('<div class="acc-name">Säästötili</div>');
  });
});

describe("Pankkiyhteydet: accounts that are not linked in the Control Panel", () => {
  const cs = [conn("c", "active", 93)];

  it("says nothing when every account is read", () => {
    expect(html(cs, true, [account("Käyttötili", "c"), account("Nordea Gold", "c", { cardMask: "•••• 1144" })])).not.toContain("Enable Bankingissa.");
  });

  it("names one account by the bank's name and the last four digits, and the one step", () => {
    const out = html(cs, true, [account("Käyttötili", "c", { iban: "FI2112345600000785", problem: notLinked }), account("Nordea Gold", "c")], undefined, "admin");
    expect(out).toContain("Yksi tili puuttuu Enable Bankingista.");
    expect(out).toContain("<li>Käyttötili · •••• 0785</li>");
    expect(out).not.toContain("Nordea Gold ·");
    expect(out).toContain("Lisää se Control Panelissa (API applications &gt; Omatalous &gt; Link accounts). Paina sen jälkeen Hae nyt.");
    expect(out).toContain('href="https://enablebanking.com/cp/applications"');
  });

  it("lists three accounts, each once, and tells a member to ask the administrator", () => {
    const accounts = [
      account("Käyttötili", "c", { iban: "FI2112345600000785", problem: notLinked }),
      account("Nordea Gold", "c", { cardMask: "•••• 1144", problem: notLinked }),
      account("Säästötili", "c", { iban: "FI4950009420028730", problem: notLinked }),
    ];
    const out = html(cs, true, accounts);
    expect(out).toContain("3 tiliä puuttuu Enable Bankingista.");
    expect(out.match(/<li>/g)).toHaveLength(3);
    expect(out).toContain("<li>Nordea Gold · •••• 1144</li>");
    expect(out).toContain("<li>Säästötili · •••• 8730</li>");
    expect(out).toContain("Ylläpitäjän pitää lisätä ne Control Panelissa (API applications &gt; Omatalous &gt; Link accounts). Paina sen jälkeen Hae nyt.");
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

describe("Pankkiyhteydet: when the page looks again after a link", () => {
  const conn = (id: string, state: Connection["state"] = "active") => ({ id, state });
  const acc = (connectionId: string, over: Partial<Pick<Account, "lastSyncedAt" | "problem">> = {}) => ({ connectionId, lastSyncedAt: null, problem: null, ...over });
  it("waits for an active consent that lists no account yet, or one not fetched", () => {
    expect(waitsForFirstFetch([conn("a")], [])).toBe(true);
    expect(waitsForFirstFetch([conn("a")], [acc("a")])).toBe(true);
  });
  it("stops once every account has an answer, and for a consent that is not active", () => {
    expect(waitsForFirstFetch([conn("a")], [acc("a", { lastSyncedAt: "2026-10-08T09:30:00.000Z" })])).toBe(false);
    expect(waitsForFirstFetch([conn("a")], [acc("a", { problem: { kind: "failed", message: "x" } })])).toBe(false);
    expect(waitsForFirstFetch([conn("a", "lapsed")], [])).toBe(false);
    expect(waitsForFirstFetch([], [])).toBe(false);
  });
});

describe("Pankkiyhteydet: a consent that ended", () => {
  it("says why on the row of a lapsed or a broken consent, and nowhere else", () => {
    expect(renewalLine(conn("a", "lapsed", null))).toBe("Pankin yhteys päättyi.");
    expect(renewalLine(conn("b", "broken", null))).toBe("Pankin yhteys päättyi.");
    expect(renewalLine(conn("c", "active", 40))).toBeNull();
    // a newer consent of the bank has the accounts: no reconnect is asked for
    expect(renewalLine(conn("d", "lapsed", null, { replaced: true }))).toBeNull();
  });
});

describe("Pankkiyhteydet: the Tila words of an ended consent", () => {
  it("keeps vanhentui with its date once the date has passed, and says päättynyt without a date before it", () => {
    expect(connectionStateText(conn("a", "lapsed", null, { validUntil: "2026-10-01T00:00:00Z" }), "2026-10-16")).toMatch(/^vanhentui \d/);
    expect(connectionStateText(conn("a", "lapsed", null, { validUntil: "2027-04-14T00:00:00Z" }), "2026-10-16")).toBe("päättynyt");
    expect(connectionStateText(conn("b", "broken", null), "2026-10-16")).toBe("katkesi");
  });
});

describe("Pankkiyhteydet: the round that renews every consent", () => {
  const BOTH = [...BANKS, { id: "op-fi", name: "OP", country: "FI" }];
  const withRenewal = (renewal: Meta["renewal"], accounts: Partial<Account>[] = []) =>
    renderToStaticMarkup(
      createElement(BankConnections, { meta: { ...meta([conn("a", "active", 5)], true, accounts), bank: { configured: true, banks: BOTH, redirectMode: "own", source: "instance" }, renewal } as Meta, pickerOpen: false, onChange: () => {}, onMessage: () => {} }),
    );
  const nordea = { connection: "a", bank: "nordea-fi" };
  const op = { connection: "b", bank: "op-fi" };

  it("is offered from two consents that are due, by name, and not from one", () => {
    expect(withRenewal({ due: [nordea, op], round: null })).toContain("Yhteys päättyy tai on päättynyt: Nordea, OP.");
    expect(withRenewal({ due: [nordea, op], round: null })).toContain("Uusi kaikki yhteydet");
    expect(withRenewal({ due: [nordea], round: null })).not.toContain("Uusi kaikki yhteydet");
  });

  it("tells two consents of one bank apart by their accounts", () => {
    const accounts = [{ id: "x", name: "Käyttötili", connectionId: "a" }, { id: "y", name: "Säästötili", connectionId: "c" }];
    const out = withRenewal({ due: [nordea, { connection: "c", bank: "nordea-fi" }], round: null }, accounts);
    expect(out).toContain("Nordea (Käyttötili), Nordea (Säästötili)");
  });

  it("lists each consent as renewed or left, with the next press naming the first left", () => {
    const out = withRenewal({ due: [nordea, op], round: { consents: [{ ...nordea, done: true }, { ...op, done: false }], finished: false } });
    expect(out).toContain("1 / 2 uusittu");
    expect(out).toContain("uusittu</span>");
    expect(out).toContain("odottaa</span>");
    expect(out).toContain("Uusi OP");
    expect(out).toContain("Lopeta kierros");
  });

  it("says so when every consent is done, and offers only to close it", () => {
    const out = withRenewal({ due: [], round: { consents: [{ ...nordea, done: true }, { ...op, done: true }], finished: true } });
    expect(out).toContain("Uusit kaikki yhteydet.");
    expect(out).toContain("Sulje");
    expect(out).not.toContain("Uusi OP");
  });
});
