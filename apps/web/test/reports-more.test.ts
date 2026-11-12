import type { QuestionId } from "@banking/core";
import { describe, expect, it } from "vitest";
import "@banking/core/late";
import { askedNote, listedPages, questionOf } from "../src/pages/reports/More.tsx";
import { reportHref } from "../src/pages/reports/Frame.tsx";

describe("the question Raportit opens", () => {
  const all: QuestionId[] = ["kuukausi", "menot", "tulot"];
  it("a bare address skips the month question, which ignores the period", () => {
    expect(questionOf(all, null, undefined)).toBe("menot");
  });
  it("an asked question opens, month included", () => {
    expect(questionOf(all, "kuukausi", undefined)).toBe("kuukausi");
    expect(questionOf(all, "tulot", undefined)).toBe("tulot");
  });
  it("the month question is the fallback when it is the only one with something to show", () => {
    expect(questionOf(["kuukausi"], null, undefined)).toBe("kuukausi");
  });
  it("a question that has gone falls back to the first open one", () => {
    expect(questionOf(all, "kiinteat", undefined)).toBe("menot");
  });
});

describe("the line above a report opened in place of the asked one", () => {
  it("names the asked report by its name in the list when it has nothing to show", () => {
    expect(askedNote("menot", "tulot")).toBe("Raportissa Rahankäyttö ei ole vielä mitään näytettävää, joten tässä on toinen raportti.");
    expect(askedNote("velat", "tulot")).toContain("Velat");
  });
  it("keeps its own words for a household with no joint account", () => {
    expect(askedNote("yhteiset", "menot")).toBe("Yhteistä tiliä ei ole, joten tässä on muut aiheet.");
  });
  it("says nothing when the asked report is open, none was asked or the name is unknown", () => {
    expect(askedNote("tulot", "tulot")).toBeUndefined();
    expect(askedNote(null, "menot")).toBeUndefined();
    expect(askedNote("kiinteat", "menot")).toBeUndefined();
  });
});

describe("the list of reports", () => {
  // main listed five reports behind Lisää and left Kuukausi out, so the month had no way to the others and they none back
  it("names Kuukausi first, also when it alone has something to show, then the open reports in the order of 1.0.0", () => {
    expect(listedPages([]).map((p) => p.title)).toEqual(["Kuukausi"]);
    expect(listedPages(["saldot", "menot", "velat", "tulot", "yhteiset"]).map((p) => p.title)).toEqual(["Kuukausi", "Rahankäyttö", "Tulot", "Velat", "Tilit ja saldot", "Yhteiset menot"]);
  });
  it("Kuukausi is the bare address the tab opens, and the others keep the period", () => {
    expect(reportHref("kuukausi", "6m")).toBe("#/reports");
    expect(reportHref("menot", "6m")).toBe("#/reports?q=menot&period=6m");
    expect(reportHref("velat", null)).toBe("#/reports?q=velat");
  });
});
