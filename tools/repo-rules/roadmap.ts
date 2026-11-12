/**
 * Rule 34: the public docs/ROADMAP.md lists no shipped release as coming. A heading under "## Coming releases" that
 * names a version at or below the released one fails, so the release that ships a version also moves it to "## Done".
 * The version is that of apps/server/package.json: the root package.json has none, and prepare.mjs bumps the three
 * package files together.
 */

const VERSION = /\b(\d+)\.(\d+)\.(\d+)\b/g;

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

/** The headings of the "Coming releases" section that name a version at or below `released`. Prose lines are not read. */
export function shippedAsComing(text: string, released: string): { line: number; why: string }[] {
  const current = released.split(".").map(Number);
  const found: { line: number; why: string }[] = [];
  let coming = false;
  text.split("\n").forEach((raw, i) => {
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (!heading) return;
    if ((heading[1] ?? "").length <= 2) {
      coming = /^coming releases\b/i.test(heading[2] ?? "");
      return;
    }
    if (!coming) return;
    for (const m of (heading[2] ?? "").matchAll(VERSION)) {
      if (compare([Number(m[1]), Number(m[2]), Number(m[3])], current) <= 0) found.push({ line: i + 1, why: `lists ${m[0]} as coming, and ${released} is out` });
    }
  });
  return found;
}

const REVIEWED = /^Last reviewed: (\d{4})-(\d{2})-(\d{2})\s*$/m;
const MONTHS = 6;

/**
 * The dated review note of the payment rules watch in docs/BANK_NOTES.md. `today` is given by the caller (core stays
 * pure, and so does this module: the test reads the clock). The note is stale when `today` is more than 6 calendar
 * months after the date, or when it is missing, unparsable or dated in the future.
 */
export function staleReview(text: string, today: string): { line: number; why: string } | undefined {
  const section = /^## Payment rules watch\s*$/m.exec(text);
  if (!section) return { line: 1, why: 'has no "## Payment rules watch" section' };
  const rest = text.slice(section.index);
  const next = rest.slice(3).search(/^## /m);
  const body = next < 0 ? rest : rest.slice(0, next + 3);
  const m = REVIEWED.exec(body);
  const line = text.slice(0, section.index + (m?.index ?? 0)).split("\n").length;
  const fail = (why: string) => ({ line, why });
  if (!m) return fail('the Payment rules watch section has no "Last reviewed: YYYY-MM-DD" line');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return fail(`the review date ${m[1]}-${m[2]}-${m[3]} is not a date`);
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  if (iso > today) return fail(`the review date ${iso} is after ${today}`);
  const limit = new Date(Date.UTC(y, mo - 1 + MONTHS, d));
  // A day that does not exist 6 months later (31 August + 6) rolls over; clamp to the last day of that month.
  if (limit.getUTCDate() !== d) limit.setUTCDate(0);
  const limitIso = limit.toISOString().slice(0, 10);
  return today > limitIso ? fail(`the review of ${iso} is more than ${MONTHS} months old on ${today}; review the rules again and set the date`) : undefined;
}

/**
 * Rule 47: the front matter of WORKFLOW.md is YAML the board can read, and its check line is a bare command. The file
 * is read by line, with no YAML parser. A value written plain that holds a colon and a space, or a space and a `#`, is
 * not the string it looks like, and the board answers 400 on its state. The board runs the text after `check:` as it
 * stands, so a check value in quotes (or behind another YAML mark) is a command sh cannot find (exit 127). Another key
 * may be quoted when its quotes close at the end of the line.
 */
export function unreadableFrontMatter(text: string): { line: number; why: string }[] {
  const lines = text.split("\n");
  if (lines[0]?.trimEnd() !== "---") return [];
  const found: { line: number; why: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (raw.trimEnd() === "---") return found;
    // The board finds the check line with or without a space after the colon, so `check:'cmd'` is judged as well.
    const m = /^([A-Za-z_][\w-]*):\s+(.*?)\s*$/.exec(raw) ?? /^(check):(.*?)\s*$/.exec(raw);
    if (!m) continue;
    const [key, value] = [m[1] ?? "", m[2] ?? ""];
    const quote = value[0];
    if (key === "check" && /^['"|>&*![{%@`]/.test(value)) {
      found.push({ line: i + 1, why: "the check line starts with a quote or another YAML mark" });
      continue;
    }
    if (quote === "'" || quote === '"') {
      const inner = value.slice(1, -1);
      const closed = value.length > 1 && value.endsWith(quote) && (quote === "'" ? !inner.replaceAll("''", "").includes("'") : !/(^|[^\\])(\\\\)*"/.test(inner));
      if (!closed) found.push({ line: i + 1, why: `the quotes of "${key}" do not close at the end of the line` });
      continue;
    }
    if (/:\s|\s#/.test(value)) found.push({ line: i + 1, why: `the value of "${key}" has a colon and a space, or a space and a hash, in it` });
    else if (value.endsWith(":")) found.push({ line: i + 1, why: `the value of "${key}" ends in a colon` });
  }
  return [{ line: 1, why: "the front matter has no closing --- line" }];
}
