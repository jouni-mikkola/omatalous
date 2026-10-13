/** The switch for new versions in the update panel of Asetukset > Ylläpito: when it is there, where it stands, what it sends. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { prereleaseAction, prereleaseOn, S, showsPrerelease } from "../src/components/ops/ops-strings.ts";
import type { HelperInfo, OpsRequestView, OpsSnapshot } from "../src/components/ops/types.ts";
import { UpdatePanel } from "../src/components/ops/UpdatePanel.tsx";

const helper = (over: Partial<HelperInfo> = {}): HelperInfo => ({
  status: "ok",
  reason: null,
  seenAt: "2026-03-01T10:00:00.000Z",
  version: "4",
  outdated: false,
  tools: true,
  knowsPrerelease: true,
  enableCommand: "./scripts/install.sh --ops-helper",
  ...over,
});
const request = (action: string, status: OpsRequestView["status"]): OpsRequestView => ({
  id: "op_0123456789abcdef",
  action,
  label: action,
  status,
  by: "aino",
  requestedAt: "2026-03-01T10:00:00.000Z",
  finishedAt: null,
  summary: null,
  output: null,
  steps: [],
});
const panel = (state: OpsSnapshot, prerelease: { on: boolean; onChange: (on: boolean) => void } | null, disabled = false) =>
  renderToStaticMarkup(createElement(UpdatePanel, { version: "0.10.0", build: "abc1234", state, disabled, prerelease, onCheck: () => {}, onUpdate: () => {}, onRollback: () => {} }));
const switchTag = (html: string) => /<input[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? "";

describe("the switch for new versions", () => {
  it("is shown when the helper is on, knows the two requests and has reported a position on a release install", () => {
    expect(showsPrerelease(helper(), { prerelease: "no", channel: "release" })).toBe(true);
    expect(showsPrerelease(helper({ status: "slow" }), { prerelease: "yes" })).toBe(true);
    // an older helper: the server says it does not know the requests
    expect(showsPrerelease(helper({ version: "3", knowsPrerelease: false }), { prerelease: "no", channel: "release" })).toBe(false);
    expect(showsPrerelease(helper({ status: "off", reason: "stale" }), { prerelease: "no", channel: "release" })).toBe(false);
    expect(showsPrerelease(helper(), { prerelease: "yes", channel: "source" })).toBe(false);
    // a renewed helper that has not sent its snapshot yet: no position to show
    expect(showsPrerelease(helper(), { channel: "release" })).toBe(false);
  });

  it("stands where the host has it, and where a request under way is taking it", () => {
    expect(prereleaseOn({ prerelease: "yes" }, undefined)).toBe(true);
    expect(prereleaseOn({ prerelease: "no" }, undefined)).toBe(false);
    expect(prereleaseOn({}, undefined)).toBe(false);
    expect(prereleaseOn({ prerelease: "no" }, request("prerelease-on", "queued"))).toBe(true);
    expect(prereleaseOn({ prerelease: "yes" }, request("prerelease-off", "running"))).toBe(false);
    // a finished request no longer decides: a failed one leaves the switch where the host has it
    expect(prereleaseOn({ prerelease: "no" }, request("prerelease-on", "failed"))).toBe(false);
    expect(prereleaseOn({ prerelease: "no" }, request("prerelease-on", "expired"))).toBe(false);
    expect(prereleaseOn({ prerelease: "yes" }, request("prerelease-off", "ok"))).toBe(true);
    expect(prereleaseOn({ prerelease: "yes" }, request("backup", "running"))).toBe(true);
  });

  it("sends the request that names the position, and nothing else", () => {
    expect(prereleaseAction(true)).toBe("prerelease-on");
    expect(prereleaseAction(false)).toBe("prerelease-off");
  });

  it("the panel shows the label, the help text and the reported position", () => {
    const on = panel({ prerelease: "yes" }, { on: true, onChange: () => {} });
    expect(on).toContain(S.prerelease);
    expect(on).toContain(S.prereleaseHelp);
    expect(switchTag(on)).toContain(`aria-label="${S.prerelease}"`);
    // the whole row is the label, so that a click on the words turns the switch: the input first, the words, the help under them
    expect(on).toMatch(new RegExp(`<label class="check"><input[^>]*role="switch"[^>]*/><span>${S.prerelease}<span class="field-help">${S.prereleaseHelp}</span></span></label>`));
    expect(switchTag(on)).toMatch(/ checked=""/);
    expect(switchTag(on)).not.toMatch(/ disabled=""/);
    const off = panel({ prerelease: "no" }, { on: false, onChange: () => {} });
    expect(switchTag(off)).not.toBe("");
    expect(switchTag(off)).not.toMatch(/ checked=""/);
    // another request is under way: the switch waits as the buttons do
    expect(switchTag(panel({ prerelease: "no" }, { on: false, onChange: () => {} }, true))).toMatch(/ disabled=""/);
  });

  it("the panel has no switch for an older helper or a source install", () => {
    const html = panel({ channel: "source" }, null);
    expect(switchTag(html)).toBe("");
    expect(html).not.toContain(S.prerelease);
    expect(html).not.toContain(S.prereleaseHelp);
  });
});

describe("Versio with nothing to show", () => {
  const bare = {} as OpsSnapshot;
  it("is the head alone: no body, no dash", () => {
    const html = panel(bare, null);
    expect(html).toContain("<h2>Versio</h2>");
    expect(html).not.toContain("–");
    expect(html).not.toContain('class="form-row"');
    expect(html).not.toContain('class="muted"');
  });
  it("keeps its body once there is a check, an update, a rollback or the switch", () => {
    expect(panel({ checked_at: "2026-03-01T10:00:00.000Z" } as OpsSnapshot, null)).toContain('class="muted"');
    expect(panel({ update_available: true } as OpsSnapshot, null)).toContain('class="form-row"');
    expect(panel({ can_rollback: true } as OpsSnapshot, null)).toContain('class="form-row"');
    expect(panel(bare, { on: false, onChange: () => {} })).toContain('role="switch"');
  });
});
