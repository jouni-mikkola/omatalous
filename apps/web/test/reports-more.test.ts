import type { QuestionId } from "@banking/core";
import { describe, expect, it } from "vitest";
import "@banking/core/late";
import { askedNote, listedPages, questionOf } from "../src/pages/reports/More.tsx";
import { reportHref } from "../src/pages/reports/Frame.tsx";

describe("the question Raportit opens", () => {
  const all: QuestionId[] = ["menot", "tulot"];
  it("a bare address opens the first report with something to show", () => {
    expect(questionOf(all, null, undefined)).toBe("menot");
    expect(questionOf(["tulot"], null, undefined)).toBe("tulot");
  });
  it("an asked question opens", () => {
    expect(questionOf(all, "tulot", undefined)).toBe("tulot");
  });
  // Kuukausi repeated Yhteenveto and is gone: its question is no report any more
  it("the month question of an old address opens the first report", () => {
    expect(questionOf(all, "kuukausi", undefined)).toBe("menot");
  });
  it("a question that has gone falls back to the first open one", () => {
    expect(questionOf(all, "kertaostot", undefined)).toBe("menot");
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
    expect(askedNote("kertaostot", "menot")).toBeUndefined();
  });
});

describe("the list of reports", () => {
  it("names the open reports in the order of 1.0.0, and no Kuukausi", () => {
    expect(listedPages([])).toEqual([]);
    expect(listedPages(["saldot", "menot", "velat", "tulot", "yhteiset"]).map((p) => p.title)).toEqual(["Rahankäyttö", "Tulot", "Velat", "Tilit ja saldot", "Yhteiset menot"]);
    // Kiinteät menot is back where 1.0.0 listed it, after Tulot
    expect(listedPages(["kiinteat", "saldot", "menot", "velat", "tulot"]).map((p) => p.title)).toEqual(["Rahankäyttö", "Tulot", "Kiinteät menot", "Velat", "Tilit ja saldot"]);
  });
  it("a report's address names its question and keeps the period", () => {
    expect(reportHref("menot", "6m")).toBe("#/reports?q=menot&period=6m");
    expect(reportHref("velat", null)).toBe("#/reports?q=velat");
    expect(reportHref("kiinteat", "6m")).toBe("#/reports?q=kiinteat&period=6m");
  });
});
