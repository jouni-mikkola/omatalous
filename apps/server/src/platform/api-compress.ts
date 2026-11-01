/**
 * Compression of the API's answers (app.ts). hono's `compress` skips an answer that already has a
 * `Content-Encoding` (a static file that went out pre-compressed, or one a proxy in front already packed) and
 * the compressible content types only, but it measures the threshold from `Content-Length`, which `c.json` does not set.
 * `measured` sets it first, for the text types it would compress.
 */
import type { MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import { COMPRESSIBLE_CONTENT_TYPE_REGEX } from "hono/utils/compress";

/** Under this many bytes the packing costs more than it saves. */
const COMPRESS_THRESHOLD_BYTES = 1024;

/** Gives an answer with a compressible type and no length the length of its body, so the threshold can be applied. */
const measured: MiddlewareHandler = async (c, next) => {
  await next();
  const res = c.res;
  const type = res.headers.get("Content-Type") ?? "";
  if (!res.body || res.headers.has("Content-Length") || res.headers.has("Content-Encoding") || !COMPRESSIBLE_CONTENT_TYPE_REGEX.test(type)) return;
  const body = await res.arrayBuffer();
  const packed = new Response(body, res);
  packed.headers.set("Content-Length", String(body.byteLength));
  c.res = packed;
};

/** The two layers in the order they run: the outer one packs what the inner one measured. */
export const apiCompression: MiddlewareHandler[] = [compress({ threshold: COMPRESS_THRESHOLD_BYTES }), measured];
