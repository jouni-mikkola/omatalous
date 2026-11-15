/** The page names the add-on module only to a signed-in request: the sign-in page is the build's own file, byte for byte. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { staticFiles } from "../src/static-files.ts";
import { scratchDir } from "./helpers.ts";

const INDEX = "<!doctype html><html><head><title>x</title></head><body><p>the page</p></body></html>";
const TAG = '<meta name="omatalous-module" content="/modules/example/1.2.0/">';

function served() {
  const dir = join(scratchDir("static-add-on-"), "dist");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), INDEX);
  const app = new Hono();
  staticFiles(app, dir, { headTag: TAG, signedIn: async (c) => c.req.header("cookie") === "session=ok" });
  return (path: string, signedIn: boolean) => app.request(path, { headers: signedIn ? { Cookie: "session=ok" } : {} });
}

describe("the page with an add-on module loaded", () => {
  it("names the module to a signed-in request, at the root and at an address of the app", async () => {
    const get = served();
    for (const path of ["/", "/index.html", "/raportit", "/asetukset/palvelin"]) {
      const res = await get(path, true);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain(TAG);
      expect(res.headers.get("cache-control"), path).toBe("no-cache");
      expect(res.headers.get("vary") ?? "", path).toContain("Cookie");
    }
  });

  it("is the build's own file for a request with no session, which names nothing", async () => {
    const get = served();
    for (const path of ["/", "/index.html", "/raportit", "/asetukset/palvelin"]) {
      const res = await get(path, false);
      expect(res.status, path).toBe(200);
      const text = await res.text();
      expect(text, path).toBe(INDEX);
      expect(text, path).not.toContain("omatalous-module");
      expect(text, path).not.toContain("/modules/");
      expect(res.headers.get("vary") ?? "", path).toContain("Cookie");
    }
  });

  it("leaves the files of the build as they are", async () => {
    const get = served();
    expect((await get("/assets/index-OLD123.js", false)).status).toBe(404);
  });
});
