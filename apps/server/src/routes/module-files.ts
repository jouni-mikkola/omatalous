/**
 * The web files of the loaded add-on module at `/modules/<id>/<version>/<file>` (docs/MODULES.md, "Loading in the
 * browser"): only to a signed-in user, only the names a bundle may hold, only from the folder the start extracted.
 * Anything else answers as an unknown address does.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";

const FILE = /^(web\.mjs|web\.css|assets\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\.(mjs|css|svg|png|woff2))$/;
const TYPES: Record<string, string> = {
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  woff2: "font/woff2",
};

export const moduleBase = (id: string, version: string) => `/modules/${id}/${version}/`;

export function moduleFileRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  app.get("/:id/:version/*", async (c) => {
    const start = s.modules?.start;
    const notFound = () => c.text("Not Found", 404, { "Cache-Control": "no-store" });
    if (!c.get("user") || start?.state !== "connected") return notFound();
    if (c.req.param("id") !== start.id || c.req.param("version") !== start.version) return notFound();
    const rest = c.req.path.slice(moduleBase(start.id, start.version).length);
    if (!FILE.test(rest)) return notFound();
    let data: Buffer;
    try {
      data = await readFile(join(start.filesDir, rest));
    } catch {
      return notFound();
    }
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": TYPES[rest.slice(rest.lastIndexOf(".") + 1)]!,
      // a version's folder never changes; a new version is a new address
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  });
  return app;
}
