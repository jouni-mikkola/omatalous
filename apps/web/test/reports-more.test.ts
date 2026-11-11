import type { QuestionId } from "@banking/core";
import { describe, expect, it } from "vitest";
import "@banking/core/late";
import { askedNote, questionOf } from "../src/pages/reports/More.tsx";

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
  it("names the asked report by its name in Lisää when it has nothing to show", () => {
    expect(askedNote("menot", "tulot")).toBe("Raportissa Vuosi ei ole vielä mitään näytettävää, joten tässä on toinen raportti.");
    expect(askedNote("velat", "tulot")).toContain("Lainat");
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
