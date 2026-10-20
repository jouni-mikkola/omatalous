/**
 * Reads loans out of text copied from a bank's loan page, the positive credit register's listing or a SECCI form, or
 * out of OCR of a screenshot. Decision it serves: the household gets a loan into the app without typing every figure,
 * and confirms every field before anything is saved.
 *
 * The rules, in the order they bite:
 * - A value needs a label. A label counts at the start of a line; a second label on the line counts after a tab, two
 *   spaces or a value that was read whole. A figure with no label is left out.
 * - The value stands after its label on the line, or alone on the next line. Two value lines in a row under one label
 *   are a column whose order is not known, so neither is taken.
 * - A value from the next line is `sure` only in a run of labels and values that proves its values stand below their
 *   labels (`provenBelow`): a page can put them above, and then the line below a caption is the next caption's value.
 * - `sure` means: the label as printed, the value beside it or right below it, a plain Finnish form, nothing else in
 *   the text. A repaired digit, a lost comma, a label over two lines or loose in its letters, words around the value
 *   or a failed cross-check all give `check`.
 * - The same label again starts the next loan, and so does a lender's name on a line of its own.
 * - A lender's name printed over "Velkoja" and a figure printed over a caption like "Maksamatta" are read from the line
 *   above when the label's own line holds no value (a lone letter or sign there is a picture), and are `check`.
 */
import type { IsoDate, LoanKind } from "../types.ts";
import { type LoanLabelField, type LoanLabelHit, isLoanLenderLine, loanKindHeading, loanKindOfLender, loanLabelsIn } from "../wording-loan-pages.ts";
import { type DraftFields, crossCheck, lower } from "./checks.ts";
import { type Line, MARKS, brokenLabel, foldLine, isIcon, labelsOf, lenderCaption, toLine, wordCount } from "./labels.ts";
import type { DraftConfidence, LoanDraft, LoanDraftField, LoanDraftKey, LoanDraftWarning, LoanTextOptions } from "./types.ts";
import { type Got, read, readLender } from "./read.ts";
import { isValueOnly } from "./values.ts";

// ── lines ──

const LINE_BREAK = /\r\n?|\n|\f|\p{Zl}|\p{Zp}/u;
/**
 * The line the picture reader puts between a dialog's text and the text of the page dimmed behind it. What follows it
 * only fills the fields the dialog leaves out (`fillFrom`).
 */
export const DIMMED_PAGE_LINE = "[Himmennetty sivu ikkunan takana]";
const MAX_LINES = 5000;

/** A second label on a line is its own after a tab, two spaces, a bar or a semicolon. */
const HARD_BREAK = /(?:\t| {2,}|[|;] ?)$/;
const NUMERIC: ReadonlySet<LoanLabelField> = new Set(["grantedCents", "balanceCents", "paymentCents", "amortisationCents", "limitCents", "rateBp", "marginBp", "endDate", "balanceDate"]);
/** Lines of description a SECCI form may put between a label and its value. */
const MAX_PROSE = 2;
const isProse = (line: Line) => wordCount(line) >= 5 && !/\d/.test(line.text);

/** What follows a label on its line when no value was read there. */
function tailOf(text: string): "none" | "words" | "closed" {
  if (isIcon(text)) return "none";
  // a number that could not be read, or a dash for "no value": the value is not below
  return /\d/.test(text) || !/\p{L}/u.test(text) ? "closed" : "words";
}

/** A line read as a company's name, without the marks after it: an "o" glued to "pankki" keeps the word from matching. */
const nameFolded = (line: Line) => foldLine(line.text.replace(MARKS, ""));

/** A whole line as the value of a field: the line holds that value and nothing else. A lender's line names a company. */
function wholeLine(field: LoanLabelField, line: Line): Got | null {
  if (loanLabelsIn(line.folded).length > 0) return null;
  if (field === "lender") return wordCount(line) <= 8 && !/\d/.test(line.text) && isLoanLenderLine(nameFolded(line)) ? readLender(line.text) : null;
  const got = read(field, line.text, line.folded);
  return got?.clean ? got : null;
}

/** The value of a label that stands alone on its line: the next line, or the one after a SECCI form's description. */
function below(field: LoanLabelField, lines: readonly Line[], at: number): { got: Got; line: Line; index: number; near: boolean } | null {
  let prose = 0;
  for (let j = at + 1; j < lines.length; j++) {
    const line = lines[j]!;
    if (loanLabelsIn(line.folded).length > 0) return null;
    const got = wholeLine(field, line);
    if (got) {
      const after = lines[j + 1];
      // two value lines in a row: a column of values, and which one belongs to this label is not known
      if (NUMERIC.has(field) && after && isValueOnly(after.text)) return null;
      return { got, line, index: j, near: prose === 0 };
    }
    if (field === "lender" || prose === MAX_PROSE || !isProse(line)) return null;
    prose++;
  }
  return null;
}

/** The value of a label alone on its line that stands on the line above: a lender's name over "Velkoja", a figure over "Maksamatta". */
function valueAbove(hit: LoanLabelHit, above: Line | undefined): Got | null {
  if (!above || (hit.field !== "lender" && !hit.figureAbove)) return null;
  const got = wholeLine(hit.field, above);
  return got && { ...got, above: true };
}

/** A caption the label lists do not know: a few words, no label among them and no figure. */
const isCaption = (line: Line) => loanLabelsIn(line.folded).length === 0 && /\p{L}/u.test(line.text) && !/\d/.test(line.text) && !isProse(line);

/** Whether `under`, the line below a label's value, is a label that value cannot belong to. */
function standsApart(value: Line, under: Line | undefined): boolean {
  // a bare whole number can be anything: an amount, a count of months, a loan's number
  if (!under || /^\d+$/.test(value.shown)) return false;
  const [next, following] = labelsOf(under);
  // a type, a number or a lender takes any text as its value, so it proves nothing
  if (!next || next.field === "marker" || next.field === "lender") return false;
  const beside = read(next.field, under.text.slice(next.end, following?.start), under.folded.slice(next.end, following?.start));
  // not readable at all as the next label's kind: a value with words around it would still be that label's
  return beside !== null || !read(next.field, value.text, value.folded);
}

/**
 * The lines of the labels that are proven to have their value on the line below. A page can as well put the value
 * above its caption, and a copy of such a page that starts at a caption pairs every caption with the next one's value.
 * The proof is one label alone on its line, a value under it, and under that a label the value cannot belong to: one
 * with a value beside it, or one of another kind (a percentage is no balance). One page can print its main figures
 * above their captions and a list of details below with each value under its label, so the proof holds for its own run
 * only: labels alone on their lines, each with its value on the next line, one pair after another. A caption the label
 * lists do not know ("Seuraava eräpäivä") with a figure under it is such a pair too; it keeps the run going and proves
 * nothing. A label with no value under it, or any other line, ends the run. Without the proof a value from the line
 * below is `check`.
 */
function provenBelow(lines: readonly Line[]): Set<number> {
  const proven = new Set<number>();
  let run: number[] = [];
  let proof = false;
  const close = () => {
    if (proof) for (const at of run) proven.add(at);
    run = [];
    proof = false;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const value = lines[i + 1];
    const [hit, second] = labelsOf(line);
    if (value && hit !== undefined && !second && hit.field !== "marker" && tailOf(line.text.slice(hit.end)) === "none" && wholeLine(hit.field, value)) {
      run.push(i);
      proof ||= standsApart(value, lines[i + 2]);
    } else if (!value || !isCaption(line) || !isValueOnly(value.text)) {
      close();
      continue;
    }
    // the value's line is the pair's second half
    i++;
  }
  close();
  return proven;
}

// ── drafts ──

/** The principal part of a payment (Lyhennys) is read like a field and settled in `finish`: it is no field of its own. */
type OpenFields = DraftFields & { amortisationCents?: LoanDraftField<number> };

interface Open {
  fields: OpenFields;
  /** `paymentCents` is the amortisation alone: the draft's `paymentKind` says so. */
  amortisationOnly?: boolean;
  /** Label field or marker to the label phrase that was read: the same phrase again is the next loan. */
  seen: Map<string, string>;
  /** Fields whose value came from a label that can name another figure (LOAN_LABELS_UNSURE). */
  unsure: Set<string>;
  /** Fields whose value is such a bare rate: any other reading stands over it. */
  bare: Set<string>;
  /** Fields and markers in reading order. */
  order: string[];
  referenceBp?: number;
  /** The lender came from a line of its own, not from a label. */
  headed: boolean;
  kind?: LoanKind;
  /** Lyhennys of a loan paid another way: the amortisation alone, in place of a payment the text does not give. */
  alone?: LoanDraftField<number>;
  /** What repeated when this draft was closed. */
  repeat?: string;
  warnings: LoanDraftWarning[];
}
const open = (): Open => ({ fields: {}, seen: new Map(), unsure: new Set(), bare: new Set(), order: [], headed: false, warnings: [] });
const hasFigures = (d: Open) => Object.keys(d.fields).some((k) => k !== "lender");

class Drafts {
  private readonly done: Open[] = [];
  private cur = open();

  private split(repeat?: string): void {
    const prev = this.cur;
    if (repeat !== undefined) prev.repeat = repeat;
    this.done.push(prev);
    this.cur = open();
    // a lender's name above several loans is the lender of each
    if (prev.headed && prev.fields.lender) {
      this.cur.fields.lender = { ...prev.fields.lender };
      this.cur.headed = true;
    }
  }

  /**
   * A line with no label: a lender's name on a line of its own starts a loan. Never more than `check`. A name has
   * capitals: a sentence that mentions a bank ("Maksut veloitetaan tililtä ...") has several words without one.
   */
  heading(line: Line): void {
    if (!isLoanLenderLine(nameFolded(line)) || /[\d:]/.test(line.text) || wordCount(line) > 6) return;
    if (line.shown.split(" ").filter((word) => /^\P{L}*\p{Ll}/u.test(word)).length > 1) return;
    if (hasFigures(this.cur)) this.split();
    else if (this.cur.fields.lender && !this.cur.headed) return;
    this.cur.fields.lender = { value: line.shown.replace(MARKS, "").trim(), line: line.shown, confidence: "check" };
    this.cur.headed = true;
  }

  /** A heading that names the kind of the loan, or a lender that only lends against homes. A heading for another kind after figures starts the next loan. */
  kind(line: Line): void {
    const heading = loanKindHeading(line.folded);
    const kind = heading ?? loanKindOfLender(nameFolded(line));
    if (!kind) return;
    if (heading && this.cur.kind && this.cur.kind !== heading && hasFigures(this.cur)) this.split();
    this.cur.kind ??= kind;
  }

  marker(label: string): void {
    const key = `marker ${label}`;
    if (this.cur.seen.has(key) && hasFigures(this.cur)) this.split(key);
    this.cur.seen.set(key, label);
    this.cur.order.push(key);
  }

  read(hit: LoanLabelHit, got: Got, line: string, confidence: DraftConfidence): void {
    const key = hit.field as keyof OpenFields;
    const field = (value: unknown, conf: DraftConfidence) => ({ value, line, confidence: conf }) as LoanDraftField<never>;
    if (key === "lender") {
      // the register and the SECCI form name the lender first; after the figures its place is not known
      const late = hasFigures(this.cur) && !this.cur.fields.lender;
      // a name printed over its label, in the middle of a loan's lines, is that loan's lender
      if (hasFigures(this.cur) && !(got.above && late)) this.split();
      this.cur.fields.lender = field(got.value, late ? "check" : confidence);
      this.cur.headed = false;
      return;
    }
    const before = this.cur.fields[key];
    // a bare rate competes with no reading that is already there
    if (got.bare && before) return;
    const sameWord = this.cur.seen.get(key) === hit.label;
    // the reading in place is a bare one and this is not: it replaces that, also under the same word, which would otherwise start the next loan
    const weak = this.cur.bare.has(key) && !got.bare;
    const again = sameWord && !weak;
    const differs = !sameWord && before !== undefined && got.value !== before.value;
    // The first value came from a word that can name another figure ("Korko" may be the reference rate) and this label
    // is the register's own ("Kokonaiskorko"): this one's value is the field's.
    const wins = !again && before !== undefined && got.value !== undefined && ((hit.certain && this.cur.unsure.has(key)) || weak);
    // two labels of one field with two values: one value stays, and the user looks
    const doubt = () => {
      if (key === "amortisationCents") this.cur.fields[key]!.confidence = "check";
      else lower(this.cur.fields, this.cur.warnings, "two_values", [key]);
    };
    if (again) this.split(key);
    else if (before && !wins) {
      // another label of the same field ("Korko" after "Kokonaiskorko"): the first stays; a fallback label never doubts it
      if (got.value !== undefined && differs && !hit.fallback) doubt();
      return;
    }
    if (!wins) {
      this.cur.seen.set(key, hit.label);
      this.cur.order.push(key);
    }
    if (got.value !== undefined) {
      // `read` gave the value in the type of its field; the compiler cannot follow that through the key
      (this.cur.fields as Record<string, LoanDraftField<unknown>>)[key] = field(got.value, confidence);
      if (hit.certain) this.cur.unsure.delete(key);
      else this.cur.unsure.add(key);
      if (got.bare) this.cur.bare.add(key);
      else this.cur.bare.delete(key);
      if (wins && differs) doubt();
    }
    if (got.referenceBp !== undefined) this.cur.referenceBp = got.referenceBp;
    if (got.date !== undefined && !this.cur.fields.balanceDate) {
      // a date beside the balance is most likely the balance's day, but no label says so
      this.cur.fields.balanceDate = field(got.date, "check");
      this.cur.order.push("balanceDate");
    }
  }

  /**
   * The loan's `paymentCents` is the whole payment, except for an equal-principal loan, where it is the amortisation
   * alone. So Lyhennys is the payment of such a loan and nothing for any other, and a whole payment read for an
   * equal-principal loan stays with a warning: the user types the amortisation.
   */
  private static settlePayment(d: Open): void {
    const { amortisationCents, repayment } = d.fields;
    delete d.fields.amortisationCents;
    if (repayment?.value !== "equal_principal") {
      // the form tells the household that only the amortisation was read; with less read than this, nothing is made of it
      if (amortisationCents && repayment && d.fields.balanceCents && !d.fields.paymentCents) d.alone = amortisationCents;
      return;
    }
    if (!amortisationCents) {
      if (d.fields.paymentCents) lower(d.fields, d.warnings, "payment_whole", ["paymentCents"]);
      return;
    }
    // right only if Lyhennystapa was read right; and a warning that names the payment keeps it to check
    const doubted = repayment.confidence === "check" || d.warnings.some((w) => w.fields.includes("paymentCents"));
    d.fields.paymentCents = doubted ? { ...amortisationCents, confidence: "check" } : amortisationCents;
    d.amortisationOnly = true;
    // the payment keeps the place a whole payment had in the reading order, or takes the amortisation's
    if (d.order.includes("paymentCents")) return;
    d.order = d.order.map((k) => (k === "amortisationCents" ? "paymentCents" : k));
    if (d.repeat === "amortisationCents") d.repeat = "paymentCents";
  }

  /**
   * The page dimmed behind a dialog fills what the dialog leaves out (the rate, the whole payment), each field to check:
   * the page was read apart from the dialog, so nothing ties its figures to the dialog's loan but the picture. A page
   * with more than one loan, or a dialog with more than one, is not known to be the same loan, and gives nothing. A
   * dialog with no loan in it (a notice) leaves the page's loans, every field to check.
   */
  fillFrom(page: Drafts): void {
    const mine = [...this.done, this.cur].filter(hasFigures);
    const theirs = [...page.done, page.cur].filter(hasFigures);
    if (mine.length === 0) {
      for (const p of theirs) for (const f of Object.values(p.fields)) f.confidence = "check";
      this.done.push(...page.done);
      this.cur = page.cur;
      return;
    }
    if (mine.length !== 1 || theirs.length !== 1) return;
    const [d, p] = [mine[0]!, theirs[0]!];
    for (const [key, f] of Object.entries(p.fields) as [keyof OpenFields, LoanDraftField<unknown>][]) {
      // a whole payment is what an amortisation stood in for; the amortisation itself is the dialog's
      if (d.fields[key] || (key === "amortisationCents" && d.fields.paymentCents)) continue;
      (d.fields as Record<string, LoanDraftField<unknown>>)[key] = { ...f, confidence: "check" };
      d.order.push(key);
    }
    if (p.referenceBp !== undefined) d.referenceBp ??= p.referenceBp;
    d.kind ??= p.kind;
  }

  finish(options: LoanTextOptions): LoanDraft[] {
    this.done.push(this.cur);
    this.done.forEach(Drafts.settlePayment);
    const drafts: LoanDraft[] = [];
    this.done.forEach((d, i) => {
      if (!hasFigures(d)) return;
      const next = this.done[i + 1];
      const from = d.repeat === undefined ? -1 : d.order.indexOf(d.repeat);
      // A marker that opened this loan's block opens the next one too: nothing of the next loan stands before it.
      const opensBlock = from === 0 && d.repeat?.startsWith("marker ");
      if (from >= 0 && !opensBlock && next && hasFigures(next)) {
        // The next loan began at an unknown line before the repeated label. What this loan read after that label's
        // first turn, and the next loan lacks, may be the next loan's.
        const loose = d.order.slice(from + 1).filter((k): k is LoanDraftKey => k !== "lender" && k in d.fields && !(k in next.fields));
        if (loose.length > 0) lower(d.fields, d.warnings, "mixed_loans", [...new Set(loose)]);
      }
      crossCheck(d.fields, d.warnings, { referenceBp: d.referenceBp, amortisationOnly: d.amortisationOnly }, options);
      // no check knows what the amortisation of an annuity should be, so it joins the draft after them
      if (d.alone) d.fields.paymentCents = { ...d.alone, confidence: "check" };
      if (options.source === "ocr") for (const f of Object.values(d.fields)) f.confidence = "check";
      const paymentKind = d.amortisationOnly || d.alone ? "amortisation" : "whole";
      drafts.push({ ...d.fields, ...(d.fields.paymentCents ? { paymentKind } : {}), ...(d.kind ? { kind: d.kind } : {}), warnings: d.warnings });
    });
    return drafts;
  }
}

/**
 * One draft per loan found in `text`, in the order of the text; an empty list when it names no loan figure. Pure: the
 * same text gives the same drafts, and `options.asOf` is the only date that does not come from the text.
 */
export function parseLoanText(text: string, options: LoanTextOptions = {}): LoanDraft[] {
  const all = text.normalize("NFC").split(LINE_BREAK, MAX_LINES);
  const mark = all.findIndex((line) => line.trim() === DIMMED_PAGE_LINE);
  const drafts = readLines(mark < 0 ? all : all.slice(0, mark));
  if (mark >= 0) drafts.fillFrom(readLines(all.slice(mark + 1)));
  return drafts.finish(options);
}

function readLines(raw: readonly string[]): Drafts {
  const lines = raw.map(toLine).filter((l) => l.shown !== "");
  const drafts = new Drafts();
  const provenLines = provenBelow(lines);
  /** Lines read as the value of the label above them. */
  const taken = new Set<number>();
  /** The line above was a label alone with no value: this may be a column of labels with the values after them. */
  let stacked = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    let labels = labelsOf(line);
    let broken = false;
    const above = lines[i - 1];
    const aboveTaken = taken.has(i - 1);
    // asked of the label's own line: a label broken over two lines stands in no proven run
    const proven = provenLines.has(i);
    if (labels.length === 0) {
      const joined = brokenLabel(line, lines[i + 1]);
      if (!joined) {
        // the lender's name over its own label is no heading
        if (!lenderCaption(lines[i + 1])) drafts.heading(line);
        drafts.kind(line);
        stacked = false;
        continue;
      }
      ({ line, labels } = joined);
      broken = true;
      i++;
    }
    const underLabel = stacked;
    stacked = false;
    for (let j = 0; j < labels.length; j++) {
      const hit = labels[j]!;
      const next = labels[j + 1];
      const end = next ? next.start : line.text.length;
      const own = !next || HARD_BREAK.test(line.text.slice(0, next.start));
      if (hit.field === "marker") {
        drafts.marker(hit.label);
        if (!own) break;
        continue;
      }
      let got = read(hit.field, line.text.slice(hit.end, end), line.folded.slice(hit.end, end), hit.certain);
      let shown = line.shown;
      let near = true;
      if (!got && labels.length === 1) {
        const tail = tailOf(line.text.slice(hit.end));
        let under = tail === "closed" ? null : below(hit.field, lines, i);
        // Under a label that had no value, the line below is this label's only when a label follows it again
        // (label, value, label). Otherwise the labels are a column, and the value may be the first label's.
        const after = under && lines[under.index + 1];
        if (underLabel && after && labelsOf(after).length === 0) under = null;
        // A value above the label and one below it, in a run not proven to put values below: whose the label's is, is not known.
        if (!proven && above && !aboveTaken && wholeLine(hit.field, above)) under = null;
        if (under) {
          got = under.got;
          shown = `${line.shown} ${under.line.shown}`;
          near = proven && under.near && tail === "none" && !underLabel;
          i = under.index;
          taken.add(i);
        } else {
          const over = tail === "none" && !aboveTaken ? valueAbove(hit, above) : null;
          stacked = tail === "none" && !over;
          if (over) {
            got = over;
            shown = `${above!.shown} ${line.shown}`;
            near = false;
          }
        }
      }
      // the next label is not known to be a label of its own, so this value may run on through it: neither is read.
      // A name can hold a label's word ("Laina ja Korko Oy"), so a lender is never cut at one.
      if (!own && (hit.field === "lender" || !got?.clean)) break;
      if (!got) continue;
      drafts.read(hit, got, shown, hit.exact && hit.certain && !broken && near && got.clean && !got.doubt ? "sure" : "check");
    }
  }
  return drafts;
}
