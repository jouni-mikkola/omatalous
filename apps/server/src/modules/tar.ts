/**
 * Reads the tar of an add-on module bundle into memory, refusing every entry that is not a plain file or a folder with a
 * plain relative name (docs/MODULES.md). Nothing is written to disk here: the caller writes only what passed, so a
 * refused bundle leaves nothing behind.
 */
import { gunzipSync } from "node:zlib";

export class BundleRefused extends Error {
  override name = "BundleRefused";
}

export const LIMITS = { entries: 200, fileBytes: 10 * 1024 * 1024, totalBytes: 50 * 1024 * 1024, packedBytes: 25 * 1024 * 1024 };

const BLOCK = 512;
const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

function text(buf: Buffer, from: number, length: number): string {
  const raw = buf.subarray(from, from + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}

function octal(buf: Buffer, from: number, length: number): number {
  const s = text(buf, from, length).trim();
  if (!/^[0-7]{1,12}$/.test(s)) throw new BundleRefused("tar header has a bad number");
  return parseInt(s, 8);
}

function checksumOk(header: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
  return sum === octal(header, 148, 8);
}

/** A path made only of plain segments: no leading slash, no `.` or `..`, no backslash, no empty part. */
function plainPath(name: string): boolean {
  const parts = name.split("/");
  return parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..");
}

export interface TarContents {
  /** Plain files by relative path. */
  files: Map<string, Buffer>;
  /** Folders named by their own entries, without the trailing slash. */
  dirs: Set<string>;
}

/** The entries of a gzipped ustar archive, or BundleRefused at the first entry that breaks a rule. */
export function readTarGz(packed: Buffer): TarContents {
  if (packed.length > LIMITS.packedBytes) throw new BundleRefused("bundle is too large");
  let tar: Buffer;
  try {
    tar = gunzipSync(packed, { maxOutputLength: LIMITS.totalBytes + LIMITS.entries * 2 * BLOCK + 2 * BLOCK });
  } catch {
    throw new BundleRefused("bundle is not a gzip file or is too large");
  }
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  let total = 0;
  let at = 0;
  for (;;) {
    if (at + BLOCK > tar.length) throw new BundleRefused("tar ends early");
    const header = tar.subarray(at, at + BLOCK);
    if (header.every((b) => b === 0)) break;
    if (!checksumOk(header)) throw new BundleRefused("tar header checksum is wrong");
    if (text(header, 257, 6) !== "ustar" || header[262] !== 0 || text(header, 263, 2) !== "00") throw new BundleRefused("tar is not ustar");
    if (files.size + dirs.size >= LIMITS.entries) throw new BundleRefused("tar has too many entries");
    const prefix = text(header, 345, 155);
    const name = prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100);
    const type = String.fromCharCode(header[156]!);
    const size = octal(header, 124, 12);
    at += BLOCK;
    if (type === "5") {
      const dir = name.endsWith("/") ? name.slice(0, -1) : name;
      if (!plainPath(dir)) throw new BundleRefused("tar has a folder with a name that is not plain");
      if (size !== 0) throw new BundleRefused("tar has a folder with content");
      if (dirs.has(dir) || files.has(dir)) throw new BundleRefused("tar names an entry twice");
      dirs.add(dir);
      continue;
    }
    if (type !== "0" && type !== "\0") throw new BundleRefused("tar has an entry that is not a plain file or a folder");
    if (!plainPath(name)) throw new BundleRefused("tar has a file with a name that is not plain");
    if (files.has(name) || dirs.has(name)) throw new BundleRefused("tar names an entry twice");
    if (size > LIMITS.fileBytes) throw new BundleRefused("tar has a file that is too large");
    total += size;
    if (total > LIMITS.totalBytes) throw new BundleRefused("tar is too large");
    if (at + size > tar.length) throw new BundleRefused("tar ends early");
    files.set(name, Buffer.from(tar.subarray(at, at + size)));
    at += Math.ceil(size / BLOCK) * BLOCK;
  }
  return { files, dirs };
}
