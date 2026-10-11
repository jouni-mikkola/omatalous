import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bankIdForInstitution } from "../src/banks.ts";
import { BankConnections } from "../src/pages/settings/BankConnections.tsx";
import type { Connection, Meta } from "../src/types.ts";

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

const meta = (connections: Connection[], configured = true) =>
  ({ user: { role: "member" }, bank: { configured, banks: BANKS, redirectMode: "own" }, connections, accounts: [] }) as unknown as Meta;
const html = (connections: Connection[], configured?: boolean) =>
  renderToStaticMarkup(createElement(BankConnections, { meta: meta(connections, configured), pickerOpen: false, onChange: () => {}, onMessage: () => {} }));
const reconnects = (out: string) => out.split("Yhdistä uudelleen").length - 1;

describe("Pankkiyhteydet: Yhdistä uudelleen", () => {
  it("is on a connection that ended, one that broke and one that ends within two weeks", () => {
    expect(reconnects(html([conn("a", "lapsed", null)]))).toBe(1);
    expect(reconnects(html([conn("a", "broken", null)]))).toBe(1);
    expect(reconnects(html([conn("a", "active", 14)]))).toBe(1);
    expect(reconnects(html([conn("a", "active", 3)]))).toBe(1);
    // each row has its own
    expect(reconnects(html([conn("a", "lapsed", null), conn("b", "active", 5)]))).toBe(2);
  });

  it("is not on a connection that has time left, or one that was removed", () => {
    expect(reconnects(html([conn("a", "active", 15)]))).toBe(0);
    expect(reconnects(html([conn("a", "active", 90)]))).toBe(0);
    expect(reconnects(html([conn("a", "removed", null)]))).toBe(0);
  });

  it("an expiring connection keeps Poista beside it", () => {
    const out = html([conn("a", "active", 5)]);
    expect(out).toContain("Poista");
    expect(out).toContain("vanhenee pian");
  });
});

describe("Pankkiyhteydet: the add button", () => {
  it("always reads Lisää pankkiyhteys, with a connection or without", () => {
    for (const connections of [[], [conn("a", "active", 90)], [conn("a", "lapsed", null)]]) {
      const out = html(connections);
      expect(out).toContain("Lisää pankkiyhteys");
      expect(out).not.toContain("Lisää seuraava tili");
    }
  });
});
