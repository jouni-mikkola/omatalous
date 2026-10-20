import { describe, expect, it } from "vitest";
import { joinSentences, sentenceTitle } from "../src/components/notices.ts";

describe("joinSentences", () => {
  it("adds a full stop after a title that has none", () => {
    expect(joinSentences("8 % menoista on luokittelematta", "251 € on kategoriassa Muut menot")).toBe("8 % menoista on luokittelematta. 251 € on kategoriassa Muut menot");
  });
  it.each(["Onko tämä oikein?", "Huomio!", "Tilit:", "Valmis."])("keeps the mark of %s", (title) => {
    expect(joinSentences(title, "lisää")).toBe(`${title} lisää`);
  });
  it("returns the title alone when the detail is empty", () => {
    expect(joinSentences("Otsikko", "")).toBe("Otsikko");
  });
  it("trims before it appends", () => {
    expect(sentenceTitle("Hälytys a ")).toBe("Hälytys a.");
  });
  it.each(["Odota…", "Katso (lisää.)", "Valmis. "])("leaves %s ended", (title) => {
    expect(sentenceTitle(title)).toBe(title.trimEnd());
  });
  it("ends a title as a sentence", () => {
    expect(sentenceTitle("Otsikko")).toBe("Otsikko.");
  });
});
