// @ts-check
/**
 * The forms of repo rule 4 (no em dash in text we write) and the files the rule leaves out. A plain module with no
 * imports: tools/repo-rules/text-rules.ts scans every tracked file with it, and tools/commit.sh loads it to run the
 * same forms on the Markdown a commit takes, so there is one list. Every form is built from parts, so this file holds
 * none of them and is scanned like every other file.
 */
const BS = "\\";
const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @type {{ re: RegExp, name: string }[]} */
export const FORMS = [
  { re: new RegExp(escape(String.fromCharCode(0x2014))), name: "em dash" },
  { re: new RegExp(escape(`${BS}u2014`), "i"), name: "escaped em dash (JS string)" },
  { re: new RegExp(escape(`${BS}u{2014}`), "i"), name: "escaped em dash (JS code point)" },
  { re: new RegExp(`${escape(`${BS}2014`)}(?![0-9a-f])`, "i"), name: "escaped em dash (CSS)" },
  { re: new RegExp(escape(`&${"mdash"};`), "i"), name: "HTML entity for the em dash" },
  { re: new RegExp(escape(`&#${"8212"};`)), name: "numeric entity for the em dash" },
  { re: new RegExp(escape(`&#x${"2014"};`), "i"), name: "hex entity for the em dash" },
];

/**
 * Audit material and its prototypes, in the research folders under .claude/: tools/style-lint.mjs there names the
 * character on purpose, and the notes are not part of the product or its docs. Nothing else is excluded.
 */
export const isResearch = (/** @type {string} */ file) => file.startsWith(".claude/") && file.includes("/research/");
