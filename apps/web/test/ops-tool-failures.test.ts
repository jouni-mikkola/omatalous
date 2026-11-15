/**
 * Asetukset > Palvelin ja ylläpito: a servicing action that failed is said outside the fold of the technical details,
 * also when another action ran after it.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OpsRequestView, OpsState } from "../src/components/ops/types.ts";
import { Maintenance, useOpsState } from "../src/pages/settings/Maintenance.tsx";

const AT = "2026-11-15T10:00:00.000Z";
const request = (id: string, action: string, label: string, status: OpsRequestView["status"], summary: string | null): OpsRequestView => ({ id, action, label, status, by: null, requestedAt: AT, finishedAt: AT, summary, output: null, steps: [] });

const renewFailed = request("a", "helper-renew", "Apurin uusiminen", "failed", "Levy täynnä");
const logsRead = request("b", "logs", "Lokien luku", "ok", null);

const page = (last: OpsState["last"], requests: OpsRequestView[]) => {
  const data: OpsState = {
    version: "1.4.0",
    build: "abc1234",
    helper: { status: "ok", reason: null, seenAt: AT, version: "2", outdated: false, tools: true, knowsPrerelease: true, wakes: true, enableCommand: "" },
    state: { update_available: false, checked_at: AT },
    requests,
    last,
    active: false,
    readOnlyActive: false,
    now: AT,
  };
  const ops: ReturnType<typeof useOpsState> = { data, error: null, downSince: null, reload: async () => {} };
  const html = renderToStaticMarkup(createElement(Maintenance, { ops }));
  const fold = html.indexOf("<details");
  return { outside: html.slice(0, fold), inside: html.slice(fold) };
};

describe("Ylläpito: a failed servicing action stays in view", () => {
  it("says a failed renewal outside the fold after the logs were read", () => {
    const { outside, inside } = page({ "helper-renew": renewFailed, logs: logsRead }, [logsRead, renewFailed]);
    expect(outside).toContain("Apurin uusiminen");
    expect(outside).toContain("Levy täynnä");
    expect(inside).toContain("Lokien luku");
  });

  it("says nothing of an action that ended well, or that never ran", () => {
    const { outside } = page({ logs: logsRead }, [logsRead]);
    expect(outside).not.toContain("Epäonnistui");
    expect(outside).not.toContain("Lokien luku");
  });

  it("drops the failure when the same action succeeds afterwards", () => {
    const renewed = request("c", "helper-renew", "Apurin uusiminen", "ok", null);
    const { outside } = page({ "helper-renew": renewed, logs: logsRead }, [renewed, logsRead]);
    expect(outside).not.toContain("Levy täynnä");
  });
});
