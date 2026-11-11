/**
 * Writes that survive a power loss. A file that was written and renamed is only safe once the file itself
 * and the folder that holds its name have been flushed. Node only.
 */
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, statSync, writeSync } from "node:fs";

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

/**
 * Sets what is at `path` to `mode`. One that cannot be set (not the owner's, a file system without modes) is no
 * reason to stop a start or a copy: it is said in one log line that names it. One that is not there is not said.
 */
function setMode(path: string, mode: number): void {
  try {
    if ((statSync(path).mode & 0o777) === mode) return;
    chmodSync(path, mode);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "error";
    if (code === "ENOENT") return;
    const want = mode.toString(8);
    console.error(`database files: ${path} could not be set to mode ${want} (${code}), so other users of this machine may be able to read it. Set it by hand: chmod ${want} ${path}`);
  }
}

/** Sets a file that holds the household's data to mode 600: only its owner reads and writes it. Never throws. */
export function ownerOnlyFile(path: string): void {
  setMode(path, 0o600);
}

/** Makes a folder for such files and sets it to mode 700, also when it was there already (mkdir leaves that one's mode as it is). */
export function ownerOnlyDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  setMode(dir, 0o700);
}
