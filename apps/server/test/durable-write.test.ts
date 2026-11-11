/** writeNewFileDurable writes every byte, removes what it made when it fails, and never touches an older file. */
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateAppSecret } from "../src/entry/app-secret.ts";
import { writeNewFileDurable } from "../src/platform/durable.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "durable-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const tenAtATime = (fd: number, buf: Uint8Array, offset: number, length: number) =>
  writeSync(fd, buf, offset, Math.min(10, length));
const boom = () => {
  throw new Error("disk full");
};

describe("writeNewFileDurable", () => {
  it("writes every byte when the write takes 10 at a time", () => {
    const p = join(dir, "f");
    const text = "x".repeat(2001);
    writeNewFileDurable(p, text, 0o600, dir, { write: tenAtATime });
    expect(readFileSync(p, "utf8")).toBe(text);
  });

  it("removes its file when a write throws, and a second call works", () => {
    const p = join(dir, "f");
    expect(() => writeNewFileDurable(p, "abc", 0o600, dir, { write: boom })).toThrow("disk full");
    expect(existsSync(p)).toBe(false);
    writeNewFileDurable(p, "abc", 0o600, dir);
    expect(readFileSync(p, "utf8")).toBe("abc");
  });

  it("removes its file when the flush throws, and a second call works", () => {
    const p = join(dir, "f");
    expect(() => writeNewFileDurable(p, "abc", 0o600, dir, { fsync: boom })).toThrow("disk full");
    expect(existsSync(p)).toBe(false);
    writeNewFileDurable(p, "abc", 0o600, dir);
    expect(readFileSync(p, "utf8")).toBe("abc");
  });

  it("leaves a file that was there before untouched", () => {
    const p = join(dir, "f");
    writeFileSync(p, "old");
    expect(() => writeNewFileDurable(p, "new", 0o600, dir, { write: boom })).toThrow();
    expect(readFileSync(p, "utf8")).toBe("old");
  });
});

describe("loadOrCreateAppSecret", () => {
  it("returns the problem, leaves no file, and the next call creates 64 characters", () => {
    const p = join(dir, "app_secret");
    const r = loadOrCreateAppSecret(p, { write: boom });
    expect(r.secret).toBeNull();
    expect(existsSync(p)).toBe(false);
    const again = loadOrCreateAppSecret(p);
    expect(again.secret).toHaveLength(64);
    expect(readFileSync(p, "utf8").trim()).toBe(again.secret);
  });

  it("never replaces an existing file", () => {
    const p = join(dir, "app_secret");
    const old = "s".repeat(40);
    writeFileSync(p, `${old}\n`);
    const r = loadOrCreateAppSecret(p, { write: boom });
    expect(r).toEqual({ secret: old, created: false });
    expect(readFileSync(p, "utf8")).toBe(`${old}\n`);
  });
});
