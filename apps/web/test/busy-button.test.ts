import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "../src/components/ConfirmDialog.tsx";

const SRC = join(import.meta.dirname, "../src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));
}

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
});
