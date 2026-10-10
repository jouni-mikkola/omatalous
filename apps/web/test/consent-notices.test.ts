import { describe, expect, it } from "vitest";
import { consentNoticeText, consentNotices, expiresIn } from "../src/consent-notices.ts";
import type { Account, Connection } from "../src/types.ts";

const conn = (id: string, institution: string, status: Connection["status"], daysLeft: number | null): Connection => ({
  id,
  institution,
  status,
  validUntil: null,
  lastSyncedAt: null,
  daysLeft,
});
const account = (id: string, connectionId: string | null): Pick<Account, "id" | "connectionId"> => ({ id, connectionId });

describe("consentNotices", () => {
  it("shows an expired consent even when another consent is active", () => {
    const notices = consentNotices([conn("a", "Nordea", "active", 90), conn("b", "OP", "expired", 0)], [account("a1", "a"), account("b1", "b")]);
    expect(notices).toEqual([{ id: "b", institution: "OP", kind: "expired", daysLeft: 0 }]);
  });

  it("gives every consent that ends within 14 days its own notice, the soonest first", () => {
    const notices = consentNotices(
      [conn("a", "Nordea", "active", 12), conn("b", "OP", "active", 3), conn("c", "Aktia", "active", 14), conn("d", "S-Pankki", "active", 15)],
      [account("a1", "a"), account("b1", "b"), account("c1", "c"), account("d1", "d")],
    );
    expect(notices.map((n) => [n.institution, n.kind, n.daysLeft])).toEqual([
      ["OP", "expiring", 3],
      ["Nordea", "expiring", 12],
      ["Aktia", "expiring", 14],
    ]);
  });

  it("lists expired consents before expiring ones", () => {
    const notices = consentNotices([conn("a", "Nordea", "active", 2), conn("b", "OP", "expired", 0)], [account("a1", "a"), account("b1", "b")]);
    expect(notices.map((n) => [n.institution, n.kind])).toEqual([
      ["OP", "expired"],
      ["Nordea", "expiring"],
    ]);
  });

  it("says nothing about revoked consents, long-lived ones or a consent without an end date", () => {
    const notices = consentNotices([conn("a", "Nordea", "revoked", 0), conn("b", "OP", "active", 60), conn("c", "Aktia", "active", null)], [account("a1", "a"), account("b1", "b"), account("c1", "c")]);
    expect(notices).toEqual([]);
  });

  it("ignores an expired consent whose accounts moved to a newer one", () => {
    // linking again moves the accounts to the new consent and leaves the old record behind as expired
    const notices = consentNotices([conn("new", "Nordea", "active", 170), conn("old", "Nordea", "expired", 0)], [account("n1", "new"), account("n2", "new")]);
    expect(notices).toEqual([]);
    // the same record still counts while one of its accounts is on it
    expect(consentNotices([conn("new", "Nordea", "active", 170), conn("old", "Nordea", "expired", 0)], [account("n1", "new"), account("o1", "old")]).map((n) => n.id)).toEqual(["old"]);
  });
});

describe("consentNoticeText", () => {
  it("names the bank in Finnish", () => {
    expect(consentNoticeText({ id: "b", institution: "OP", kind: "expired", daysLeft: 0 })).toBe("OP-yhteys on vanhentunut.");
    expect(consentNoticeText({ id: "a", institution: "Nordea", kind: "expiring", daysLeft: 0 })).toBe("Nordea-yhteys vanhenee tänään.");
    expect(consentNoticeText({ id: "a", institution: "Nordea", kind: "expiring", daysLeft: 1 })).toBe("Nordea-yhteys vanhenee huomenna.");
    expect(consentNoticeText({ id: "a", institution: "Nordea", kind: "expiring", daysLeft: 9 })).toBe("Nordea-yhteys vanhenee 9 päivän päästä.");
  });

  it("counts today as 0 days left", () => {
    expect(expiresIn(0)).toBe("tänään");
    expect(expiresIn(-1)).toBe("tänään");
  });
});
