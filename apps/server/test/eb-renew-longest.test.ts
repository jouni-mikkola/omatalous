/**
 * The longest history after every new consent the user gives, once, and never on a background fetch (a bank limits the
 * calls a day). The record of the days asked (`account_history`) moves only earlier. Made-up data.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { addDays } from "@banking/core";
import { describe, expect, it } from "vitest";
import { syncUser } from "../src/connectors/sync.ts";
import { setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

async function linked() {
  const bank = mockBank();
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
  const idle = () => waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  /** A consent given by the user: the bank sends them back with a code, and the fetch the link sets off runs. */
  const consent = async () => {
    await app.admin.call("POST", "/api/connections/start", {});
    await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await idle();
  };
  await consent();
  const fetches = (uid: string) => bank.calls.filter((c) => c.startsWith(`GET /accounts/${uid}/transactions`) && !c.includes("continuation_key"));
  const longest = (uid: string) => fetches(uid).filter((c) => c.includes("strategy=longest"));
  const history = () => app.db.all<{ account_id: string; asked_from: string; first_row_day: string | null; source: string }>("SELECT account_id, asked_from, first_row_day, source FROM account_history ORDER BY account_id");
  const chk = async () => (await app.s.finance(app.adminId).listAccounts()).find((a) => a.externalId === "u-chk")!;
  return { bank, ...app, consent, fetches, longest, history, chk };
}

describe("the longest history after a new consent", () => {
  it("asks for it at the first link, and a fetch of the same consent does not ask again", async () => {
    const f = await linked();
    expect(f.longest("u-chk")).toHaveLength(1);
    expect(f.longest("u-card")).toHaveLength(1);
    expect((await f.history()).map((h) => h.source)).toEqual(["longest", "longest"]);
    await syncUser(f.s, f.adminId, "manual");
    await syncUser(f.s, f.adminId, "connect");
    expect(f.fetches("u-chk")).toHaveLength(3);
    expect(f.longest("u-chk")).toHaveLength(1);
  });

  it("asks for it once more when the user renews the consent, from the history limit, for each account", async () => {
    const f = await linked();
    await syncUser(f.s, f.adminId, "manual");
    const before = await f.history();
    await f.consent();
    for (const uid of ["u-chk", "u-card"]) {
      expect(f.longest(uid), uid).toHaveLength(2);
      expect(f.longest(uid).at(-1), uid).toContain(`date_from=${addDays(f.s.today(), -f.s.instance.current.historyDays)}`);
    }
    // the fetch after the renewal is an ordinary one again
    await syncUser(f.s, f.adminId, "manual");
    expect(f.longest("u-chk")).toHaveLength(2);
    expect(f.fetches("u-chk").at(-1)).not.toContain("strategy");
    // the rows came in once: the same bank rows are no new rows
    expect(await f.db.all("SELECT 1 FROM transactions WHERE account_id = ?", [(await f.chk()).id])).toHaveLength(2);
    const after = await f.history();
    expect(after.map((h) => h.account_id)).toEqual(before.map((h) => h.account_id));
  });

  it("never asks for it on a background fetch", async () => {
    const f = await linked();
    for (const trigger of ["schedule", "open", "manual"]) await syncUser(f.s, f.adminId, trigger);
    expect(f.longest("u-chk")).toHaveLength(1);
    expect(f.longest("u-card")).toHaveLength(1);
  });

  it("asks on a connect fetch only for a consent nobody has pulled yet: a background fetch that pulled it first used its chance", async () => {
    const f = await linked();
    const unpulled = () => f.db.run("UPDATE connections SET last_synced_at = NULL");
    // near miss: the same consent, not pulled yet, on a connect fetch asks
    await unpulled();
    await syncUser(f.s, f.adminId, "connect");
    expect(f.longest("u-chk")).toHaveLength(2);
    // a background fetch pulls the new consent first and asks nothing; the connect fetch after it asks nothing either
    await unpulled();
    await syncUser(f.s, f.adminId, "schedule");
    await syncUser(f.s, f.adminId, "connect");
    expect(f.longest("u-chk")).toHaveLength(2);
  });

  it("moves the record only earlier: an older day stays, a newer one does not replace it, the word becomes longest", async () => {
    const f = await linked();
    const id = (await f.chk()).id;
    await f.s.finance(f.adminId).recordHistory(id, "2020-01-01", "csv", "2026-10-01T10:00:00.000Z");
    const first = (await f.history()).find((h) => h.account_id === id)!;
    expect(first).toMatchObject({ asked_from: "2020-01-01", source: "csv" });
    await f.consent();
    const renewed = (await f.history()).find((h) => h.account_id === id)!;
    expect(renewed).toMatchObject({ asked_from: "2020-01-01", source: "longest" });
    expect(renewed.first_row_day! <= first.first_row_day!).toBe(true);
    // a default fetch never takes the word back
    await f.s.finance(f.adminId).recordHistory(id, "2019-01-01", "default", "2026-10-02T10:00:00.000Z");
    expect(await f.history()).toContainEqual(expect.objectContaining({ account_id: id, asked_from: "2019-01-01", source: "default" }));
    await f.s.finance(f.adminId).recordHistory(id, "2022-01-01", "longest", "2026-10-03T10:00:00.000Z");
    expect((await f.history()).find((h) => h.account_id === id)).toMatchObject({ asked_from: "2019-01-01", source: "longest" });
  });
});
