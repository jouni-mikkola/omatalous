import { afterEach, describe, expect, it, vi } from "vitest";
import { bannersOf, newsCount, noticeRows, type SecurityNotice } from "../src/components/notices.ts";

const signIn = (over: Partial<SecurityNotice> = {}): SecurityNotice => ({ id: "e7", kind: "new_device", at: "2026-10-12T12:30:00.000Z", text: "Tunnuksellasi kirjautui joku uudelta laitteelta.", detail: "Chrome, Windows", seen: false, ...over });

describe("the notices of Asetukset > Turvallisuus and the dot on the user menu", () => {
  afterEach(() => vi.useRealTimers());

  it("lists an event by its title, news until it is seen, with no link of its own", () => {
    expect(noticeRows([signIn()])).toEqual([{ id: "e7", title: "Kirjautuminen uudelta laitteelta 12.10. klo 15.30 (Chrome, Windows)", href: null, news: true }]);
    expect(noticeRows([signIn({ seen: true })])[0]!.news).toBe(false);
  });

  it("is the server's own sentence when it gave no device or no time", () => {
    expect(noticeRows([signIn({ id: "a", detail: undefined })])[0]!.title).toBe("Tunnuksellasi kirjautui joku uudelta laitteelta.");
    expect(noticeRows([signIn({ id: "b", at: null })])[0]!.title).toBe("Tunnuksellasi kirjautui joku uudelta laitteelta.");
  });

  it("counts for the dot only what is news", () => {
    const reset = signIn({ id: "r", kind: "password_reset_by_admin", text: "Ylläpitäjä nollasi salasanasi." });
    expect(newsCount([signIn(), reset, signIn({ id: "fails", kind: "login_fail", at: null, text: "Tunnuksellasi epäonnistui 3 kirjautumista.", seen: true })])).toBe(2);
    expect(newsCount([signIn({ seen: true }), { ...reset, seen: true }])).toBe(0);
    expect(newsCount([])).toBe(0);
  });

  it("lists a state that needs the admin first with where it is mended, never as news, and leaves the damaged database to the banner", () => {
    const disk = signIn({ id: "m", kind: "disk_low", at: null, text: "Levyllä on vähän tilaa.", seen: undefined });
    const lookup = signIn({ id: "i", kind: "industry_lookup_off", at: null, text: "Toimialahaku on pois päältä.", seen: undefined });
    expect(noticeRows([signIn(), disk]).map((r) => [r.id, r.href, r.news])).toEqual([["m", "#/settings/server#yllapito", false], ["e7", null, true]]);
    // a state lasts until it is mended: as news it would hold the dot however often Turvallisuus is opened
    expect(newsCount([disk, lookup])).toBe(0);
    expect(noticeRows([lookup])[0]!.href).toBe("#/settings/server#palvelin");
    const damaged = signIn({ id: "d", kind: "db_damaged", text: "Tietokanta on vaurioitunut.", seen: undefined });
    expect(noticeRows([damaged])).toEqual([]);
    expect(bannersOf([damaged, signIn()]).map((n) => n.id)).toEqual(["d"]);
  });

  it("writes the time of a sentence as the app does: klo and no zero before the hour", () => {
    // 22.10 UTC on 11.11. is 0.10 on 12.11. in Helsinki, the year of today
    vi.useFakeTimers({ now: new Date("2026-11-12T10:00:00Z"), toFake: ["Date"] });
    const [reset] = noticeRows([signIn({ id: "r", kind: "password_reset_by_admin", at: "2026-11-11T22:10:00.000Z", text: "", code: "notice.reset_by_admin" })]);
    expect(reset!.title).toBe("Ylläpitäjä nollasi salasanasi 12.11. klo 0.10. Jos et tiennyt siitä, kysy ylläpitäjältä.");
  });
});
