/** Pankkihaut: the latest fetch and the ones that did not succeed. A column nobody filled is not drawn, and Uusia is a figure column. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunsTable } from "../src/pages/settings/SyncRuns.tsx";
import type { SyncRun } from "../src/types.ts";

const run = (id: number, message: string | null, status: SyncRun["status"] = "ok"): SyncRun => ({ id, startedAt: "2026-10-13T06:15:00Z", trigger: "schedule", status, inserted: 3, message }) as unknown as SyncRun;
const html = (runs: SyncRun[]) => renderToStaticMarkup(createElement(RunsTable, { runs }));
const bodyRows = (out: string) => out.match(/<tbody[\s\S]*<\/tbody>/)![0].match(/<tr/g)?.length ?? 0;

describe("RunsTable", () => {
  it("draws no Viesti column while every shown row has no message", () => {
    const out = html([run(1, null), run(2, "")]);
    expect(out).not.toContain("Viesti");
    expect(out.match(/<th scope="col"/g)).toHaveLength(4);
    expect(out).toMatch(/<th scope="col" class="num"[^>]*>(<button[^>]*>)?Uusia/);
  });
  it("draws the column as soon as one shown row has a message", () => {
    const out = html([run(1, "Esimerkkipankki vastasi hitaasti", "failed"), run(2, null)]);
    expect(out).toContain("Viesti");
    expect(out.match(/<th scope="col"/g)).toHaveLength(5);
    expect(out).toContain("Esimerkkipankki vastasi hitaasti");
  });
  it("shows the latest fetch alone when every run succeeded", () => {
    const out = html(Array.from({ length: 20 }, (_, i) => run(20 - i, null)));
    expect(bodyRows(out)).toBe(1);
    expect(out).not.toMatch(/Näytä \d+ lisää/);
  });
  it("adds the earlier runs that failed or only partly worked, newest first, and leaves the quiet ones out", () => {
    const out = html([run(5, null), run(4, null), run(3, "Esimerkkipankki ei vastannut", "failed"), run(2, null), run(1, "Yksi tili puuttui", "partial")]);
    expect(bodyRows(out)).toBe(3);
    expect(out.indexOf("Esimerkkipankki ei vastannut")).toBeLessThan(out.indexOf("Yksi tili puuttui"));
    expect(out).toContain("epäonnistui");
    expect(out).toContain("osittain");
  });
  it("keeps a failed latest run once", () => {
    expect(bodyRows(html([run(2, "Esimerkkipankki ei vastannut", "failed"), run(1, null)]))).toBe(1);
  });
  it("has no search box, however many runs there are", () => {
    const out = html(Array.from({ length: 20 }, (_, i) => run(20 - i, null, "failed")));
    expect(out).not.toContain("Hae: Pankkihaut");
    expect(out).not.toContain("rtb-search");
    expect(bodyRows(out)).toBe(10);
    expect(out).toMatch(/Näytä 10 lisää/);
  });
});
