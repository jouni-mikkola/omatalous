/**
 * Asetukset > Lisäosa (routes.ts `ADD_ON_TARGET`): the target a loaded add-on module brings, with its cards and the
 * add-on's code card. The module here is made up in the test; without one the target is not offered and its address
 * opens the code card on Palvelin ja ylläpito.
 */
import { afterEach, describe, expect, it } from "vitest";
import { type WebExtension, WEB_EXTENSIONS } from "../src/extensions.ts";
import { addOnTargetOffered, hashOf, parseHash, redirectRoute, settingsCardHash, settingsTargets } from "../src/routes.ts";

const lands = (hash: string, role: "admin" | "member") => {
  const r = parseHash(hash);
  return hashOf(redirectRoute(r, role) ?? r);
};

const withCard: WebExtension = { id: "example", settingsCard: () => null, settingsAnchor: "esimerkki", page: { label: "Esimerkki", component: () => null } };
const withoutCard: WebExtension = { id: "example", page: { label: "Esimerkki", component: () => null } };

afterEach(() => {
  WEB_EXTENSIONS.splice(0);
});

describe("Asetukset without an add-on module", () => {
  it("has no Lisäosa target, and the code card is on Palvelin ja ylläpito", () => {
    expect(settingsTargets("admin").map((t) => t.id)).not.toContain("addon");
    expect(settingsTargets("member").map((t) => t.id)).not.toContain("addon");
    expect(addOnTargetOffered("admin")).toBe(false);
    expect(settingsCardHash("lisaosa")).toBe("#/settings/server#lisaosa");
  });

  it("opens the code card for an admin and the first target for a member at the address of Lisäosa", () => {
    expect(lands("#/settings/addon", "admin")).toBe("#/settings/server#lisaosa");
    expect(lands("#/settings/addon?a=1", "member")).toBe("#/settings/banks?a=1");
    expect(redirectRoute(parseHash("#/settings/server#lisaosa"), "admin")).toBeNull();
  });
});

describe("Asetukset with an add-on module that has a settings card", () => {
  it("offers Lisäosa after the six to an admin and after the four to a member", () => {
    WEB_EXTENSIONS.push(withCard);
    expect(settingsTargets("admin").map((t) => t.label)).toEqual(["Pankit ja tilit", "Talous", "Jäsenet", "Turvallisuus", "Tiedot", "Palvelin ja ylläpito", "Lisäosa"]);
    expect(settingsTargets("member").map((t) => t.label)).toEqual(["Pankit ja tilit", "Talous", "Turvallisuus", "Tiedot", "Lisäosa"]);
  });

  it("names Lisäosa as the target of the module's card and of the code card", () => {
    WEB_EXTENSIONS.push(withCard);
    expect(settingsCardHash("esimerkki")).toBe("#/settings/addon#esimerkki");
    expect(settingsCardHash("lisaosa")).toBe("#/settings/addon#lisaosa");
    for (const role of ["admin", "member"] as const) expect(redirectRoute(parseHash("#/settings/addon#esimerkki"), role)).toBeNull();
  });

  it("moves the addresses from before: the module's card on Talous and the code card on Palvelin ja ylläpito", () => {
    WEB_EXTENSIONS.push(withCard);
    for (const role of ["admin", "member"] as const) expect(lands("#/settings/household#esimerkki", role)).toBe("#/settings/addon#esimerkki");
    expect(lands("#/settings/server#lisaosa", "admin")).toBe("#/settings/addon#lisaosa");
  });
});

describe("Asetukset with an add-on module that has no settings card", () => {
  it("offers Lisäosa to an admin for the code card, and not to a member, who has nothing there", () => {
    WEB_EXTENSIONS.push(withoutCard);
    expect(settingsTargets("admin").map((t) => t.id).at(-1)).toBe("addon");
    expect(settingsTargets("member").map((t) => t.id)).not.toContain("addon");
    expect(lands("#/settings/addon", "member")).toBe("#/settings/banks");
    expect(redirectRoute(parseHash("#/settings/addon"), "admin")).toBeNull();
  });
});
