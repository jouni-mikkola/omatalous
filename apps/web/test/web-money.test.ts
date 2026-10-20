import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * One definition per figure (ADR 0004, ILME.md 2.3): the web draws the figures the server sends and adds up no money of
 * its own, so two parts of one screen can never disagree. This finds cents added, taken from each other or reduced in
 * apps/web/src. KNOWN is what is left today, one count per file; it only shrinks: a file that loses a sum loses its
 * count, and a new file or a higher count fails.
 */
const MONEY = /[a-zA-Z]Cents\s*[-+]\s*[a-zA-Z.]*Cents|reduce\(.*Cents|\+=\s*[a-zA-Z.]*Cents/g;

const KNOWN: Record<string, number> = {
  "components/next-days-line.ts": 1,
  "pages/Bills.tsx": 1,
  "pages/settings/account-use.ts": 1,
};

const SRC = new URL("../src/", import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

function moneySums(text: string): number {
  return text.match(MONEY)?.length ?? 0;
}

describe("the web adds up no money of its own", () => {
  it("finds a sum of cents and passes a figure that is only drawn", () => {
    expect(moneySums("const left = incomeCents - spentCents;")).toBe(1);
    expect(moneySums("rows.reduce((s, r) => s + r.amountCents, 0)")).toBe(1);
    expect(moneySums("total += row.amountCents;")).toBe(1);
    expect(moneySums("<Figure text={money(totals.leftCents)} />")).toBe(0);
  });

  it("has no sum of money beyond the list of what is left, and the list holds no file that has none", () => {
    const found = Object.fromEntries(files(SRC).map((f) => [f.slice(SRC.length), moneySums(readFileSync(f, "utf8"))] as const).filter(([, n]) => n > 0));
    const over = Object.entries(found).filter(([f, n]) => n > (KNOWN[f] ?? 0)).map(([f, n]) => `${f}: ${n} (allowed ${KNOWN[f] ?? 0})`);
    const stale = Object.entries(KNOWN).filter(([f, n]) => (found[f] ?? 0) < n).map(([f]) => `${f}: lower its count in KNOWN`);
    expect([...over, ...stale]).toEqual([]);
  });
});
