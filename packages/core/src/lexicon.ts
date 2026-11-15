/**
 * The Finnish payee lexicon: brands and trade words that file a payment nothing else could, as data. A company row names
 * a brand (whole words, anywhere in the payee or the bank's text, a legal form beside it changes nothing); a stem row
 * is the start of a trade word and holds only at the start of a word of the payee ("HAMMASLAAKARIASEMA" in "XYZ
 * HAMMASLAAKARIASEMA", never "KUNTO" in "MIKKUNTO"), and only where no company row matches. The company rows are the
 * brands the trade register confirmed as Finnish businesses of that trade; foreign brands are not here.
 *
 * `lexiconCategory` is the last step before the trade register (pipeline.ts, `applyMerchantEvidence`): it runs on a
 * row that nothing else filed (no rule of the user's, none of the built-in rules, no card code, no other purchase of
 * the same payee) and on a business row, so a person named like a brand is not filed. The payees of payees.ts and every
 * rule decide before it. Money out only: a refund takes its payment's category (returns.ts).
 *
 * A name is folded (A to Z, digits, ".", "-" and a space): a space is one or more spaces, "-" is a hyphen, a space or
 * nothing ("A-KATSASTUS", "A KATSASTUS"), "." a full stop or nothing ("HUUTO.NET", "HUUTONET"), "=" in front is the whole
 * payee field only. A brand of one word of four letters or less is looked for in the payee only (PAM, AKT, BMW, FORD);
 * the text of a purchase may hold it as a word of something else. The text is read on a card purchase only; on an invoice
 * or a transfer it is the payer's message. A stem is never a word that ends as a street or a place does
 * ("YLIOPISTONKATU"), and a stem found makes the row "industry", a guess like the register's, not "rule".
 * `intermediary` rows are payment services whose category is by the item bought: their name is taken out of the text and
 * the rest is read; they are marked for the code that reads who a payment really went to.
 */
import { type LexiconEntry, LEXICON } from "./lexicon-data.ts";
import { fold } from "./merchant.ts";
import { partyKind } from "./party-kind.ts";
import { endsAsStreetOrPlace, isFinancingText } from "./wording-lenders.ts";
import { words } from "./wording.ts";

const spell = (name: string) => [...name].map((c) => (c === " " ? " +" : c === "-" ? "[- ]?" : c === "." ? String.raw`\.?` : c)).join("");

interface Compiled {
  entry: LexiconEntry;
  /** Global, so that a later match of a word is tried when the first is a street. A stem's `rest` group is the end of its word. */
  re: RegExp;
  /** Looked for in the payee fields only. */
  payeeOnly: boolean;
  not: RegExp | null;
}

/** A name with "=" in front holds only where it is a whole payee field (the bank's "A | B" of the fields). */
const EXACT_FIELD = (name: string) => String.raw`(?<=^|\| )${spell(name)}(?= \||$)`;

const compile = (entry: LexiconEntry): Compiled[] =>
  entry.names.map((name) => {
    const exact = name.startsWith("=");
    const source = exact ? EXACT_FIELD(name.slice(1)) : entry.kind !== "stem" || entry.whole ? words(spell(name)).source : String.raw`(?<![A-Z0-9])${spell(name)}(?<rest>[A-Z0-9]*)`;
    return {
      entry,
      re: new RegExp(source, "g"),
      payeeOnly: !!entry.payeeOnly || entry.kind === "stem" || exact || (!/[ -]/.test(name) && name.length <= 4),
      not: entry.not ? words(entry.not) : null,
    };
  });

const COMPANIES = LEXICON.filter((entry) => entry.kind !== "stem" && entry.kind !== "intermediary").flatMap(compile);
const INTERMEDIARIES = LEXICON.filter((entry) => entry.kind === "intermediary").flatMap(compile).sort((a, b) => b.re.source.length - a.re.source.length);
const STEMS = LEXICON.filter((entry) => entry.kind === "stem").flatMap(compile);
/** One test that rejects most texts before the rows are tried one by one. */
const ANY = new RegExp([...COMPANIES, ...STEMS].map(({ re }) => re.source.replace("(?<rest>", "(?:")).join("|"));

type Row = { merchant: string; counterparty: string | null; description: string | null; counterpartyIban?: string | null };

/** The first match of a row in a text: a stem is refused in front of the end of a street or a place. */
function find({ re }: Compiled, text: string): string | undefined {
  for (const m of text.matchAll(re)) if (!endsAsStreetOrPlace(m.groups?.rest ?? "")) return m[0];
  return undefined;
}

/** The longest match among the rows: a name that holds another row's name is the longer one's. */
function longest(rows: readonly Compiled[], payees: string, all: string): { entry: LexiconEntry; text: string } | null {
  let best: { entry: LexiconEntry; text: string } | null = null;
  for (const row of rows) {
    const text = find(row, row.payeeOnly ? payees : all);
    if (!text || (best && best.text.length >= text.length)) continue;
    if ((row.not && row.not.test(all)) || (row.entry.kind === "purchase" && isFinancingText(payees))) continue;
    best = { entry: row.entry, text };
  }
  return best;
}

/** A payment service is not the answer: its name is taken out of the text and the rest is read ("BAMBORA RUSTA KANGASALA"). */
const withoutServices = (text: string, payeeOnly: boolean) => INTERMEDIARIES.reduce((rest, row) => (row.payeeOnly && !payeeOnly ? rest : rest.replace(row.re, " ")), text);

/**
 * The category of a row's payee by the lexicon, and where it came from ("rule": a company row, certain; "industry": a
 * trade word, a guess), or null. The text of a row with a payee account (an invoice, a transfer) is the payer's message
 * and is never read; a card purchase's is. A transfer under a name in the shape of a person's is a person's and not
 * filed, unless the brand is the whole name ("LAPIN KANSA"); a card purchase ("JULA KANGASALA 123") has no such
 * account, and its two words are a shop and a town. The pipeline asks for business evidence before it calls this
 * (`isBusinessRow`), which refuses a MobilePay payment to a bare name too.
 */
export function lexiconCategory(row: Row): { category: string; source: "rule" | "industry" } | null {
  const names = [row.counterparty, row.merchant].filter((name): name is string => !!name).map((name) => fold(name).trim());
  const payees = withoutServices(names.join(" | "), true);
  const all = withoutServices(fold([row.merchant, row.counterparty, row.counterpartyIban ? null : row.description].filter(Boolean).join(" | ")), false);
  if (!ANY.test(all)) return null;
  const hit = longest(COMPANIES, payees, all) ?? longest(STEMS, payees, all);
  if (!hit) return null;
  const bare = names.some((name) => name === hit.text);
  if (!bare && row.counterpartyIban && names.some((name) => partyKind(name) === "person")) return null;
  return { category: hit.entry.category, source: hit.entry.kind === "stem" ? "industry" : "rule" };
}
