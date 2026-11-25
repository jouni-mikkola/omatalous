import type { QuestionId } from "@banking/core";
import { describe, expect, it } from "vitest";
import "@banking/core/late";
import { questionOf } from "../src/pages/reports/More.tsx";
import { reportHref } from "../src/pages/reports/Frame.tsx";
import { REPORT_PAGES } from "../src/pages/reports/registry.ts";

describe("the question Raportit opens", () => {
  const all: QuestionId[] = ["tulot", "menot"];
  it("a bare address opens the first report with something to show", () => {
    expect(questionOf(all, null, undefined)).toBe("tulot");
    expect(questionOf(["menot"], null, undefined)).toBe("menot");
  });
  it("an asked question opens", () => {
    expect(questionOf(all, "menot", undefined)).toBe("menot");
  });
  // Kuukausi repeated Yhteenveto and is gone: its question is no report any more
  it("the month question of an old address opens the first report", () => {
    expect(questionOf(all, "kuukausi", undefined)).toBe("tulot");
  });
  it("a question that has gone falls back to the first open one", () => {
    expect(questionOf(all, "kertaostot", undefined)).toBe("tulot");
  });
  it("the section an anchor names opens its report", () => {
    expect(questionOf(["tulot", "menot", "yhteiset"], "tulot", "vuodet")).toBe("menot");
    expect(questionOf(["tulot", "menot", "yhteiset"], null, "tulot-ja-menot")).toBe("tulot");
  });
});

describe("the three reports of Raportit", () => {
  it("are Tulot ja menot, Menot kategorioittain and Yhteiset menot, in that order", () => {
    expect(REPORT_PAGES.map((p) => ({ id: p.id, title: p.title }))).toEqual([
      { id: "tulot", title: "Tulot ja menot" },
      { id: "menot", title: "Menot kategorioittain" },
      { id: "yhteiset", title: "Yhteiset menot" },
    ]);
  });
  it("a report's address names its question and keeps the period", () => {
    expect(reportHref("menot", "6m")).toBe("#/reports?q=menot&period=6m");
    expect(reportHref("yhteiset", null)).toBe("#/reports?q=yhteiset");
  });
});
