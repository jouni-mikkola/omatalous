/**
 * Pre-compressed copies of the built app, so the server sends bytes it does not have to compress per request
 * (`precompress` in vite.config.ts). Node only: the web app never imports this. The server finds `<file>.br` and
 * `<file>.gz` beside each file (`staticFiles` in apps/server/src/static-files.ts).
 */
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

/** Text formats only: woff2 and the pictures are compressed already, and the picture reader's `.gz` data stays as it is. */
export const COMPRESSED_TYPES: ReadonlySet<string> = new Set([".js", ".css", ".html", ".svg", ".json", ".txt", ".webmanifest", ".wasm"]);

/** A file under this many bytes costs more in headers than it saves. */
export const COMPRESS_MIN_BYTES = 1024;

/** The pair of encodings and their file suffixes, the order the server prefers them in. */
export const ENCODINGS = [
  { name: "br", suffix: ".br", pack: (b: Buffer) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }) },
  { name: "gzip", suffix: ".gz", pack: (b: Buffer) => gzipSync(b, { level: constants.Z_BEST_COMPRESSION }) },
] as const;

/** Writes `.br` and `.gz` beside every compressible file of `dir` where the copy is smaller. Returns the paths it wrote. */
export function compressFolder(dir: string): string[] {
  const written: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (COMPRESSED_TYPES.has(extname(entry.name)) && statSync(path).size >= COMPRESS_MIN_BYTES) {
        const body = readFileSync(path);
        for (const { suffix, pack } of ENCODINGS) {
          const packed = pack(body);
          if (packed.length >= body.length) continue;
          writeFileSync(path + suffix, packed);
          written.push(path + suffix);
        }
      }
    }
  };
  walk(dir);
  return written;
}
