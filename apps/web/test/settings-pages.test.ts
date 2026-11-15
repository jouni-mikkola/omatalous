import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BankConnections } from "../src/pages/settings/BankConnections.tsx";
import type { Connection, Meta } from "../src/types.ts";

const conn = (id: string, state: Connection["state"]): Connection => ({
  id,
  institution: "Nordea",
  status: state === "active" ? "active" : "expired",
  state,
  history: false,
  replaced: false,
  validUntil: "2026-12-01T00:00:00Z",
  createdAt: "2026-06-01T00:00:00Z",
  lastSyncedAt: null,
  daysLeft: state === "active" ? 40 : null,
  needsRenewal: state === "lapsed" || state === "broken",
});

const meta = (connections: Connection[]) =>
  ({ today: "2026-10-12", user: { role: "member" }, bank: { configured: true, banks: [{ id: "nordea-fi", name: "Nordea", country: "FI" }], redirectMode: "own", source: "instance" }, connections, accounts: [], renewal: { due: [], round: null } }) as unknown as Meta;

const head = (connections: Connection[], sync?: { busy: boolean; disabled: boolean }) =>
  renderToStaticMarkup(createElement(BankConnections, { meta: meta(connections), pickerOpen: false, onChange: () => {}, onMessage: () => {}, ...(sync ? { sync: { ...sync, start: () => {} } } : {}) }));

describe("Pankkiyhteydet: Hae nyt", () => {
  it("is in the head beside Yhdistä pankki while a connection is active", () => {
    const out = head([conn("a", "active")], { busy: false, disabled: false });
    expect(out).toContain("Hae nyt");
    expect(out.indexOf("Yhdistä pankki")).toBeGreaterThan(out.indexOf("Hae nyt"));
    expect(out).not.toContain("Yhdistä ensin pankki");
  });

  it("is not drawn without a connection, or with one that has ended", () => {
    expect(head([], { busy: false, disabled: false })).not.toContain("Hae nyt");
    expect(head([conn("a", "lapsed")], { busy: false, disabled: false })).not.toContain("Hae nyt");
  });

  it("is not drawn by a page that gives no fetch to run", () => {
    expect(head([conn("a", "active")])).not.toContain("Hae nyt");
  });

  it("says Haetaan… while it runs and is off while any action runs", () => {
    expect(head([conn("a", "active")], { busy: true, disabled: true })).toMatch(/<button[^>]*disabled[^>]*>Haetaan…<\/button>/);
    expect(head([conn("a", "active")], { busy: false, disabled: true })).toMatch(/<button[^>]*disabled[^>]*>Hae nyt<\/button>/);
    expect(head([conn("a", "active")], { busy: false, disabled: false })).not.toMatch(/<button[^>]*disabled[^>]*>Hae nyt<\/button>/);
  });
});
