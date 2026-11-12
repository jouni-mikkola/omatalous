import { describe, expect, it, vi } from "vitest";
import { bannersOf, type SecurityNotice, securityRows } from "../src/components/notices.ts";

const signIn = (over: Partial<SecurityNotice> = {}): SecurityNotice => ({ id: "e7", kind: "new_device", at: "2026-10-12T12:30:00.000Z", text: "Tunnuksellasi kirjautui joku uudelta laitteelta.", detail: "Chrome, Windows", ...over });

describe("a sign-in from a new device", () => {
  it("is one line with the time and the device, leading to the sign-in card of Asetukset", () => {
    expect(securityRows([signIn()])).toEqual([{ id: "e7", title: "Kirjautuminen uudelta laitteelta 12.10. klo 15.30 (Chrome, Windows)", href: "#/settings/security#kirjautuminen" }]);
  });

  it("is the server's own sentence when it gave no device or no time", () => {
    const [noDevice, noTime] = securityRows([signIn({ id: "a", detail: undefined }), signIn({ id: "b", at: null })]);
    expect(noDevice!.title).toBe("Tunnuksellasi kirjautui joku uudelta laitteelta.");
    expect(noTime!.title).toBe("Tunnuksellasi kirjautui joku uudelta laitteelta.");
  });
});

describe("the notices of the server", () => {
  it("leave the notice that must stop the user to the banner, and send every other to where the banner sent it", () => {
    const list = securityRows([
      signIn({ id: "d", kind: "db_damaged", text: "Tietokanta on vaurioitunut." }),
      signIn({ id: "r", kind: "password_reset_by_admin", text: "Ylläpitäjä nollasi salasanasi." }),
      signIn({ id: "i", kind: "industry_lookup_off", text: "Toimialahaku on pois päältä." }),
      signIn({ id: "m", kind: "disk_low", text: "Levyllä on vähän tilaa." }),
    ]);
    // the banner of the shell draws what the list leaves, and nothing else
    const all = [signIn({ id: "d", kind: "db_damaged" }), signIn({ id: "r", kind: "password_reset_by_admin" }), signIn()];
    expect(bannersOf(all).map((n) => n.id)).toEqual(["d"]);
    expect(bannersOf([signIn(), signIn({ id: "r", kind: "disk_low" })])).toEqual([]);
    expect(list.map((n) => [n.id, n.title, n.href])).toEqual([
      ["r", "Ylläpitäjä nollasi salasanasi.", "#/settings/security#kirjautuminen"],
      ["i", "Toimialahaku on pois päältä.", "#/settings/server#palvelin"],
      ["m", "Levyllä on vähän tilaa.", "#/settings/server#yllapito"],
    ]);
  });

  it("write the time of a sentence as the app does: klo and no zero before the hour", () => {
    // 22.10 UTC on 11.11. is 0.10 on 12.11. in Helsinki, the year of today
    vi.useFakeTimers({ now: new Date("2026-11-12T10:00:00Z"), toFake: ["Date"] });
    const [reset] = securityRows([signIn({ id: "r", kind: "password_reset_by_admin", at: "2026-11-11T22:10:00.000Z", text: "", code: "notice.reset_by_admin" })]);
    expect(reset!.title).toBe("Ylläpitäjä nollasi salasanasi 12.11. klo 0.10. Jos et tiennyt siitä, kysy ylläpitäjältä.");
    vi.useRealTimers();
  });

  it("are no line when there is none", () => {
    expect(securityRows([])).toEqual([]);
  });
});
