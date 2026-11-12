import { describe, expect, it } from "vitest";
import { wrongTabsIn } from "./ui-paths.ts";

describe("rule 35 detection: a path names a settings tab", () => {
  it("refuses a path whose first step is no tab, in Finnish and in English", () => {
    expect(wrongTabsIn("Lisää saldo kohdassa Asetukset > Tilit, niin puskuri näkyy.")).toEqual(["Asetukset > Tilit"]);
    expect(wrongTabsIn("Katso Asetukset > Ylläpito.")).toEqual(["Asetukset > Ylläpito"]);
    expect(wrongTabsIn("Muuta se kohdassa Asetukset > Palvelin.")).toEqual(["Asetukset > Palvelin"]);
    expect(wrongTabsIn("Muuta etäkäyttöä kohdassa Asetukset > Palvelin > Etäkäyttö.")).toEqual(["Asetukset > Palvelin"]);
    expect(wrongTabsIn("Katso Asetukset > Pankit.")).toEqual(["Asetukset > Pankit"]);
    expect(wrongTabsIn("See Settings > Maintenance.")).toEqual(["Settings > Maintenance"]);
    expect(wrongTabsIn("Change it in Settings > Server.")).toEqual(["Settings > Server"]);
  });

  it("lets a path through that starts with a tab, also with a section after it", () => {
    expect(wrongTabsIn("Muuta se kohdassa Asetukset > Palvelin ja ylläpito.")).toEqual([]);
    expect(wrongTabsIn("Muuta etäkäyttöä kohdassa Asetukset > Palvelin ja ylläpito > Etäkäyttö.")).toEqual([]);
    expect(wrongTabsIn("Lisää saldo kohdassa Asetukset > Pankit ja tilit, niin puskuri näkyy.")).toEqual([]);
    expect(wrongTabsIn("kohdassa Asetukset > Talous > Lainat")).toEqual([]);
    expect(wrongTabsIn("See Settings > Server and maintenance > Remote access.")).toEqual([]);
    expect(wrongTabsIn("Asetukset ovat tallessa. Settings are saved.")).toEqual([]);
  });

  it("refuses a step that only starts like a tab", () => {
    expect(wrongTabsIn("Asetukset > Talouden jäsenet")).toEqual(["Asetukset > Talouden jäsenet"]);
  });
});
