/**
 * Asetukset > Palvelin ja ylläpito: the Versio card never calls an install up to date while commits wait for it, and the
 * system check says when it ran under another version.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DoctorList } from "../src/components/ops/DoctorList.tsx";
import type { OpsSnapshot } from "../src/components/ops/types.ts";
import { UpdatePanel } from "../src/components/ops/UpdatePanel.tsx";

const panel = (state: OpsSnapshot) =>
  renderToStaticMarkup(createElement(UpdatePanel, { version: "1.4.0", build: "abc1234", state, disabled: false, prerelease: null, onCheck: () => {}, onUpdate: () => {}, onRollback: () => {} }));

const commits = [{ hash: "abc1234", subject: "Fix a figure" }];

describe("Versio: up to date only when nothing waits", () => {
  it("says up to date when the check found nothing", () => {
    expect(panel({ update_available: false, checked_at: "2026-11-15T10:00:00Z" })).toContain("Ajan tasalla");
  });

  it("offers the update and lists the commits when update_available is true", () => {
    const html = panel({ update_available: true, behind_commits: commits, checked_at: "2026-11-15T10:00:00Z" });
    expect(html).toContain("Uusi versio saatavilla");
    expect(html).toContain("Fix a figure");
    expect(html).not.toContain("Ajan tasalla");
  });

  it("never says up to date while commits wait, whatever update_available says", () => {
    const html = panel({ update_available: false, behind_commits: commits, checked_at: "2026-11-15T10:00:00Z" });
    expect(html).not.toContain("Ajan tasalla");
    expect(html).toContain("Fix a figure");
  });
});

describe("Tila: a system check from before an update", () => {
  const doctor = { at: "2026-11-14T10:00:00Z", items: [] };
  const list = (stale: boolean) => renderToStaticMarkup(createElement(DoctorList, { doctor, stale, last: undefined, disabled: false, onRun: () => {} }));

  it("says the results are old and asks for a new run", () => {
    expect(list(true)).toContain("Tulokset ovat ajalta ennen päivitystä. Aja tarkistus uudelleen.");
  });

  it("says nothing of it for a current result", () => {
    expect(list(false)).not.toContain("ennen päivitystä");
  });
});
