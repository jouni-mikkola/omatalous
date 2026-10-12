/**
 * The disk the data folder is on: how much of it is free, and the reserve file.
 *
 * <data>/.reserve is 64 MB of zeros that the server gives up when the disk is nearly full. A full disk refuses every
 * write, also the session row of a sign-in and the request that would free space. The released 64 MB are what an
 * admin signs in and acts with.
 */
import { closeSync, fsyncSync, openSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { freeBytes, MB, sizeOf, type Statfs } from "../db/backup-keep.ts";
import { fsyncDir } from "../platform/durable.ts";
import type { Services } from "./context.ts";

export const RESERVE_FILE = ".reserve";
export const RESERVE_BYTES = 64 * MB;
/** The reserve is written only with more than this free, so it is never what fills the disk. */
export const RESERVE_WRITE_ABOVE = 1024 * MB;
/** With less than this free the reserve is deleted. */
const RESERVE_RELEASE_BELOW = 128 * MB;

export interface DiskState {
  /** Bytes a write to the data folder can still use. Null when this process has no data folder or it cannot be measured. */
  freeBytes: number | null;
  /**
   * held: the file is there in full. released: it is gone and 1 GB or less is free, so it is not written back.
   * missing: it is gone though there is room (the next hourly tick writes it). none: no data folder.
   */
  reserve: "held" | "released" | "missing" | "none";
}

type Where = Pick<Services, "backupDir">;
/** The data folder holds the database and backups/; Services names only the latter. Null when this process was not told where it is. */
export const dataDirOf = (s: Where): string | null => (s.backupDir ? dirname(s.backupDir) : null);

/** Free space and the reserve as they are now. Reads only. */
export function diskState(s: Where, statfs?: Statfs): DiskState {
  const dir = dataDirOf(s);
  if (!dir) return { freeBytes: null, reserve: "none" };
  let free: number | null = null;
  try {
    free = freeBytes(dir, statfs);
  } catch {
    // a disk that cannot be measured is not reported as full
  }
  if (sizeOf(join(dir, RESERVE_FILE)) >= RESERVE_BYTES) return { freeBytes: free, reserve: "held" };
  return { freeBytes: free, reserve: free !== null && free <= RESERVE_WRITE_ABOVE ? "released" : "missing" };
}

/** Zeros that are really written: a sparse file would reserve nothing. Flushed with its folder, so the blocks are taken. */
function writeReserve(file: string, dir: string): void {
  const chunk = Buffer.alloc(MB);
  const fd = openSync(file, "w", 0o600);
  try {
    for (let written = 0; written < RESERVE_BYTES; written += chunk.length) writeSync(fd, chunk);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  fsyncDir(dir);
}

/**
 * The data folders whose reserve this process keeps. Only the server entry names one (startReserve): a CLI run
 * beside the server and a test with a data folder must not write 64 MB each.
 */
const kept = new Set<string>();

/** At server start: from now on this process keeps the reserve of its data folder, and it is written if it can be. */
export function startReserve(s: Where, statfs?: Statfs): DiskState {
  const dir = dataDirOf(s);
  if (dir) kept.add(dir);
  return keepReserve(s, statfs);
}

/**
 * At start and at every hourly tick: deletes the reserve when under 128 MB is free, writes it when it is missing
 * and over 1 GB is free, and returns the state after that. Between the two limits nothing changes, so the file is
 * not written and deleted in turns. Never throws: the reserve helps a full disk, it is no condition for running.
 */
export function keepReserve(s: Where, statfs?: Statfs): DiskState {
  const dir = dataDirOf(s);
  const before = diskState(s, statfs);
  if (!dir || !kept.has(dir) || before.freeBytes === null) return before;
  const file = join(dir, RESERVE_FILE);
  try {
    if (before.freeBytes < RESERVE_RELEASE_BELOW) {
      // a file cut short by a crash is given up too
      if (sizeOf(file) > 0) {
        rmSync(file, { force: true });
        fsyncDir(dir);
        console.error(`the data disk is nearly full (${Math.floor(before.freeBytes / MB)} MB free): the reserve ${file} was deleted to leave room for signing in and freeing space. Free space on the data volume.`);
      }
    } else if (before.reserve === "missing") {
      writeReserve(file, dir);
    }
  } catch (err) {
    console.error(`the reserve ${file} could not be kept:`, (err as Error).message);
    try {
      // half a reserve only takes space
      if (sizeOf(file) < RESERVE_BYTES) rmSync(file, { force: true });
    } catch {
      // the next tick tries again
    }
  }
  return diskState(s, statfs);
}
