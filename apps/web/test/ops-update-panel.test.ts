/**
 * Asetukset > Palvelin ja ylläpito: the Versio card never calls an install up to date while commits wait for it, and the
 * system check says when it ran under another version.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DoctorList } from "../src/components/ops/DoctorList.tsx";
import { ToolsPanel } from "../src/components/ops/ToolsPanel.tsx";
import type { OpsRequestView, OpsSnapshot } from "../src/components/ops/types.ts";
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
  const list = (stale: boolean) => renderToStaticMarkup(createElement(DoctorList, { doctor, stale }));

  it("says the results are old and asks for a new run", () => {
    expect(list(true)).toContain("Tulokset ovat ajalta ennen päivitystä. Aja tarkistus uudelleen.");
  });

  it("says nothing of it for a current result", () => {
    expect(list(false)).not.toContain("ennen päivitystä");
  });

  it("draws nothing before the first run", () => {
    expect(renderToStaticMarkup(createElement(DoctorList, { doctor: undefined }))).toBe("");
  });
});

describe("Huolto: the servicing actions as one list", () => {
  const ran: OpsRequestView = { id: "a", action: "logs", label: "Lokit", status: "ok", by: null, requestedAt: "2026-11-15T10:00:00Z", finishedAt: "2026-11-15T10:00:00Z", summary: null, output: null, steps: [] };
  const tools = (last: Record<string, OpsRequestView>) =>
    renderToStaticMarkup(createElement(ToolsPanel, { disabled: false, readDisabled: false, supported: true, enableCommand: "", last, onDoctor: () => {}, onLogs: () => {}, onPrune: () => {}, onRenew: () => {}, onRestart: () => {} }));

  it("has the status, logs, clean-up, renewal and restart as five list items", () => {
    expect(tools({}).match(/<li>/g)).toHaveLength(5);
  });

  it("never says that an action has not run, and tells only the one that ran", () => {
    expect(tools({})).not.toContain("Ei ajettu");
    const html = tools({ logs: ran });
    expect(html).not.toContain("Ei ajettu");
    expect(html.match(/Viimeksi/g)).toHaveLength(1);
  });
});
