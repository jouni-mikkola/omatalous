import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

describe("the member's language", () => {
  it("is Finnish until chosen, is kept per member, and is checked", async () => {
    const { admin, db, adminId } = await setupApp();
    expect((await admin.call("GET", "/api/auth/state")).body.user.language).toBe("fi");

    const set = await admin.call("PUT", "/api/language", { language: "en" });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ language: "en" });
    expect(await db.first("SELECT language FROM users WHERE id = ?", [adminId])).toEqual({ language: "en" });
    expect((await admin.call("GET", "/api/auth/state")).body.user.language).toBe("en");

    for (const bad of [{ language: "sv" }, { language: 1 }, {}, { language: "en", extra: true }]) {
      const res = await admin.call("PUT", "/api/language", bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await admin.call("GET", "/api/auth/state")).body.user.language).toBe("en");
  });

  it("answers a refusal in the member's language, with the code beside the sentence", async () => {
    const { admin } = await setupApp();
    const fi = await admin.call("PUT", "/api/language", { language: "xx" });
    expect(fi.body).toMatchObject({ error: "Tuntematon kieli.", messageCode: "check.language" });
    await admin.call("PUT", "/api/language", { language: "en" });
    const en = await admin.call("PUT", "/api/language", { language: "xx" });
    expect(en.body).toMatchObject({ error: "Unknown language.", messageCode: "check.language" });
    // a refusal made before the route (the CSRF guard, the admin gate) is in English too
    const csrf = await admin.call("PUT", "/api/language", { language: "fi" }, { "X-Requested-With": "" });
    expect(csrf.status).toBe(403);
    expect(csrf.body).toMatchObject({ error: "Invalid request. Reload the page.", messageCode: "app.bad_request" });
  });
});
