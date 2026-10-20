/**
 * The bank picker: one bank, three, seventeen, the search, an empty list and a renewal that finds its bank by
 * name. And the logos the server serves: where a bank's picture comes from and what the plate shows meanwhile.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bankLogo, logoForInstitution } from "../src/banks.ts";
import { BankLogo, plateShows } from "../src/components/BankLogo.tsx";
import { BankPicker, hasOtherBanks, lastUsedBank, orderBanks, searchBanks } from "../src/components/BankPicker.tsx";
import { renewalBank } from "../src/pages/settings/BankConnections.tsx";
import type { BankOption } from "../src/types.ts";

const NAMES: [string, string][] = [
  ["nordea-fi", "Nordea"],
  ["op-fi", "OP"],
  ["danske-fi", "Danske Bank"],
  ["s-pankki-fi", "S-Pankki"],
  ["saastopankki-fi", "Säästöpankki"],
  ["omasp-fi", "Oma Säästöpankki"],
  ["pop-fi", "POP Pankki"],
  ["aktia-fi", "Aktia"],
  ["alandsbanken-fi", "Ålandsbanken"],
  ["bank-norwegian-fi", "Bank Norwegian"],
  ["resurs-fi", "Resurs Bank"],
  ["morrow-fi", "Morrow Bank"],
  ["eurocard-fi", "Eurocard"],
  ["finnair-plus-fi", "Finnair Plus Mastercard"],
  ["sas-eurobonus-fi", "SAS EuroBonus Mastercard"],
  ["holvi-fi", "Holvi"],
  ["revolut-fi", "Revolut"],
];
const banks = (n: number): BankOption[] => NAMES.slice(0, n).map(([id, name]) => ({ id, name, country: "FI" }));
const ids = (list: readonly { id: string }[]) => list.map((b) => b.id);

const render = (list: BankOption[], extra: Partial<Parameters<typeof BankPicker>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(BankPicker, { banks: list, lastUsed: null, starting: null, disabled: false, isAdmin: true, focusSignal: 0, onPick: () => {}, onClose: () => {}, ...extra }),
  );
const tiles = (out: string) => [...out.matchAll(/aria-label="Yhdistä ([^"]+)"/g)].map((m) => m[1]);

describe("the picker with one bank", () => {
  const out = render(banks(1));
  it("shows that bank, with its logo, and no search", () => {
    expect(tiles(out)).toEqual(["Nordea"]);
    expect(out).toContain('src="/banks/nordea.png"');
    expect(out).not.toContain('type="search"');
    expect(out).not.toContain("Viimeksi käytetty");
  });
  it("has no line about other banks while Nordea is the only one", () => {
    expect(hasOtherBanks(banks(1))).toBe(false);
    expect(out).not.toContain("pankin omien koodien");
  });
});

describe("the picker with three banks", () => {
  const out = render(banks(3), { lastUsed: "danske-fi" });
  it("lists every bank, the one used last first and marked, and has no search", () => {
    expect(tiles(out)).toEqual(["Danske Bank", "Nordea", "OP"]);
    expect(out.match(/Viimeksi käytetty/g)).toHaveLength(1);
    expect(out).not.toContain('type="search"');
  });
  it("puts a name on a plain plate where a bank has no artwork, and the logo where there is one", () => {
    expect(out).toContain('<span class="bank-logo bank-logo-tile bank-logo-text">OP</span>');
    expect(out).toContain('src="/banks/nordea.png"');
  });
  it("tells that other banks are sorted by their own codes", () => {
    expect(out).toContain("Muiden pankkien kuin Nordean tapahtumat luokitellaan pankin omien koodien mukaan. Tarkista ensimmäisen kuukauden kategoriat.");
  });
});

describe("the picker with seventeen banks", () => {
  const out = render(banks(17));
  it("has a search field and every bank as a button", () => {
    expect(out).toContain('type="search"');
    expect(out).toContain('aria-label="Hae pankkia"');
    expect(tiles(out)).toHaveLength(17);
    expect(tiles(out)).toContain("SAS EuroBonus Mastercard");
  });
  it("has the search from the ninth bank on, not before", () => {
    expect(render(banks(8))).not.toContain('type="search"');
    expect(render(banks(9))).toContain('type="search"');
  });
  it("marks the bank being started and turns every tile off meanwhile", () => {
    const busy = render(banks(3), { starting: "op-fi", disabled: true });
    expect(busy).toContain("Avataan…");
    expect([...busy.matchAll(/<button[^>]*bank-tile[^>]*>/g)].every((m) => m[0].includes("disabled"))).toBe(true);
  });
});

describe("searching banks", () => {
  const all = banks(17);
  it("matches a part of the name without case, accents, spaces or hyphens", () => {
    expect(ids(searchBanks(all, "säästö"))).toEqual(["saastopankki-fi", "omasp-fi"]);
    expect(ids(searchBanks(all, "saasto"))).toEqual(["saastopankki-fi", "omasp-fi"]);
    expect(ids(searchBanks(all, "s pankki"))).toEqual(["s-pankki-fi"]);
    expect(ids(searchBanks(all, "ALANDS"))).toEqual(["alandsbanken-fi"]);
    expect(ids(searchBanks(all, "master"))).toEqual(["finnair-plus-fi", "sas-eurobonus-fi"]);
  });
  it("gives every bank for an empty search and none for a name nobody has", () => {
    expect(searchBanks(all, "  ")).toHaveLength(17);
    expect(searchBanks(all, "xyz")).toEqual([]);
  });
});

describe("the order of the banks", () => {
  it("puts the bank used last first and keeps the server's order for the rest", () => {
    expect(ids(orderBanks(banks(4), "s-pankki-fi"))).toEqual(["s-pankki-fi", "nordea-fi", "op-fi", "danske-fi"]);
    expect(ids(orderBanks(banks(4), null))).toEqual(ids(banks(4)));
    expect(ids(orderBanks(banks(2), "revolut-fi"))).toEqual(ids(banks(2)));
  });
  it("takes the bank of the newest consent that is on the list, also one that ended", () => {
    const list = banks(5);
    const consent = (institution: string, createdAt: string) => ({ institution, createdAt });
    expect(lastUsedBank([consent("Nordea", "2026-01-01T00:00:00Z"), consent("OP", "2026-05-01T00:00:00Z")], list)).toBe("op-fi");
    // the newest consent is of a bank that is not offered: the next one counts
    expect(lastUsedBank([consent("Nordea", "2026-01-01T00:00:00Z"), consent("Revolut", "2026-05-01T00:00:00Z")], list)).toBe("nordea-fi");
    expect(lastUsedBank([], list)).toBeNull();
  });
});

describe("the picker with no bank", () => {
  it("says what is wrong and sends an admin to the application in Asetukset > Palvelin", () => {
    const out = render([], { isAdmin: true });
    expect(out).toContain("ei ole pankkeja, joita Omatalous tukee");
    expect(out).toContain('href="#/settings?section=server"');
    expect(out).not.toContain("bank-grid");
    expect(out).not.toContain('type="search"');
  });
  it("tells a member to ask the admin, with no link", () => {
    const out = render([], { isAdmin: false });
    expect(out).toContain("Ylläpitäjän pitää tarkistaa sovellus kohdassa Asetukset");
    expect(out).not.toContain("href=");
  });
});

describe("a renewal", () => {
  const all = banks(17);
  it("finds its bank by the name the bank reported and starts it without the picker", () => {
    expect(renewalBank(all, "Nordea Bank Abp", true)).toBe("nordea-fi");
    expect(renewalBank(all, "Oma Säästöpankki", true)).toBe("omasp-fi");
    expect(renewalBank(all, "Säästöpankki", true)).toBe("saastopankki-fi");
    expect(renewalBank(all, "S-Pankki", true)).toBe("s-pankki-fi");
  });
  it("opens the picker when the bank is no longer offered or no application can start one", () => {
    expect(renewalBank(banks(3), "Aktia", true)).toBeNull();
    expect(renewalBank(all, "Tuntematon pankki", true)).toBeNull();
    expect(renewalBank(all, "Nordea", false)).toBeNull();
  });
});

describe("a bank whose logo the server serves", () => {
  const SERVED = "/api/bank/logos/op-fi";
  const list: BankOption[] = [
    { id: "nordea-fi", name: "Nordea", country: "FI", logo: true },
    { id: "op-fi", name: "OP", country: "FI", logo: true },
    { id: "danske-fi", name: "Danske Bank", country: "FI" },
  ];
  const out = render(list);

  it("gets its picture from the app's own address, with the name on the plate until the picture has loaded", () => {
    expect(out).toContain(`<span class="bank-logo bank-logo-tile bank-logo-text">OP<img src="${SERVED}" alt="OP" hidden=""/></span>`);
    // the button is still named by the bank, and no address of a third party is in the page
    expect(tiles(out)).toEqual(["Nordea", "OP", "Danske Bank"]);
    expect(out).not.toMatch(/https?:/);
  });

  it("keeps bundled artwork first, and the name plate for a bank the server has no logo for", () => {
    expect(out).toContain('src="/banks/nordea.png"');
    expect(out).not.toContain("/api/bank/logos/nordea-fi");
    expect(out).toContain('<span class="bank-logo bank-logo-tile bank-logo-text">Danske Bank</span>');
    expect(bankLogo("danske-fi", false)).toBeNull();
  });

  it("falls back to the name when the picture fails, and shows the picture only once it has loaded", () => {
    expect(plateShows(SERVED, null, null)).toBe("waiting");
    expect(plateShows(SERVED, SERVED, null)).toBe("picture");
    expect(plateShows(SERVED, null, SERVED)).toBe("name");
    // an answer for another picture says nothing about this one
    expect(plateShows(SERVED, "/banks/nordea.png", "/api/bank/logos/aktia-fi")).toBe("waiting");
    expect(plateShows(null, null, null)).toBe("name");
  });

  it("leaves the small plate beside a bank's name empty while the picture loads", () => {
    expect(renderToStaticMarkup(createElement(BankLogo, { src: SERVED, name: "OP", size: "sm" }))).toContain(`<span class="bank-logo bank-logo-sm"><img src="${SERVED}" alt="OP" hidden=""/></span>`);
  });

  it("is found by the name on a consent in the server's list", () => {
    expect(logoForInstitution("OP", [])).toBeNull();
    expect(logoForInstitution("OP", list)).toBe(SERVED);
    expect(bankLogo("op-fi", true)).toBe(SERVED);
    expect(logoForInstitution("Nordea Bank Abp", list)).toBe("/banks/nordea.png");
    expect(logoForInstitution("Danske Bank", list)).toBeNull();
    // a list without the bank's logo leaves it without
    expect(logoForInstitution("OP", [list[2]!])).toBeNull();
  });
});
