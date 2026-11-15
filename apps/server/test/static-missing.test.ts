/** What the browser gets for an address with no file: 404 for a file an old version asks for, the page for the app's own addresses. */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { staticFiles } from "../src/static-files.ts";
import { scratchDir } from "./helpers.ts";

const INDEX = "<!doctype html><title>x</title><p>the page</p>";
const SCRIPT = "export const here = true;\n";
const SECRET = "outside the folder";

/** A folder of its own with the page and one script, inside a parent that holds a file the server must not reach. */
function built() {
  const parent = scratchDir("static-missing-");
  const dir = join(parent, "dist");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), INDEX);
  writeFileSync(join(dir, "assets", "index-abc.js"), SCRIPT);
  writeFileSync(join(parent, "secret.txt"), SECRET);
  writeFileSync(join(parent, "secret"), SECRET);
  const app = new Hono();
  staticFiles(app, dir);
  return { dir, request: (path: string, method = "GET") => app.request(path, { method }) };
}

describe("an address with no file", () => {
  it("under /assets/ is a 404 that no cache keeps, without the page", async () => {
    const { request } = built();
    for (const path of ["/assets/index-OLD123.js", "/assets/index-OLD123.css", "/assets/chunk", "/assets/"]) {
      for (const method of ["GET", "HEAD"]) {
        const res = await request(path, method);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.headers.get("cache-control"), `${method} ${path}`).toBe("no-store");
        expect(res.headers.get("content-type") ?? "", `${method} ${path}`).not.toContain("text/html");
        expect(await res.text(), `${method} ${path}`).not.toContain("the page");
      }
    }
  });

  it("with a file ending in its last part is a 404 that no cache keeps, without the page", async () => {
    const { request } = built();
    for (const path of ["/favicon.ico", "/sw.js", "/old/logo.png"]) {
      for (const method of ["GET", "HEAD"]) {
        const res = await request(path, method);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.headers.get("cache-control"), `${method} ${path}`).toBe("no-store");
        expect(res.headers.get("content-type") ?? "", `${method} ${path}`).not.toContain("text/html");
        expect(await res.text(), `${method} ${path}`).not.toContain("the page");
      }
    }
  });

  it("with no ending is the page, revalidated", async () => {
    const { request } = built();
    for (const path of ["/", "/raportit", "/asetukset/palvelin"]) {
      const res = await request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain("text/html");
      expect(res.headers.get("cache-control"), path).toBe("no-cache");
      expect(await res.text(), path).toBe(INDEX);
      const head = await request(path, "HEAD");
      expect(head.status, path).toBe(200);
      expect(head.headers.get("cache-control"), path).toBe("no-cache");
    }
  });
});

describe("a file that is there", () => {
  it("under /assets/ keeps its year and says Vary", async () => {
    const { request } = built();
    for (const method of ["GET", "HEAD"]) {
      const res = await request("/assets/index-abc.js", method);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("javascript");
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(res.headers.get("vary")).toBe("Accept-Encoding");
      if (method === "GET") expect(await res.text()).toBe(SCRIPT);
    }
  });
});

describe("a path that climbs out of the folder", () => {
  it("reaches no file outside it, with .. or an encoded slash", async () => {
    const { dir, request } = built();
    const folder = basename(dir);
    const outside = dirname(dir);
    const paths = [
      "/../secret.txt",
      "/assets/../../secret.txt",
      "/..%2Fsecret.txt",
      "/..%2fsecret",
      "/%2e%2e/secret.txt",
      "/%2e%2e%2fsecret",
      "/assets/..%2F..%2Fsecret.txt",
      "/assets%2F..%2F..%2Fsecret",
      "/..%5Csecret.txt",
      "/%2E%2E%5Csecret",
      `/..%2F${folder}%2F..%2Fsecret.txt`,
      `/%2F${encodeURIComponent(outside.slice(1))}%2Fsecret.txt`,
      `/${outside}/secret.txt`,
      "/%E0%A4%A/secret.txt",
    ];
    for (const path of paths) {
      for (const method of ["GET", "HEAD"]) {
        const res = await request(path, method);
        expect(await res.text(), `${method} ${path}`).not.toContain(SECRET);
        if (res.status === 200) expect(res.headers.get("content-type"), `${method} ${path}`).toContain("text/html");
        else expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
  });
});
