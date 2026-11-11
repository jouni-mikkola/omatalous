import { describe, expect, it } from "vitest";
import { bannersOf, dismissPath, type SecurityNotice, securityRows } from "../src/components/notices.ts";

describe("Kuittaa", () => {
  it("of a row reads that notice alone, and Kuittaa kaikki the list", () => {
    expect(dismissPath("e7")).toBe("/api/security/notices/e7/seen");
    expect(dismissPath("disk_low")).toBe("/api/security/notices/disk_low/seen");
    expect(dismissPath()).toBe("/api/security/notices/seen");
  });
});

const signIn = (over: Partial<SecurityNotice> = {}): SecurityNotice => ({ id: "e7", kind: "new_device", at: "2026-10-12T12:30:00.000Z", text: "Tunnuksellasi kirjautui joku uudelta laitteelta.", detail: "Chrome, Windows", ...over });

describe("a sign-in from a new device", () => {
  it("is one line with the time and the device, leading to the sign-in card of Asetukset", () => {
    expect(securityRows([signIn()])).toEqual([{ id: "e7", title: "Kirjautuminen uudelta laitteelta 12.10. klo 15.30 (Chrome, Windows)", href: "#/settings/household#kirjautuminen" }]);
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
      ["r", "Ylläpitäjä nollasi salasanasi.", "#/settings/household#kirjautuminen"],
      ["i", "Toimialahaku on pois päältä.", "#/settings/server#palvelin"],
      ["m", "Levyllä on vähän tilaa.", "#/settings/server#yllapito"],
    ]);
  });

  it("are no line when there is none", () => {
    expect(securityRows([])).toEqual([]);
  });
});
