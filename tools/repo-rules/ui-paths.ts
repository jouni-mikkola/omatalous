/**
 * A path in a text ("Asetukset > Palvelin ja ylläpito", "Settings > Banks and accounts") names a settings tab as the tab
 * row says it, so the reader finds the tab. The names are read from the tab row's own tables, so a renamed tab takes its
 * paths with it. Part of rule 35 (glossary-rule.ts); the cases are in ui-paths.test.ts.
 */
import { EN_SET_TABS } from "../../packages/core/src/english/set-tabs.ts";
import { FI_SET_TABS } from "../../packages/core/src/messages-set-tabs.ts";

const tabsOf = (table: Record<string, string>): string[] => Object.entries(table).filter(([code]) => code !== "set.tab.nav").map(([, name]) => name);

const ROOTS = [
  { root: FI_SET_TABS["set.tab.nav"], tabs: tabsOf(FI_SET_TABS) },
  { root: EN_SET_TABS["set.tab.nav"], tabs: tabsOf(EN_SET_TABS) },
];

/** The paths of a text whose first step after "Asetukset >" or "Settings >" is no tab, each as the text writes it. */
export const wrongTabsIn = (text: string): string[] => {
  const out: string[] = [];
  for (const { root, tabs } of ROOTS) {
    for (const m of text.matchAll(new RegExp(`(?<!\\p{L})${root}\\s*>\\s*`, "gu"))) {
      const rest = text.slice(m.index + m[0].length);
      const named = tabs.some((tab) => rest.startsWith(tab) && !/^\p{L}/u.test(rest.slice(tab.length)));
      if (!named) out.push(`${root} > ${rest.split(/[.,;:)]|\s>\s/)[0]!.trim().slice(0, 40)}`);
    }
  }
  return out;
};

/** The tab names a path may start with, for the message of a finding. */
export const TAB_NAMES = ROOTS.flatMap((r) => r.tabs.map((tab) => `${r.root} > ${tab}`));
