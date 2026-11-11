import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const DOCS = ["docs/SECURITY.md", "docs/ADVANCED.md"];

/** The six tabs of Asetukset, each with the headings of its cards that these two guides name. */
const TABS: Record<string, string[]> = {
  "Pankit ja tilit": ["Pankkisovellus"],
  Talous: ["Lainat"],
  Jäsenet: ["Talouden jäsenet"],
  Turvallisuus: ["Omat istunnot"],
  Tiedot: [],
  "Palvelin ja ylläpito": ["Palvelin", "Ylläpito", "Varmuuskopio toiselle koneelle"],
};

/**
 * The name that starts `rest`, whole: the longest of `names` that is not followed by more of a word. With `more`, a
 * name followed by that text is not whole either (the tab Palvelin ja ylläpito cut to Palvelin).
 */
function whole(rest: string, names: string[], more?: string): string | undefined {
  return names
    .filter((n) => rest.startsWith(n))
    .filter((n) => !/^[\p{L}\p{N}]/u.test(rest.slice(n.length)) && !(more && rest.slice(n.length).startsWith(more)))
    .sort((a, b) => b.length - a.length)[0];
}

/** Every `Asetukset > ` path of a document that names no tab, or a card its tab does not have. */
function wrong(doc: string): string[] {
  // emphasis marks off and line ends to spaces: a label may wrap over a line end
  const text = readFileSync(join(ROOT, doc), "utf8").replace(/\*/g, "").replace(/\s+/g, " ");
  const out: string[] = [];
  for (const m of text.matchAll(/Asetukset > /g)) {
    const rest = text.slice(m.index + m[0].length);
    const shown = `${doc}: Asetukset > ${rest.slice(0, 50)}`;
    const tab = whole(rest, Object.keys(TABS), " ja ");
    if (!tab) {
      out.push(shown);
      continue;
    }
    const after = rest.slice(tab.length);
    if (after.startsWith(" > ") && !whole(after.slice(3), TABS[tab]!)) out.push(shown);
  }
  return out;
}

describe("docs: the tabs of Asetukset in SECURITY.md and ADVANCED.md", () => {
  it("each guide names Asetukset with a tab", () => {
    for (const doc of DOCS) expect(readFileSync(join(ROOT, doc), "utf8"), doc).toContain("Asetukset > ");
  });

  it("the name after each `Asetukset > ` is a whole tab label, and a card after it is a card of that tab", () => {
    expect(DOCS.flatMap(wrong)).toEqual([]);
  });
});
