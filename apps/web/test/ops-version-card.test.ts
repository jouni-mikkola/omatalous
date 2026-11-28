/** The Versio card of Asetukset > Ylläpito: no switch for new versions (every release is offered at once), the channel line, the empty card. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { S } from "../src/components/ops/ops-strings.ts";
import type { OpsSnapshot } from "../src/components/ops/types.ts";
import { UpdatePanel, VersionFacts } from "../src/components/ops/UpdatePanel.tsx";

const panel = (state: OpsSnapshot, disabled = false) =>
  renderToStaticMarkup(createElement(UpdatePanel, { version: "0.10.0", build: "abc1234", state, disabled, onCheck: () => {}, onUpdate: () => {}, onRollback: () => {} }));

describe("the card has no switch for new versions", () => {
  it("shows none, whatever an older helper reports about its old setting", () => {
    for (const state of [{ channel: "release" }, { prerelease: "yes", channel: "release" }, { prerelease: "no" }, { channel: "source" }] as OpsSnapshot[]) {
      const html = panel(state);
      expect(html, JSON.stringify(state)).not.toContain('role="switch"');
      expect(html, JSON.stringify(state)).not.toContain("Tarjoa uudet versiot heti");
    }
    expect(Object.keys(S)).not.toContain("prerelease");
  });
});

describe("the update channel", () => {
  const facts = (state: OpsSnapshot) => renderToStaticMarkup(createElement(VersionFacts, { state }));
  it("is shown read-only in the technical details as the helper reports it, and not before", () => {
    expect(facts({ channel: "private" })).toContain("Päivityskanava: yksityinen kehitysversio");
    expect(facts({ channel: "release" })).toContain("Päivityskanava: julkinen");
    expect(facts({ channel: "private" })).not.toMatch(/<(input|select|button)[^>]*(channel|kanava)/i);
    expect(facts({})).toBe("");
    expect(panel({ channel: "private" })).not.toContain("Päivityskanava");
  });
});

describe("Versio with nothing to show", () => {
  const bare = {} as OpsSnapshot;
  it("is the head alone: no body, no dash", () => {
    const html = panel(bare);
    expect(html).toContain("<h2>Versio</h2>");
    expect(html).not.toContain("–");
    expect(html).not.toContain('class="form-row"');
    expect(html).not.toContain('class="muted"');
  });
  it("keeps its body once there is a check, an update or a rollback", () => {
    expect(panel({ checked_at: "2026-03-01T10:00:00.000Z" } as OpsSnapshot)).toContain(", ajan tasalla");
    expect(panel({ update_available: true } as OpsSnapshot)).toContain('class="form-row"');
    expect(panel({ can_rollback: true } as OpsSnapshot)).toContain('class="form-row"');
  });
  it("names the new version when the helper has said which it is", () => {
    expect(panel({ update_available: true, latest_version: "0.59.0" } as OpsSnapshot)).toContain("Uusi versio 0.59.0 saatavilla");
    expect(panel({ update_available: true } as OpsSnapshot)).toContain("Uusi versio saatavilla");
  });
  it("the update dialog names the version to install", () => {
    expect(S.updateTo("0.59.0")).toBe("Päivitämme versioon 0.59.0.");
    // the version not known: no line, the dialog keeps its old text
    expect(S.updateTo(undefined)).toBeNull();
    expect(S.updateTo("")).toBeNull();
  });
});
