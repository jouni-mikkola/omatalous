/** Ylläpitoloki: the 25 newest events in sight, the rest behind Näytä lisää, so the page stays a few screens long. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OpsLog } from "../src/components/ops/OpsLog.tsx";
import type { AuditEvent } from "../src/components/ops/types.ts";

const events = (n: number): AuditEvent[] =>
  Array.from({ length: n }, (_, i) => ({ id: n - i, at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T03:00:00.000Z`, username: "admin", ip: null, action: `update-${i}`, outcome: "ok" }));

const html = (list: AuditEvent[]) => renderToStaticMarkup(createElement(OpsLog, { events: list }));

describe("OpsLog", () => {
  it("shows the 25 newest of 150 and the way to the rest", () => {
    const out = html(events(150));
    expect(out.match(/<tbody[\s\S]*<\/tbody>/)![0].match(/<tr/g)).toHaveLength(25);
    expect(out).toContain("update-24");
    expect(out).not.toContain("update-25<");
    expect(out).toMatch(/Näytä 25 lisää/);
  });
  it("folds nothing with 25 or fewer, and says when there is none", () => {
    expect(html(events(25))).not.toMatch(/Näytä \d+ lisää/);
    expect(html([])).toContain("Ei merkintöjä.");
  });
});
