/** What the browser gets of the built app and of the API: pre-compressed files by Accept-Encoding, packed answers over 1 kB. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { compressFolder } from "../../web/compress-build.ts";
import { apiCompression } from "../src/platform/api-compress.ts";
import { staticFiles } from "../src/static-files.ts";
import { scratchDir, setupApp } from "./helpers.ts";

const SCRIPT = `export const rows = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ id: i, name: `row ${i}` })))};\n`;
const FONT = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7919) % 251));
const INDEX = `<!doctype html><title>x</title>${"<p>hello</p>".repeat(200)}`;

/** A built app with the files the build writes, compressed the way the build compresses them. */
function built() {
  const dir = scratchDir("static-compress-");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), INDEX);
  writeFileSync(join(dir, "assets", "index-abc.js"), SCRIPT);
  writeFileSync(join(dir, "assets", "font-abc.woff2"), FONT);
  writeFileSync(join(dir, "tiny.txt"), "small");
  compressFolder(dir);
  const app = new Hono();
  staticFiles(app, dir);
  const get = (path: string, encoding?: string, method = "GET") => app.request(path, { method, headers: encoding === undefined ? {} : { "Accept-Encoding": encoding } });
  return { dir, get };
}

describe("the build's compressed copies", () => {
  it("are written for text files over 1 kB and for nothing else", () => {
    const { dir } = built();
    expect(existsSync(join(dir, "assets", "index-abc.js.br"))).toBe(true);
    expect(existsSync(join(dir, "assets", "index-abc.js.gz"))).toBe(true);
    expect(existsSync(join(dir, "index.html.br"))).toBe(true);
    expect(existsSync(join(dir, "assets", "font-abc.woff2.br"))).toBe(false);
    expect(existsSync(join(dir, "assets", "font-abc.woff2.gz"))).toBe(false);
    expect(existsSync(join(dir, "tiny.txt.br"))).toBe(false);
  });
});

describe("static files", () => {
  it("go out as brotli when the browser takes it", async () => {
    const res = await built().get("/assets/index-abc.js", "gzip, deflate, br");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("vary")).toBe("Accept-Encoding");
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const body = Buffer.from(await res.arrayBuffer());
    expect(Number(res.headers.get("content-length"))).toBe(body.length);
    expect(body.length).toBeLessThan(SCRIPT.length);
    expect(brotliDecompressSync(body).toString()).toBe(SCRIPT);
  });

  it("go out as gzip when it takes no brotli", async () => {
    const res = await built().get("/assets/index-abc.js", "gzip, deflate");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toBe("Accept-Encoding");
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(SCRIPT);
  });

  it("go out plain without the header, and still say Vary", async () => {
    for (const encoding of [undefined, "identity"]) {
      const res = await built().get("/assets/index-abc.js", encoding);
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("vary")).toBe("Accept-Encoding");
      expect(await res.text()).toBe(SCRIPT);
    }
  });

  it("send the page compressed too, revalidated, also for an address the app routes itself", async () => {
    const { get } = built();
    for (const path of ["/", "/index.html", "/rapotit/saldot"]) {
      const res = await get(path, "br");
      expect(res.headers.get("content-encoding")).toBe("br");
      expect(res.headers.get("vary")).toBe("Accept-Encoding");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(brotliDecompressSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(INDEX);
    }
  });

  it("leave fonts and files without a copy alone", async () => {
    const { get } = built();
    const font = await get("/assets/font-abc.woff2", "br, gzip");
    expect(font.headers.get("content-encoding")).toBeNull();
    expect(font.headers.get("vary")).toBeNull();
    expect(Buffer.from(await font.arrayBuffer()).equals(FONT)).toBe(true);
    const tiny = await get("/tiny.txt", "br, gzip");
    expect(tiny.headers.get("content-encoding")).toBeNull();
    expect(await tiny.text()).toBe("small");
  });

  it("answer HEAD with the length of the copy", async () => {
    const res = await built().get("/assets/index-abc.js", "br", "HEAD");
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(Number(res.headers.get("content-length"))).toBeLessThan(SCRIPT.length);
  });
});

describe("API answers", () => {
  /** The middleware of app.ts on routes of its own: one big answer, one small, one packed already, one that is no text. */
  function api() {
    const app = new Hono();
    const big = { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, label: `row ${i}` })) };
    app.use("/api/*", ...apiCompression);
    app.get("/api/big", (c) => c.json(big));
    app.get("/api/small", (c) => c.json({ ok: true }));
    app.get("/api/packed", (c) => c.body(Buffer.from("already"), 200, { "Content-Type": "application/json", "Content-Encoding": "br" }));
    app.get("/api/font", (c) => c.body(FONT, 200, { "Content-Type": "font/woff2" }));
    return { big, get: (path: string, encoding?: string) => app.request(path, { headers: encoding ? { "Accept-Encoding": encoding } : {} }) };
  }

  it("over 1 kB are gzipped when the client takes it", async () => {
    const { big, get } = api();
    const res = await get("/api/big", "gzip, br");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString())).toEqual(big);
  });

  it("over 1 kB stay plain without the header", async () => {
    const { big, get } = api();
    const res = await get("/api/big");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual(big);
  });

  it("under 1 kB stay plain", async () => {
    const res = await api().get("/api/small", "gzip");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  it("with a content-encoding already are not packed again, and fonts are not packed", async () => {
    const { get } = api();
    const packed = await get("/api/packed", "gzip");
    expect(packed.headers.get("content-encoding")).toBe("br");
    expect(await packed.text()).toBe("already");
    const font = await get("/api/font", "gzip");
    expect(font.headers.get("content-encoding")).toBeNull();
  });

  it("of the app are packed with the security headers and no-store left as they were", async () => {
    const { admin, app } = await setupApp();
    const res = await app.request("/api/meta", { headers: { Cookie: admin.cookie, "Accept-Encoding": "gzip" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString())).toHaveProperty("user");
  });
});
