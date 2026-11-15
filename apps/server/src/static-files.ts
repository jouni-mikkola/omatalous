/**
 * The built web app as static files (entry/node.ts mounts it after every API route).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Hono } from "hono";
import { COMPRESSIBLE_CONTENT_TYPE_REGEX } from "hono/utils/compress";

/** Vite's /assets/* names contain a content hash: cache forever. */
const HASHED = "/assets/";

/**
 * Serves `root`. The build leaves `<file>.br` and `<file>.gz` beside each text file (apps/web/compress-build.ts) and
 * the file that fits the request's `Accept-Encoding` goes out as it is, with `Content-Encoding`. `Vary:
 * Accept-Encoding` is on every text file, also when the client gets the plain one, so a cache keeps the versions
 * apart. Fonts and pictures are sent as they are. The page itself must be revalidated, so a browser picks up a new
 * version right after an upgrade.
 *
 * An address with no file gets the page only when the app could route it itself. Under /assets/, or with a file ending
 * in its last part, it is a file an old version asks for and the answer is 404, `no-store`: the page as a script
 * would break that tab, and with a year of `immutable` a cache would keep it.
 */
export function staticFiles(app: Hono<any>, root: string, headTag?: string): void {
  // with an add-on module loaded, the page carries one tag more (docs/MODULES.md); without one it is the build's file as it is
  const page = headTag ? readFileSync(join(root, "index.html"), "utf8").replace("</head>", `${headTag}</head>`) : null;
  const servePage = (c: Context) => {
    c.header("Cache-Control", "no-cache");
    return c.html(page!);
  };
  if (page) {
    app.get("/", servePage);
    app.get("/index.html", servePage);
  }
  app.use("/*", async (c, next) => {
    await next();
    if (c.req.path.startsWith("/api/") || !c.res.ok) return;
    c.header("Cache-Control", c.req.path.startsWith(HASHED) ? "public, max-age=31536000, immutable" : "no-cache");
    const type = c.res.headers.get("Content-Type") ?? "";
    if (COMPRESSIBLE_CONTENT_TYPE_REGEX.test(type) && !/accept-encoding/i.test(c.res.headers.get("Vary") ?? "")) c.header("Vary", "Accept-Encoding", { append: true });
  });
  app.use("/*", serveStatic({ root, precompressed: true }));
  app.get(
    "*",
    async (c, next) => {
      if (!namesFile(c.req.path)) return page ? servePage(c) : next();
      c.header("Cache-Control", "no-store");
      return c.text("Not Found", 404);
    },
    serveStatic({ root, precompressed: true, path: "index.html" }),
  );
}

/** Whether the path asks for a file: under /assets/, a file ending in its last part, or not decodable at all. */
function namesFile(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true;
  }
  return decoded.startsWith(HASHED) || /\.[^./\\]+$/.test(decoded);
}
