/** Haku pankista: a column nobody filled is not drawn, and Uusia is a figure column. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunsTable } from "../src/pages/settings/Technical.tsx";
import type { SyncRun } from "../src/types.ts";

const run = (id: number, message: string | null): SyncRun => ({ id, startedAt: "2026-10-13T06:15:00Z", trigger: "schedule", status: "ok", inserted: 3, message }) as unknown as SyncRun;
const html = (runs: SyncRun[]) => renderToStaticMarkup(createElement(RunsTable, { runs }));

describe("RunsTable", () => {
  it("draws no Viesti column while every row has no message", () => {
    const out = html([run(1, null), run(2, "")]);
    expect(out).not.toContain("Viesti");
    expect(out.match(/<th scope="col"/g)).toHaveLength(4);
    expect(out).toMatch(/<th scope="col" class="num"[^>]*>(<button[^>]*>)?Uusia/);
  });
  it("draws the column as soon as one row has a message", () => {
    const out = html([run(1, null), run(2, "Esimerkkipankki vastasi hitaasti")]);
    expect(out).toContain("Viesti");
    expect(out.match(/<th scope="col"/g)).toHaveLength(5);
    expect(out).toContain("Esimerkkipankki vastasi hitaasti");
  });
});
