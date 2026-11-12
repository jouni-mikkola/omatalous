import { afterEach, describe, expect, it, vi } from "vitest";
import { bannersOf, noticeLine, type SecurityNotice } from "../src/components/notices.ts";

const signIn = (over: Partial<SecurityNotice> = {}): SecurityNotice => ({ id: "e7", kind: "new_device", at: "2026-10-12T12:30:00.000Z", text: "Tunnuksellasi kirjautui joku uudelta laitteelta.", detail: "Chrome, Windows", seen: false, ...over });
const LOG = "#/settings/security#turvallisuusloki";

describe("the line of the notices on Yhteenveto", () => {
  afterEach(() => vi.useRealTimers());

  it("tells one event the user has not seen by its title, leading to the security log", () => {
    expect(noticeLine([signIn()])).toEqual({ id: "e7", title: "Kirjautuminen uudelta laitteelta 12.10. klo 15.30 (Chrome, Windows)", href: LOG, events: true });
  });

  it("is the server's own sentence when it gave no device or no time", () => {
    expect(noticeLine([signIn({ id: "a", detail: undefined })])!.title).toBe("Tunnuksellasi kirjautui joku uudelta laitteelta.");
    expect(noticeLine([signIn({ id: "b", at: null })])!.title).toBe("Tunnuksellasi kirjautui joku uudelta laitteelta.");
  });

  it("is one line of a count for several events, never a list", () => {
    const line = noticeLine([signIn(), signIn({ id: "r", kind: "password_reset_by_admin", text: "Ylläpitäjä nollasi salasanasi." }), signIn({ id: "fails", kind: "login_fail", at: null, text: "Tunnuksellasi epäonnistui 3 kirjautumista." })]);
    expect(line).toEqual({ id: "events", title: "Turvallisuuslokissa on 3 uutta merkintää", href: LOG, events: true });
  });

  it("is nothing when every event is seen, or there is no notice", () => {
    expect(noticeLine([signIn({ seen: true }), signIn({ id: "r", kind: "password_reset_by_admin", seen: true })])).toBeNull();
    expect(noticeLine([])).toBeNull();
    // a seen event beside an unseen one leaves the unseen one alone
    expect(noticeLine([signIn({ seen: true }), signIn({ id: "r", kind: "password_reset_by_admin", text: "Ylläpitäjä nollasi salasanasi." })])!.title).toBe("Ylläpitäjä nollasi salasanasi.");
  });

  it("tells a state that needs the admin first, where it is mended, and leaves the damaged database to the banner", () => {
    const disk = signIn({ id: "m", kind: "disk_low", at: null, text: "Levyllä on vähän tilaa.", seen: undefined });
    const lookup = signIn({ id: "i", kind: "industry_lookup_off", at: null, text: "Toimialahaku on pois päältä.", seen: undefined });
    expect(noticeLine([signIn(), disk])).toEqual({ id: "m", title: "Levyllä on vähän tilaa.", href: "#/settings/server#yllapito", events: false });
    expect(noticeLine([lookup])!.href).toBe("#/settings/server#palvelin");
    const damaged = signIn({ id: "d", kind: "db_damaged", text: "Tietokanta on vaurioitunut.", seen: undefined });
    expect(noticeLine([damaged])).toBeNull();
    expect(bannersOf([damaged, signIn()]).map((n) => n.id)).toEqual(["d"]);
  });

  it("writes the time of a sentence as the app does: klo and no zero before the hour", () => {
    // 22.10 UTC on 11.11. is 0.10 on 12.11. in Helsinki, the year of today
    vi.useFakeTimers({ now: new Date("2026-11-12T10:00:00Z"), toFake: ["Date"] });
    const reset = noticeLine([signIn({ id: "r", kind: "password_reset_by_admin", at: "2026-11-11T22:10:00.000Z", text: "", code: "notice.reset_by_admin" })]);
    expect(reset!.title).toBe("Ylläpitäjä nollasi salasanasi 12.11. klo 0.10. Jos et tiennyt siitä, kysy ylläpitäjältä.");
  });
});
