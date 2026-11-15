/**
 * The glossary of docs/design/GLOSSARY.md holds: a message whose Finnish text is a term of the table has the English
 * term of the same row, so one thing has one name in each language.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import "../src/messages-en.ts";
import "../src/messages-late.ts";
import { type MessageCode, messageIn } from "../src/index.ts";

const GLOSSARY = readFileSync(new URL("../../../docs/design/GLOSSARY.md", import.meta.url), "utf8");

/** The rows of the table: the first term in italics of the Finnish cell and of the English cell. */
export function glossaryTerms(text: string): { fi: string; en: string }[] {
  const first = (cell: string | undefined) => cell?.match(/\*([^*]+)\*/)?.[1]?.trim();
  return text
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*(Thing|-)/.test(line))
    .map((line) => line.split("|").slice(1, -1))
    .map(([, fi, en]) => ({ fi: first(fi), en: first(en) }))
    .filter((r): r is { fi: string; en: string } => !!r.fi && !!r.en);
}

/** Every code of the Finnish tables whose text has no hole, read from the files as messages.test.ts reads them. */
const codes = (): MessageCode[] => {
  const dir = new URL("../src/", import.meta.url);
  const out: MessageCode[] = [];
  for (const f of readdirSync(dir).filter((name) => /^messages.*\.ts$/.test(name))) {
    for (const m of readFileSync(new URL(f, dir), "utf8").matchAll(/^\s*"([a-z0-9_.]+)":\s*"([^"{]*)",?$/gm)) out.push(m[1] as MessageCode);
  }
  return out;
};

/** Upper and lower case of the first letter are one term: a label and the same word in a sentence. */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

describe("the glossary (docs/design/GLOSSARY.md)", () => {
  const terms = glossaryTerms(GLOSSARY);

  it("reads its table", () => {
    expect(terms.length).toBeGreaterThan(30);
    expect(terms).toContainEqual({ fi: "Varat velkojen jälkeen", en: "Net worth" });
  });

  it("a label that is a Finnish term has the English term of its row", () => {
    const wrong: string[] = [];
    for (const code of codes()) {
      const fi = messageIn("fi", code as never);
      const term = terms.find((t) => same(t.fi, fi));
      if (!term) continue;
      const en = messageIn("en", code as never);
      if (!same(term.en, en)) wrong.push(`${code}: "${fi}" is "${en}" in English, the glossary says "${term.en}"`);
    }
    expect(wrong, "write the English term of docs/design/GLOSSARY.md, or add a row there when the thing is another").toEqual([]);
  });
});

describe("reading the glossary table", () => {
  it("takes the first term in italics of each cell and skips the header", () => {
    const table = "| Thing | Suomeksi | In English |\n|---|---|---|\n| A | *Tulos*; in the reports *Käteen jäi* | *Result* |\n| B | no term | *X* |";
    expect(glossaryTerms(table)).toEqual([{ fi: "Tulos", en: "Result" }]);
  });
});
