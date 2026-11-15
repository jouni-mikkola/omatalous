import type { QuestionId } from "@banking/core";
import { describe, expect, it } from "vitest";
import "@banking/core/late";
import { questionOf } from "../src/pages/reports/More.tsx";
import { reportHref } from "../src/pages/reports/Frame.tsx";
import { listedQuestions } from "../src/pages/reports/question-groups.ts";

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

describe("the three questions of Raportit", () => {
  const titles = (open: QuestionId[]) => listedQuestions(open).map((q) => ({ question: q.title, reports: q.pages.map((p) => p.title) }));
  it("every report belongs to exactly one question", () => {
    const everyReport = ["menot", "tulot", "kiinteat", "saldot", "velat", "yhteiset"] as QuestionId[];
    expect(listedQuestions(everyReport).flatMap((q) => q.pages.map((p) => p.id)).sort()).toEqual([...everyReport].sort());
  });
  it("names no question when no report is open", () => {
    expect(listedQuestions([])).toEqual([]);
  });
  it("lists the three questions, each with its open reports in the order they are told, whatever order they come in", () => {
    expect(titles(["yhteiset", "velat", "kiinteat", "saldot", "tulot", "menot"])).toEqual([
      { question: "Rahankäyttö", reports: ["Rahankäyttö", "Tulot", "Kiinteät menot"] },
      { question: "Rahat ja velat", reports: ["Tilit ja saldot", "Velat"] },
      { question: "Yhteiset menot", reports: ["Yhteiset menot"] },
    ]);
  });
  it("leaves out a report with nothing to show and a question left with no report", () => {
    // a household with no saved loan and no shared account
    expect(titles(["menot", "tulot", "saldot"])).toEqual([
      { question: "Rahankäyttö", reports: ["Rahankäyttö", "Tulot"] },
      { question: "Rahat ja velat", reports: ["Tilit ja saldot"] },
    ]);
    expect(titles(["velat"]).map((q) => q.question)).toEqual(["Rahat ja velat"]);
  });
  it("a report's address names its question and keeps the period", () => {
    expect(reportHref("menot", "6m")).toBe("#/reports?q=menot&period=6m");
    expect(reportHref("velat", null)).toBe("#/reports?q=velat");
    expect(reportHref("kiinteat", "6m")).toBe("#/reports?q=kiinteat&period=6m");
  });
});
