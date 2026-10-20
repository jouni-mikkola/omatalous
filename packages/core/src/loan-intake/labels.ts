/**
 * The lines of a text and the labels that stand on them, for the reader of parse.ts: what a line is, which labels it
 * starts with, a label that was broken over two lines, and the small pictures a page draws beside a label (a trade
 * mark, a circled "i"), which OCR turns into a lone sign or letter.
 */
import { fold } from "../merchant.ts";
import { type LoanLabelHit, loanLabelsIn } from "../wording-loan-pages.ts";

export interface Line {
  /** The line with odd spaces and dashes made plain. Positions in `folded` are positions here. */
  text: string;
  folded: string;
  /** What the user is shown. */
  shown: string;
}

const MAX_TEXT = 500;
const MAX_SHOWN = 200;
/** Soft hyphens and zero-width characters: a copied page has them inside words. */
const UNSEEN = /\p{Cf}/gu;
/** Every space that is not the plain one: no-break, thin and narrow spaces stand between a number's thousands. */
const ODD_SPACE = /(?! )\p{Zs}/gu;
/** Every dash and the minus sign: one hyphen-minus after this. */
const ODD_DASH = /[\p{Pd}−]/gu;

/** `fold` one character at a time, so the folded line keeps the length of the text ("ß" would grow). */
export const foldLine = (text: string) =>
  Array.from(text, (c) => {
    const f = fold(c);
    return f.length === c.length ? f : c;
  }).join("");

export function toLine(raw: string): Line {
  // a label and its value fit in MAX_TEXT; a page pasted as one endless line is cut there, so no reader runs long
  const text = raw.slice(0, MAX_TEXT).replace(UNSEEN, "").replace(ODD_SPACE, " ").replace(ODD_DASH, "-");
  const shown = text.replace(/\s+/g, " ").trim();
  return { text, folded: foldLine(text), shown: shown.length > MAX_SHOWN ? `${shown.slice(0, MAX_SHOWN - 1)}…` : shown };
}

export const wordCount = (line: Line) => line.shown.split(" ").length;

/** What may stand before a label: a bullet, a frame character, a row number. */
const BEFORE_LABEL = /^[^\p{L}\p{N}]*(?:\d{1,2}(?:\.\d{1,2})*[.)]? +)?/u;

/** The labels of a line that starts with one. A label further in, after other words, is part of a sentence. */
export function labelsOf(line: Line): LoanLabelHit[] {
  const hits = loanLabelsIn(line.folded);
  return hits.length > 0 && hits[0]!.start === BEFORE_LABEL.exec(line.folded)![0].length ? hits : [];
}

/** A label that OCR or a narrow column broke over two lines ("Viimeinen" / "eräpäivä 31.12.2031"), as one line. */
export function brokenLabel(line: Line, next: Line | undefined): { line: Line; labels: LoanLabelHit[] } | null {
  if (!next || /\d/.test(line.text) || wordCount(line) > 3) return null;
  const head = line.text.trimEnd();
  const joined = toLine(`${head} ${next.text.trimStart()}`);
  const labels = labelsOf(joined);
  const first = labels[0];
  return first && first.start < head.length && first.end > head.length + 1 ? { line: joined, labels } : null;
}

// ── pictures beside a label ──

/**
 * Marks a page prints after a name: registered, trade mark, copyright, and the "&" or "*" OCR makes of a "®" glued to the
 * last word, or the "o" it makes of a small one after a bank's word (no lender's name ends in "pankkio" or "banko"). They
 * are no part of the name.
 */
export const MARKS = /[®™©℠]|(?<=\p{L})[&*]+(?=\s*$)|(?<=pankki|bank|banken)o(?=\s*$)/giu;

/**
 * Whether the text after a label holds no value but a picture: nothing, a mark, a lone bracket or sign, or one lone
 * letter (a circled "i" read as "O", "(i)" or "6)"). A lone digit alone is a value, and a dash says the value is none.
 */
export const isIcon = (text: string) => /^(?:[()[\]@|*]+|[([]?\p{L}[)\]]?|[([]\p{N}[)\]]?|\p{N}[)\]])?$/u.test(text.replace(MARKS, "").replace(/[\s:]/g, ""));

/** Whether `line` is the lender's label with no name after it (the page puts the name on the line above). */
export function lenderCaption(line: Line | undefined): boolean {
  const hits = line ? labelsOf(line) : [];
  return line !== undefined && hits.length === 1 && hits[0]!.field === "lender" && isIcon(line.text.slice(hits[0]!.end));
}
