import { describe, expect, it } from "vitest";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { setupApp } from "./helpers.ts";

/** The updates the page lists as the last one: finished `update` rows, newest first. */
async function updates(s: Awaited<ReturnType<typeof setupApp>>["s"]): Promise<{ summary: string | null; requestedBy: string }[]> {
  return (await s.ops.recent(20)).filter((r) => r.action === "update" && r.status === "ok").map((r) => ({ summary: r.summary, requestedBy: r.requestedBy }));
}

describe("the last update after one made by hand", () => {
  it("writes nothing on the first start of an empty install", async () => {
    const { s } = await setupApp();
    await runUpgradeTasks(s, "1.5.0+first");
    expect(await updates(s)).toEqual([]);
  });

  it("writes one finished update with no requester when a new version starts, and nothing when it starts again", async () => {
    const { s } = await setupApp();
    await runUpgradeTasks(s, "1.4.0+a");
    await runUpgradeTasks(s, "1.5.0+b");
    expect(await updates(s)).toEqual([{ summary: "Päivitetty: 1.4.0 → 1.5.0.", requestedBy: "" }]);
    // a restart of the same build, and another process starting the same build, find the version recorded
    await runUpgradeTasks(s, "1.5.0+b");
    await s.settings.set("app_build", "1.4.0+a");
    await runUpgradeTasks(s, "1.5.0+b");
    expect(await updates(s)).toHaveLength(1);
    // the page then lists it as the last update
    expect((await s.ops.lastPerAction()).find((r) => r.action === "update")?.summary).toBe("Päivitetty: 1.4.0 → 1.5.0.");
  });

  it("writes nothing when an update made on the page already ended in this version", async () => {
    const { s, adminId } = await setupApp();
    await runUpgradeTasks(s, "1.4.0+a");
    expect(await s.ops.insert({ id: "op_page", action: "update", requestedBy: adminId, at: "2026-10-09T09:00:00.000Z" })).toBe(true);
    expect(await s.ops.finish("op_page", { status: "ok", at: "2026-10-09T09:05:00.000Z", summary: "Päivitetty: 1.4.0 → 1.5.0." })).toBe(true);
    await runUpgradeTasks(s, "1.5.0+b");
    expect(await updates(s)).toEqual([{ summary: "Päivitetty: 1.4.0 → 1.5.0.", requestedBy: adminId }]);
  });

  it("writes nothing while the update of the page is claimed and not yet reported, and its report is the last update", async () => {
    const { s, adminId } = await setupApp();
    await runUpgradeTasks(s, "1.4.0+a");
    expect(await s.ops.insert({ id: "op_page", action: "update", requestedBy: adminId, at: "2026-10-09T09:00:00.000Z" })).toBe(true);
    expect(await s.ops.claim("op_page", "2026-10-09T09:00:05.000Z")).toBe(true);
    // the new build starts while the helper still waits for it to answer
    await runUpgradeTasks(s, "1.5.0+b");
    expect((await s.ops.recent(20)).filter((r) => r.action === "update")).toHaveLength(1);
    expect(await s.ops.finish("op_page", { status: "ok", at: "2026-10-09T09:05:00.000Z", summary: "Päivitetty: 1.4.0 → 1.5.0." })).toBe(true);
    expect(await updates(s)).toEqual([{ summary: "Päivitetty: 1.4.0 → 1.5.0.", requestedBy: adminId }]);
  });

  it("adds no row when the update of the page then ends as a rollback", async () => {
    const { s, adminId } = await setupApp();
    await runUpgradeTasks(s, "1.4.0+a");
    expect(await s.ops.insert({ id: "op_page", action: "update", requestedBy: adminId, at: "2026-10-09T09:00:00.000Z" })).toBe(true);
    expect(await s.ops.claim("op_page", "2026-10-09T09:00:05.000Z")).toBe(true);
    await runUpgradeTasks(s, "1.5.0+b");
    expect(await s.ops.finish("op_page", { status: "failed", at: "2026-10-09T09:05:00.000Z", summary: "Päivitys epäonnistui. Edellinen versio palautettiin." })).toBe(true);
    expect(await updates(s)).toEqual([]);
    const rows = (await s.ops.recent(20)).filter((r) => r.action === "update");
    expect(rows.map((r) => [r.id, r.status])).toEqual([["op_page", "failed"]]);
    expect((await s.ops.lastPerAction()).find((r) => r.action === "update")?.summary).toBe("Päivitys epäonnistui. Edellinen versio palautettiin.");
  });

  it("writes one for a later version after an earlier update", async () => {
    const { s, adminId } = await setupApp();
    await runUpgradeTasks(s, "1.4.0+a");
    expect(await s.ops.insert({ id: "op_page", action: "update", requestedBy: adminId, at: "2026-10-09T09:00:00.000Z" })).toBe(true);
    expect(await s.ops.finish("op_page", { status: "ok", at: "2026-10-09T09:05:00.000Z", summary: "Päivitetty: 1.4.0 → 1.5.0." })).toBe(true);
    await runUpgradeTasks(s, "1.5.0+b");
    await runUpgradeTasks(s, "1.6.0+c");
    expect((await updates(s))[0]).toEqual({ summary: "Päivitetty: 1.5.0 → 1.6.0.", requestedBy: "" });
    expect(await updates(s)).toHaveLength(2);
  });
});
