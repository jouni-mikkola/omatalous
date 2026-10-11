import { describe, expect, it } from "vitest";
import { consentNoticeText, consentNotices, expiresIn, leftOutText } from "../src/consent-notices.ts";
import type { Connection } from "../src/types.ts";

const conn = (id: string, institution: string, state: Connection["state"], daysLeft: number | null, extra: Partial<Connection> = {}): Connection => ({
  id,
  institution,
  status: state === "active" ? "active" : state === "removed" ? "revoked" : "expired",
  state,
  history: false,
  replaced: false,
  validUntil: "2027-04-09T00:00:00Z",
  createdAt: "2026-10-11T00:00:00Z",
  lastSyncedAt: null,
  daysLeft,
  ...extra,
});
const account = (id: string, name: string, connectionId: string) => ({ id, name, connectionId });
/** One account on every connection, named after it. */
const one = (...connections: Connection[]) => connections.map((c) => account(`${c.id}1`, c.id, c.id));

describe("consentNotices", () => {
  it("shows a consent that ended even when another consent is active", () => {
    const cs = [conn("a", "Nordea", "active", 90), conn("b", "OP", "broken", null)];
    expect(consentNotices(cs, one(...cs))).toEqual([{ id: "b", institution: "OP", kind: "broken", endedOn: null, daysLeft: null }]);
  });

  it("gives every consent that ends within 14 days its own notice, the soonest first", () => {
    const cs = [conn("a", "Nordea", "active", 12), conn("b", "OP", "active", 3), conn("c", "Aktia", "active", 14), conn("d", "S-Pankki", "active", 15)];
    expect(consentNotices(cs, one(...cs)).map((n) => [n.institution, n.kind, n.daysLeft])).toEqual([
      ["OP", "expiring", 3],
      ["Nordea", "expiring", 12],
      ["Aktia", "expiring", 14],
    ]);
  });

  it("lists ended consents before expiring ones", () => {
    const cs = [conn("a", "Nordea", "active", 2), conn("b", "OP", "lapsed", null, { validUntil: "2026-10-01T00:00:00Z" })];
    expect(consentNotices(cs, one(...cs)).map((n) => [n.institution, n.kind, n.endedOn])).toEqual([
      ["OP", "lapsed", "2026-10-01T00:00:00Z"],
      ["Nordea", "expiring", null],
    ]);
  });

  it("says nothing about removed consents, long-lived ones or a consent without an end date", () => {
    const cs = [conn("a", "Nordea", "removed", null), conn("b", "OP", "active", 60), conn("c", "Aktia", "active", null)];
    expect(consentNotices(cs, one(...cs))).toEqual([]);
  });

  it("says nothing about history: a consent whose accounts moved to a newer one", () => {
    const fresh = conn("new", "Nordea", "active", 170);
    expect(consentNotices([fresh, conn("old", "Nordea", "broken", null, { history: true })], one(fresh))).toEqual([]);
    const old = conn("old", "Nordea", "broken", null);
    expect(consentNotices([fresh, old], one(fresh, old)).map((n) => n.id)).toEqual(["old"]);
  });

  it("names each account a newer consent of the bank did not bring, instead of katkesi", () => {
    const fresh = conn("new", "Nordea", "active", 170);
    const old = conn("old", "Nordea", "broken", null, { replaced: true });
    const notices = consentNotices([fresh, old], [account("chk", "Käyttötili", "new"), account("card", "Nordea Gold", "old")]);
    expect(notices).toEqual([{ id: "card", institution: "Nordea", kind: "left_out", endedOn: null, daysLeft: null, accountName: "Nordea Gold" }]);
    expect(consentNoticeText(notices[0]!)).toBe(
      "Nordea Gold ei tullut mukaan uuteen yhteyteen. Linkitä se Enable Bankingissa (API applications > Omatalous > Link accounts) ja yhdistä uudelleen.",
    );
    // a consent the user removed is named the same way once a newer one is active
    const removed = conn("old", "Nordea", "removed", null, { replaced: true });
    expect(consentNotices([fresh, removed], [account("card", "Nordea Gold", "old")]).map((n) => n.kind)).toEqual(["left_out"]);
  });
});

describe("consentNoticeText", () => {
  it("names the bank, a passed date and never a date ahead", () => {
    expect(consentNoticeText({ id: "b", institution: "OP", kind: "lapsed", endedOn: "2026-10-01T00:00:00Z", daysLeft: null })).toBe("OP-yhteys vanhentui 1.10.2026.");
    expect(consentNoticeText({ id: "b", institution: "Nordea", kind: "broken", endedOn: null, daysLeft: null })).toBe("Nordea-yhteys katkesi.");
    expect(consentNoticeText({ id: "a", institution: "Nordea", kind: "expiring", endedOn: null, daysLeft: 0 })).toBe("Nordea-yhteys vanhenee tänään.");
    expect(consentNoticeText({ id: "a", institution: "Nordea", kind: "expiring", endedOn: null, daysLeft: 1 })).toBe("Nordea-yhteys vanhenee huomenna.");
    expect(consentNoticeText({ id: "a", institution: "Nordea", kind: "expiring", endedOn: null, daysLeft: 9 })).toBe("Nordea-yhteys vanhenee 9 päivän päästä.");
    expect(leftOutText("Säästötili")).toMatch(/^Säästötili ei tullut mukaan uuteen yhteyteen\./);
  });

  it("counts today as 0 days left", () => {
    expect(expiresIn(0)).toBe("tänään");
    expect(expiresIn(-1)).toBe("tänään");
  });
});
