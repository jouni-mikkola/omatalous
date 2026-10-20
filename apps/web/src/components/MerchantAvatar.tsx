/**
 * The mark of a payee or an account that has no logo: initials on a disc whose tint is one of the chart series, chosen
 * by a stable hash of the name, so a name keeps its colour on every page. A person gets a head and shoulders and never
 * initials, which could be read as a brand. The disc sits on the plate the bank logos and the chain marks use, at the
 * same size, so the three line up in a column. Nothing is fetched and no logo set is bundled.
 */
import { companyForms, fold, householdWords, isBusinessRow, mayBePerson, nameMayBePerson, type Transaction } from "@banking/core";
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
    .filter((w) => /\p{L}/u.test(w) && !FORMS.has(w.toLocaleUpperCase("fi-FI")));
  if (!words.length) return "?";
  const letter = (w: string) => [...w.replace(/[^\p{L}]/gu, "")];
  const [a = "", b = ""] = words;
  return (b ? [letter(a)[0] ?? "", letter(b)[0] ?? ""] : letter(a).slice(0, 2)).join("").toLocaleUpperCase("fi-FI") || "?";
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

type PayeeRow = Pick<Transaction, "mcc" | "accountId" | "counterparty" | "counterpartyIban" | "description"> & { merchant?: string; reference?: string | null };

/** What a payee's row says it is, by core's own predicates: a business is shown by evidence, a person by the guard. */
export function payeeKind(row: PayeeRow, cards: ReadonlySet<string>, household: ReadonlySet<string>, evidenced = false): "business" | "person" | "unknown" {
  if (isBusinessRow(row, cards)) return "business";
  return mayBePerson(row, household, evidenced) ? "person" : "unknown";
}

/** A head and shoulders. */
function PersonGlyph() {
  return (
    <svg viewBox="0 0 16 16">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5z" />
    </svg>
  );
}

/**
 * `person` draws the glyph, `row` lets core decide it from the row (payeeKind); with neither, core reads the name
 * (nameMayBePerson) against the household's own names. Decorative: the name stands beside the mark, so a screen reader
 * skips it. `size` is the dense row (s), the line (m) and the one a page is about (l).
 */
export function MerchantAvatar({
  name,
  person,
  row,
  cards,
  household,
  evidenced,
  size = "m",
  wide = false,
}: {
  name: string;
  person?: boolean;
  row?: PayeeRow;
  cards?: ReadonlySet<string>;
  household?: ReadonlySet<string>;
  evidenced?: boolean;
  size?: "s" | "m" | "l";
  /** The width of a bank logo's plate, so an account line starts its name at one place whatever mark it has. */
  wide?: boolean;
}) {
  const own = useHousehold();
  const isPerson = person ?? (row && cards ? payeeKind(row, cards, household ?? own, evidenced) === "person" : nameMayBePerson(name, own));
  return (
    <span className={`mk-plate mk-${size}${wide ? " mk-wide" : ""}`} aria-hidden="true">
      <span className="mk-disc" data-tint={isPerson ? undefined : tintOf(name)}>
        {isPerson ? <PersonGlyph /> : initialsOf(name)}
      </span>
    </span>
  );
}
