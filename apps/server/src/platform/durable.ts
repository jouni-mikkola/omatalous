/**
 * Writes that survive a power loss. A file that was written and renamed is only safe once the file itself
 * and the folder that holds its name have been flushed. Node only.
 */
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";

/** Flushes a file that was written by other means (copyFileSync). */
export function fsyncFile(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Flushes a folder, so a created, renamed or removed name is on disk. Skipped where a folder cannot be opened (Windows). */
export function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch (err) {
    if (process.platform !== "win32") throw err;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Creates a new file (never overwrites: flag wx), writes it, flushes it and its folder. */
export function writeNewFileDurable(path: string, data: string, mode: number, dir: string): void {
  const fd = openSync(path, "wx", mode);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  fsyncDir(dir);
}
