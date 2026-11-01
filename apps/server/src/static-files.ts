/**
 * The built web app as static files (entry/node.ts mounts it after every API route).
 */
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { COMPRESSIBLE_CONTENT_TYPE_REGEX } from "hono/utils/compress";

/** Vite's /assets/* names contain a content hash: cache forever. */
const HASHED = "/assets/";

/**
 * Serves `root`. The build leaves `<file>.br` and `<file>.gz` beside each text file (apps/web/compress-build.ts) and
 * the file that fits the request's `Accept-Encoding` goes out as it is, with `Content-Encoding`. `Vary:
 * Accept-Encoding` is on every text file, also when the client gets the plain one, so a cache keeps the versions
 * apart. Fonts and pictures are sent as they are. The page itself must be revalidated, so a browser picks up a new
 * version right after an upgrade.
 */
export function staticFiles(app: Hono<any>, root: string): void {
  app.use("/*", async (c, next) => {
    await next();
    if (c.req.path.startsWith("/api/") || !c.res.ok) return;
    c.header("Cache-Control", c.req.path.startsWith(HASHED) ? "public, max-age=31536000, immutable" : "no-cache");
    const type = c.res.headers.get("Content-Type") ?? "";
    if (COMPRESSIBLE_CONTENT_TYPE_REGEX.test(type) && !/accept-encoding/i.test(c.res.headers.get("Vary") ?? "")) c.header("Vary", "Accept-Encoding", { append: true });
  });
  app.use("/*", serveStatic({ root, precompressed: true }));
  app.get("*", serveStatic({ root, precompressed: true, path: "index.html" }));
}
