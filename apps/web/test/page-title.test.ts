import { describe, expect, it } from "vitest";
import { pageTitle } from "../src/page-title.ts";

describe("the title of the open page", () => {
  it("names the question page of Raportit that is open", () => {
    expect(pageTitle("Raportit", "reports", "tulot", undefined)).toBe("Raportit: Tulot ja menot");
    expect(pageTitle("Raportit", "reports", "menot", undefined)).toBe("Raportit: Menot kategorioittain");
    expect(pageTitle("Raportit", "reports", "saldot", undefined)).toBe("Raportit");
    expect(pageTitle("Raportit", "reports", "yhteiset", undefined)).toBe("Raportit: Yhteiset menot");
  });

  it("names the section of Asetukset that is open", () => {
    expect(pageTitle("Asetukset", "settings", null, "banks")).toBe("Asetukset: Pankit ja tilit");
    expect(pageTitle("Asetukset", "settings", null, "server")).toBe("Asetukset: Palvelin ja ylläpito");
  });

  it("leaves the other pages and an unknown tab as they are", () => {
    expect(pageTitle("Raportit", "reports", null, undefined)).toBe("Raportit");
    expect(pageTitle("Raportit", "reports", "nonsense", undefined)).toBe("Raportit");
    expect(pageTitle("Asetukset", "settings", null, undefined)).toBe("Asetukset");
    expect(pageTitle("Yhteenveto", "overview", "menot", "banks")).toBe("Yhteenveto");
    expect(pageTitle(undefined, "reports", "menot", undefined)).toBeUndefined();
  });
});
