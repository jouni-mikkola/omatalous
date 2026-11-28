/**
 * The mark of a payee or an account that has no logo: initials on a disc whose tint is one of the chart series, chosen
 * by a stable hash of the name, so a name keeps its colour on every page. A person's name has its initials on the
 * plain disc, so a person is never mistaken for a brand and no grey figure repeats down a list. The disc sits on the plate the bank logos and the chain marks use, at the
 * same size, so the three line up in a column. Nothing is fetched and no logo set is bundled.
 */
import { companyForms, fold, householdWords, nameMayBePerson, LOCALE } from "@banking/core";
import { useContext } from "react";
import { MetaContext } from "../hooks.ts";
import type { Meta } from "../types.ts";

/** The seven categorical series of tokens.css. */
const TINTS = 7;

/** The same letters in any case or accent give the same tint. */
export function tintOf(name: string): number {
  let h = 0;
  for (const ch of fold(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % TINTS) + 1;
}

const FORMS = companyForms("payee");

/**
 * Two letters of a name: the first letters of its first two words, or the first two of a single word. A word in
 * brackets ("Käyttötili (esimerkki)") and a company form ("K-Market Oy") are no part of the name.
 */
export function initialsOf(name: string): string {
  const words = name
    .replace(/\([^)]*\)|\[[^\]]*\]/gu, " ")
    .split(/[\s\-–/.,&]+/)
    .filter((w) => /\p{L}/u.test(w) && !FORMS.has(w.toLocaleUpperCase(LOCALE)));
  if (!words.length) return "?";
  const letter = (w: string) => [...w.replace(/[^\p{L}]/gu, "")];
  const [a = "", b = ""] = words;
  return (b ? [letter(a)[0] ?? "", letter(b)[0] ?? ""] : letter(a).slice(0, 2)).join("").toLocaleUpperCase(LOCALE) || "?";
}

const householdOf = new WeakMap<Meta, ReadonlySet<string>>();

/** The words of the household's own names, from the members and the holders of the accounts. Empty where no page has loaded them. */
function useHousehold(): ReadonlySet<string> {
  const meta = useContext(MetaContext);
  if (!meta) return NO_NAMES;
  let words = householdOf.get(meta);
  if (!words) {
    words = householdWords([...meta.members.map((m) => m.displayName), ...meta.accounts.map((a) => a.holder)]);
    householdOf.set(meta, words);
  }
  return words;
}
const NO_NAMES: ReadonlySet<string> = new Set();

/**
 * `person` gives the plain disc; without it core reads the name (nameMayBePerson) against the household's own names. Decorative: the name stands beside the mark, so a screen reader
 * skips it. `size` is the dense row (s), the line (m) and the one a page is about (l).
 */
export function MerchantAvatar({
  name,
  person,
  size = "m",
  wide = false,
}: {
  name: string;
  person?: boolean;
  size?: "s" | "m" | "l";
  /** The width of a bank logo's plate, so an account line starts its name at one place whatever mark it has. */
  wide?: boolean;
}) {
  const own = useHousehold();
  const isPerson = person ?? nameMayBePerson(name, own);
  return (
    <span className={`mk-plate mk-${size}${wide ? " mk-wide" : ""}`} aria-hidden="true">
      <span className="mk-disc" data-tint={isPerson ? undefined : tintOf(name)}>
        {initialsOf(name)}
      </span>
    </span>
  );
}
