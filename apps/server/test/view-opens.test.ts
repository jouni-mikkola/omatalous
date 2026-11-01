/** Opened views (services/view-opens.ts): the day per view and member, the list of a quarter, no data version, no token. */
import { describe, expect, it } from "vitest";
import { serviceMayRead } from "../src/services/service-tokens.ts";
import { setupApp } from "./helpers.ts";

describe("opened views", () => {
  it("keeps the first and the latest day per view, and lists the views nobody opened for 90 days", async () => {
    // the clock is 2026-10-09 (helpers NOW); older days are written through the repo, since a session ends with a jump of the clock
    const { admin, member, s, adminId } = await setupApp();
    const aino = await member("liisa");
    const version = await s.settings.get("data_version");
    await s.viewOpens.record(adminId, ["report:ennuste", "insight:price", "finding:loans:margin"], "2026-01-10");
    await s.viewOpens.record(aino.id, ["insight:price", "report:ennuste"], "2026-07-20");
    await s.viewOpens.record(aino.id, ["insight:price"], "2026-07-01");
    await aino.call("POST", "/api/views/open", { views: ["report:ennuste", "report:ennuste"] });
    const list = await admin.call("GET", "/api/admin/unopened-views");
    // 90 days before 9.10. is 11.7.: the finding (10.1.) is older, the price insight was opened 20.7. and the report today
    expect(list.body).toEqual({ since: "2026-01-10", today: "2026-10-09", days: 90, views: [{ view: "finding:loans:margin", lastDay: "2026-01-10" }], opened: ["finding:loans:margin", "insight:price", "report:ennuste"] });
    expect(await s.settings.get("data_version")).toBe(version);
  });

  it("refuses a view of another form, an unknown key and a non-admin read", async () => {
    const { admin, member } = await setupApp();
    for (const views of [["report:Ennuste"], ["https://x"], ["finding:loans"], "report:a", [1]]) {
      expect((await admin.call("POST", "/api/views/open", { views })).status).toBe(400);
    }
    expect((await admin.call("POST", "/api/views/open", { views: [], extra: 1 })).status).toBe(400);
    expect((await admin.call("POST", "/api/views/open", { views: [] })).status).toBe(200);
    const aino = await member("liisa");
    expect((await aino.call("GET", "/api/admin/unopened-views")).status).toBe(403);
  });

  it("is shut to service tokens", () => {
    expect(serviceMayRead("GET", "/api/admin/unopened-views")).toBe(false);
    expect(serviceMayRead("POST", "/api/views/open")).toBe(false);
    expect(serviceMayRead("GET", "/api/views/open")).toBe(false);
  });
});
