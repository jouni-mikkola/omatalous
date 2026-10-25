import { describe, expect, it } from "vitest";
import { consentNoticeText, roundLabel, consentNotices, dueText, expiresIn, leftOutText, maskedNumber, reminderDay, renewalReminder, roundText, unlinkedAccounts, unlinkedStep, unlinkedTitle, validityText } from "../src/consent-notices.ts";
import type { Account, Connection } from "../src/types.ts";

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
  needsRenewal: state === "lapsed" || state === "broken",
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
      "Nordea Gold ei tullut mukaan uuteen yhteyteen. Lisää se Enable Bankingissa (API applications > Omatalous > Link accounts) ja yhdistä uudelleen.",
    );
    // a consent the user removed is named the same way once a newer one is active
    const removed = conn("old", "Nordea", "removed", null, { replaced: true });
    expect(consentNotices([fresh, removed], [account("card", "Nordea Gold", "old")]).map((n) => n.kind)).toEqual(["left_out"]);
  });
});

describe("consentNoticeText", () => {
  it("names the bank, a passed date and never a date ahead", () => {
    expect(consentNoticeText({ id: "b", institution: "OP", kind: "lapsed", endedOn: "2026-10-01T00:00:00Z", daysLeft: null })).toBe("OP: yhteys vanhentui 1.10.2026.");
    expect(consentNoticeText({ id: "b", institution: "Nordea", kind: "broken", endedOn: null, daysLeft: null })).toBe("Nordea: yhteys katkesi.");
    expect(consentNoticeText({ id: "a", institution: "Nordea", kind: "expiring", endedOn: null, daysLeft: 0 })).toBe("Nordea: yhteys vanhenee tänään.");
    expect(consentNoticeText({ id: "a", institution: "Nordea", kind: "expiring", endedOn: null, daysLeft: 1 })).toBe("Nordea: yhteys vanhenee huomenna.");
    expect(consentNoticeText({ id: "a", institution: "Nordea", kind: "expiring", endedOn: null, daysLeft: 9 })).toBe("Nordea: yhteys vanhenee 9 päivän päästä.");
    expect(leftOutText("Säästötili")).toMatch(/^Säästötili ei tullut mukaan uuteen yhteyteen\./);
  });

  it("counts today as 0 days left", () => {
    expect(expiresIn(0)).toBe("tänään");
    expect(expiresIn(-1)).toBe("tänään");
  });
});

const problem = { kind: "not_linked", message: "tiliä ei ole lisätty Enable Bankingissa." } as const;
type Row = Pick<Account, "id" | "bankName" | "name" | "iban" | "cardMask" | "connectionId" | "problem">;
const row = (id: string, connectionId: string | null, extra: Partial<Row> = {}): Row => ({ id, bankName: id, name: id, iban: null, cardMask: null, connectionId, problem: null, ...extra });

describe("unlinkedAccounts", () => {
  const cs = [conn("a", "Nordea", "active", 90), conn("b", "OP", "active", 60)];

  it("is empty when every account is read", () => {
    expect(unlinkedAccounts(cs, [row("chk", "a"), row("card", "a", { problem: null })])).toEqual([]);
    expect(unlinkedAccounts(cs, [])).toEqual([]);
  });

  it("names one account by the bank's name and the last four digits only", () => {
    const list = unlinkedAccounts(cs, [row("chk", "a", { bankName: "Käyttötili", iban: "FI21 1234 5600 0007 85", problem }), row("sav", "a")]);
    expect(list).toEqual([{ id: "chk", institution: "Nordea", name: "Käyttötili", number: "•••• 0785" }]);
    expect(JSON.stringify(list)).not.toMatch(/FI21|1234 56|12345600/);
  });

  it("lists three accounts of two banks in the order of the accounts, a card by its own mask", () => {
    const list = unlinkedAccounts(cs, [
      row("chk", "a", { bankName: "Käyttötili", iban: "FI2112345600000785", problem }),
      row("card", "a", { bankName: "Nordea Gold", cardMask: "•••• 1144", problem }),
      row("op", "b", { name: "OP-tili", bankName: "", iban: "FI4950009420028730", problem }),
    ]);
    expect(list.map((a) => [a.institution, a.name, a.number])).toEqual([
      ["Nordea", "Käyttötili", "•••• 0785"],
      ["Nordea", "Nordea Gold", "•••• 1144"],
      ["OP", "OP-tili", "•••• 8730"],
    ]);
  });

  it("leaves out other failures, accounts without a consent and consents that ended or moved on", () => {
    const old = [conn("a", "Nordea", "active", 90), conn("l", "OP", "lapsed", null), conn("h", "Aktia", "active", 50, { history: true })];
    const list = unlinkedAccounts(old, [
      row("failed", "a", { problem: { kind: "failed", message: "pankki vastasi virheellä 500" } }),
      row("csv", null, { problem }),
      row("lapsed", "l", { problem }),
      row("history", "h", { problem }),
      row("unknown", "gone", { problem }),
    ]);
    expect(list).toEqual([]);
  });
});

describe("maskedNumber, unlinkedTitle and unlinkedStep", () => {
  it("shows four digits of an IBAN or the card's own mask, else nothing", () => {
    expect(maskedNumber({ iban: "FI2112345600000785" })).toBe("•••• 0785");
    expect(maskedNumber({ iban: "FI21 1234 5600 0007 85", cardMask: "•••• 1144" })).toBe("•••• 0785");
    expect(maskedNumber({ iban: null, cardMask: "•••• 1144" })).toBe("•••• 1144");
    expect(maskedNumber({ iban: null })).toBe("");
    expect(maskedNumber({ iban: "FI2", cardMask: null })).toBe("");
  });

  it("counts in good Finnish", () => {
    expect(unlinkedTitle(1)).toBe("Yhtä tiliä ei ole lisätty Enable Bankingissa.");
    expect(unlinkedTitle(3)).toBe("3 tiliä ei ole lisätty Enable Bankingissa.");
  });

  it("gives the step to who can take it, and says who does otherwise", () => {
    expect(unlinkedStep(1, true)).toBe("Lisää se Control Panelissa (API applications > Omatalous > Link accounts). Paina sen jälkeen Hae nyt.");
    expect(unlinkedStep(2, true)).toMatch(/^Lisää ne Control Panelissa/);
    expect(unlinkedStep(2, false)).toBe("Ylläpitäjän pitää lisätä ne Control Panelissa (API applications > Omatalous > Link accounts). Paina sen jälkeen Hae nyt.");
  });
});

describe("validityText", () => {
  it("says when an active consent ends, in words", () => {
    expect(validityText({ state: "active", validUntil: "2027-01-14T00:00:00Z", daysLeft: 93 })).toBe("voimassa 14.1.2027 asti");
    expect(validityText({ state: "active", validUntil: "2027-01-14T00:00:00Z", daysLeft: 1 })).toBe("voimassa 14.1.2027 asti, vielä 1 päivä");
    expect(validityText({ state: "active", validUntil: "2027-01-14T00:00:00Z", daysLeft: 0 })).toBe("voimassa enää tänään");
    expect(validityText({ state: "active", validUntil: "2027-01-14T00:00:00Z", daysLeft: null })).toBe("voimassa 14.1.2027 asti");
  });

  it("counts the days left only when fewer than 30 are left", () => {
    expect(validityText({ state: "active", validUntil: "2027-01-14T00:00:00Z", daysLeft: 29 })).toBe("voimassa 14.1.2027 asti, vielä 29 päivää");
    // near miss: with 30 days left the date alone says it
    expect(validityText({ state: "active", validUntil: "2027-01-14T00:00:00Z", daysLeft: 30 })).toBe("voimassa 14.1.2027 asti");
  });

  it("is empty for a consent that is not active or has no date", () => {
    expect(validityText({ state: "lapsed", validUntil: "2026-09-01T00:00:00Z", daysLeft: null })).toBe("");
    expect(validityText({ state: "active", validUntil: null, daysLeft: null })).toBe("");
  });
});

describe("reminderDay", () => {
  it("is seven days before the date the page shows, over a month and a year", () => {
    expect(reminderDay("2027-01-14T00:00:00Z")).toBe("2027-01-07");
    expect(reminderDay("2026-03-03T10:00:00Z")).toBe("2026-02-24");
    expect(reminderDay("2027-01-05T00:00:00Z")).toBe("2026-12-29");
  });

  it("is null without a usable date", () => {
    expect(reminderDay(null)).toBeNull();
    expect(reminderDay("")).toBeNull();
    expect(reminderDay("huomenna")).toBeNull();
  });
});

describe("renewalReminder", () => {
  const stamp = new Date("2026-10-12T09:30:00Z");
  const nordea = { id: "sess-1", institution: "Nordea", validUntil: "2027-01-14T00:00:00Z" };
  /** The lines as a calendar reads them: the folds taken out. */
  const unfolded = (ics: string) => ics.replaceAll("\r\n ", "");

  it("is one all-day event seven days before the end, with the address of the app and nothing of an account", () => {
    const r = renewalReminder(nordea, "https://talous.example.fi", stamp)!;
    expect(r.day).toBe("2027-01-07");
    expect(r.filename).toBe("pankkiyhteys-nordea-2027-01-14.ics");
    expect(unfolded(r.ics).split("\r\n")).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Omatalous//Pankkiyhteys//FI",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      expect.stringMatching(/^UID:renewal-[0-9a-f]{8}-20270114@omatalous$/),
      "DTSTAMP:20261012T093000Z",
      "DTSTART;VALUE=DATE:20270107",
      "DTEND;VALUE=DATE:20270108",
      "SUMMARY:Omatalous: pankkiyhteys vanhenee 14.1.2027",
      "DESCRIPTION:Nordea: yhteys vanhenee 14.1.2027. Avaa Omatalous ja valitse Asetukset > Pankkiyhteydet > Yhdistä uudelleen.\\nhttps://talous.example.fi/#/settings",
      "URL:https://talous.example.fi/#/settings",
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Omatalous: pankkiyhteys vanhenee 14.1.2027",
      "TRIGGER;RELATED=START:PT9H",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ]);
    expect(r.ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("takes the address from the page, with its port, and drops any path", () => {
    const r = renewalReminder(nordea, "http://192.168.1.10:8080/", stamp)!;
    expect(unfolded(r.ics)).toContain("URL:http://192.168.1.10:8080/#/settings\r\n");
  });

  it("ends the event on the day after, also at the end of a month", () => {
    const r = renewalReminder({ ...nordea, validUntil: "2027-01-07T00:00:00Z" }, "https://talous.example.fi", stamp)!;
    expect(r.ics).toContain("DTSTART;VALUE=DATE:20261231\r\n");
    expect(r.ics).toContain("DTEND;VALUE=DATE:20270101\r\n");
  });

  it("keeps every line within 75 octets and never splits a character", () => {
    const r = renewalReminder({ ...nordea, institution: "Ålandsbanken ääkköset öö ååå" }, "https://talous.example.fi", stamp)!;
    const lines = r.ics.split("\r\n");
    expect(lines.some((l) => l.startsWith(" "))).toBe(true);
    for (const line of lines) expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
    expect(unfolded(r.ics)).toContain("DESCRIPTION:Ålandsbanken ääkköset öö ååå: yhteys vanhenee 14.1.2027.");
    expect(r.ics).not.toContain("�");
  });

  it("escapes what a calendar reads as syntax", () => {
    const r = renewalReminder({ ...nordea, institution: "OP; Koti, Oy" }, "https://talous.example.fi", stamp)!;
    expect(unfolded(r.ics)).toContain("DESCRIPTION:OP\\; Koti\\, Oy: yhteys vanhenee");
    expect(r.filename).toBe("pankkiyhteys-op-koti-oy-2027-01-14.ics");
  });

  it("escapes CRLF, a lone CR and LF alike and drops other control characters", () => {
    const description = (institution: string) => /\r\nDESCRIPTION:(.*?)\r\n/s.exec(unfolded(renewalReminder({ ...nordea, institution }, "https://talous.example.fi", stamp)!.ics))![1]!;
    expect(description("F\rG")).toMatch(/^F\\nG: yhteys/);
    expect(description("F\r\nG")).toMatch(/^F\\nG: yhteys/);
    expect(description("F\nG")).toMatch(/^F\\nG: yhteys/);
    expect(description("F\u0000G\u001bH\u007fI")).toMatch(/^FGHI: yhteys/);
    expect(description("F\u2028G")).toMatch(/^F\\nG: yhteys/);
    // whatever the name holds, the file has no line break but the CRLF of its own lines
    const ics = renewalReminder({ ...nordea, institution: "A\rEND:VEVENT\rB" }, "https://talous.example.fi", stamp)!.ics;
    expect(ics.replaceAll("\r\n", "")).not.toMatch(/[\r\n\u0000-\u0008\u000b-\u001f\u2028]/);
    expect(ics.match(/\r\nEND:VEVENT\r\n/g)).toHaveLength(1);
  });

  it("gives each consent its own event that keeps its identity from one download to the next", () => {
    const uid = (c: typeof nordea) => /UID:(.*)\r\n/.exec(renewalReminder(c, "https://talous.example.fi", stamp)!.ics)![1];
    expect(uid(nordea)).toBe(uid(nordea));
    // two Nordea consents ending on the same day (one account each) are two events
    expect(uid({ ...nordea, id: "sess-2" })).not.toBe(uid(nordea));
    expect(uid(nordea)).not.toContain("sess-1");
  });

  it("is null without an end date or with an address that is not http or https", () => {
    expect(renewalReminder({ ...nordea, validUntil: null }, "https://talous.example.fi", stamp)).toBeNull();
    expect(renewalReminder(nordea, "", stamp)).toBeNull();
    expect(renewalReminder(nordea, "null", stamp)).toBeNull();
    expect(renewalReminder(nordea, "file:///talous", stamp)).toBeNull();
  });
});

describe("the round that renews every consent", () => {
  it("names the banks that are due, in the order the round takes them", () => {
    expect(dueText(["OP", "Nordea"])).toBe("Yhteys päättyy tai on päättynyt: OP, Nordea.");
  });

  it("counts the banks done, and says so when all are", () => {
    const consents = [
      { connection: "a", bank: "op-fi", done: true },
      { connection: "b", bank: "nordea-fi", done: false },
    ];
    expect(roundText({ consents, finished: false })).toBe("1 / 2 uusittu");
    expect(roundText({ consents: consents.map((c) => ({ ...c, done: true })), finished: true })).toBe("Kaikki yhteydet on uusittu.");
  });
});

describe("roundLabel", () => {
  const accounts = [
    { name: "Käyttötili", iban: "FI2112345600000785", cardMask: null, connectionId: "a" },
    { name: "Säästötili", iban: "FI1410093000123458", cardMask: null, connectionId: "a" },
    { name: "Nordea Gold", iban: null, cardMask: "•••• 1144", connectionId: "b" },
  ];
  it("is the bank's name, and with two consents of one bank the accounts that tell them apart", () => {
    const round = [{ connection: "a", bank: "nordea-fi" }, { connection: "b", bank: "nordea-fi" }, { connection: "c", bank: "op-fi" }];
    expect(roundLabel("c", "op-fi", "OP", round, accounts)).toBe("OP");
    expect(roundLabel("a", "nordea-fi", "Nordea", round, accounts)).toBe("Nordea (Käyttötili · FI21 1234 5600 0007 85, Säästötili · FI14 1009 3000 1234 58)");
    expect(roundLabel("b", "nordea-fi", "Nordea", round, accounts)).toBe("Nordea (Nordea Gold · •••• 1144)");
    expect(roundLabel("a", "nordea-fi", "Nordea", round.slice(0, 1), accounts)).toBe("Nordea");
  });
});
