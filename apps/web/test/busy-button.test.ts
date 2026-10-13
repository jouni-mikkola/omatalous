import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "../src/components/ConfirmDialog.tsx";

const SRC = join(import.meta.dirname, "../src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));
}

// The opening tags of every <button, read to the closing ">" outside braces (an arrow "=>" sits inside them).
function buttonTags(src: string): string[] {
  const tags: string[] = [];
  for (const m of src.matchAll(/<button\b/g)) {
    let depth = 0;
    let i = m.index!;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(src.slice(m.index!, i + 1));
  }
  return tags;
}

// A button disabled by a name of "something is running" must say so. Not "disabled={disabled}": that one is the parent's.
const WAITING = /disabled=\{[^}]*\b(?:busy|saving|working|pending|loading|sending|finishing)\b/;

// Buttons the waiting mark does not belong on: file, a piece of the tag, why.
const NOT_OWN_ACTION: [string, string, string][] = [
  ["components/loans/LoanEditor.tsx", "onCancel", "cancel is held while the save beside it runs"],
  ["components/ops/ResetCard.tsx", "setAsk(true)", "opens the dialog; the dialog's button waits"],
  ["pages/Transactions.tsx", "setPaging", "disabled also at the last page, and a page fetch is not this click"],
  ["pages/settings/AccountUse.tsx", "aria-pressed", "a choice switch that saves with the form below"],
  ["pages/settings/Members.tsx", "setRemoving(u)", "opens the dialog; the dialog's button waits"],
];

const confirm = (busy: boolean) => renderToStaticMarkup(createElement(ConfirmDialog, { title: "Poistetaanko?", children: "ESIMERKKI OY", confirmLabel: "Poista", busy, onConfirm: () => {}, onCancel: () => {} }));

describe("a button that waits for its request", () => {
  it("carries aria-busy beside disabled while it waits, and neither after", () => {
    const waiting = confirm(true).match(/<button[^>]*>Poista<\/button>/)![0];
    expect(waiting).toContain("disabled");
    expect(waiting).toContain('aria-busy="true"');
    const rest = confirm(false).match(/<button[^>]*>Poista<\/button>/)![0];
    expect(rest).not.toContain("disabled");
    expect(rest).not.toContain("aria-busy");
  });

  it("is so on every submit button disabled by a plain busy or saving flag", () => {
    const bare: string[] = [];
    for (const file of sources(SRC)) {
      for (const m of readFileSync(file, "utf8").matchAll(/<button\b[^>]*type="submit"[^>]*>/g)) {
        const flag = /disabled=\{(busy|saving|finishing)(?:\}| \|\|)/.exec(m[0]);
        if (flag && !m[0].includes(`aria-busy={${flag[1]}`)) bare.push(`${file}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(bare).toEqual([]);
  });

  it("is so on every button disabled by a waiting flag, but the ones listed with a reason", () => {
    const bare: string[] = [];
    for (const file of sources(SRC)) {
      for (const tag of buttonTags(readFileSync(file, "utf8"))) {
        if (!WAITING.test(tag) || tag.includes("aria-busy")) continue;
        const where = relative(SRC, file).replaceAll("\\", "/");
        if (NOT_OWN_ACTION.some(([f, needle]) => f === where && tag.includes(needle))) continue;
        bare.push(`${where}: ${tag.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
    expect(bare).toEqual([]);
  });

  it("finds the opening tag across lines and arrows, passes a busy button, fails a bare one", () => {
    const tags = (src: string) => buttonTags(src).filter((t) => WAITING.test(t) && !t.includes("aria-busy"));
    expect(tags("<button\n  disabled={busy}\n  onClick={() => go()}\n>")).toHaveLength(1);
    expect(tags("<button disabled={busy} aria-busy={busy || undefined} onClick={() => go()}>")).toHaveLength(0);
    expect(tags("<button disabled={text === \"\"} onClick={() => go()}>")).toHaveLength(0);
  });
});
