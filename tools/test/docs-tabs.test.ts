import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FI_SET_TABS } from "../../packages/core/src/messages-set-tabs.ts";

const ROOT = join(import.meta.dirname, "../..");
const DOCS = ["docs/INSTALL.md", "docs/TROUBLESHOOTING.md", "docs/ENABLE_BANKING.md", "docs/ADVANCED.md", "docs/SECURITY.md"];

/** The name of the page itself, as the app shows it: what a guide writes before the tab. */
const PAGE = FI_SET_TABS["set.tab.nav"];
/** The tab labels the app shows: every label of the catalogue but the page's own name. */
const TABS: string[] = Object.entries(FI_SET_TABS)
  .filter(([code]) => code !== "set.tab.nav")
  .map(([, label]) => label);

/**
 * The tab label that starts `rest`, whole: the longest one that is not followed by more of a word, nor by ` ja `, which
 * makes it the start of a longer name (the old tab Palvelin ja ylläpito is not the tab Palvelin).
 */
function tabAt(rest: string): string | undefined {
  return TABS.filter((n) => rest.startsWith(n))
    .filter((n) => !/^[\p{L}\p{N}]/u.test(rest.slice(n.length)) && !rest.slice(n.length).startsWith(" ja "))
    .sort((a, b) => b.length - a.length)[0];
}

/** Every place of `text` where the page's name and ` > ` are followed by something else than a tab label. */
function wrong(text: string): string[] {
  // emphasis marks off and line ends to spaces: a path may wrap over a line end
  const flat = text.replace(/\*/g, "").replace(/\s+/g, " ");
  return flat
    .split(`${PAGE} > `)
    .slice(1)
    .filter((rest) => !tabAt(rest))
    .map((rest) => `${PAGE} > ${rest.slice(0, 50)}`);
}

describe("docs: the guides name the tabs Asetukset has", () => {
  it("reads the labels of the three tabs from the app's catalogue", () => {
    expect(PAGE).toBe("Asetukset");
    expect(TABS).toHaveLength(3);
  });

  it("tells a tab label from another name", () => {
    const [first] = TABS;
    expect(wrong(`open *${PAGE} > ${first}* and *${PAGE} > ${first} > Kortti*, or ${PAGE} >\n${first}.`)).toEqual([]);
    expect(wrong(`open *${PAGE} > Ei välilehti*`)).toEqual([`${PAGE} > Ei välilehti`]);
    expect(wrong(`open *${PAGE} > ${first}x*`)).toEqual([`${PAGE} > ${first}x`]);
    expect(wrong(`open *${PAGE} > ${first} ja muut*`)).toEqual([`${PAGE} > ${first} ja muut`]);
  });

  it.each(DOCS)("%s names a tab after each `Asetukset > `", (doc) => {
    const text = readFileSync(join(ROOT, doc), "utf8");
    expect(text).toContain(`${PAGE} > `);
    expect(wrong(text)).toEqual([]);
  });
});
