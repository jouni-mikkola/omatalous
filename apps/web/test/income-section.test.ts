import { describe, expect, it } from "vitest";
import "@banking/core/late";
import { page } from "../src/pages/reports/pages/Income.tsx";
import { t } from "../src/text.ts";

// The page is Tulot ja menot: the twelve months first, then the picture of sources and uses. The tax year rows are an
// export and stand on Asetukset > Tiedot.
describe("Raportit: Tulot ja menot", () => {
  it("is named Tulot ja menot and has the months and the picture of sources and uses", () => {
    expect(page.title).toBe("Tulot ja menot");
    expect(page.sections.map((s) => s.id)).toEqual(["tulot-ja-menot", "rahan-kulku"]);
    expect(page.sections[1]!.reports).toEqual(["moneyFlow"]);
  });
  it("the picture has its own heading", () => {
    expect(t("rpt.mf_title")).toBe("Rahan lähteet ja käyttö");
  });
});
