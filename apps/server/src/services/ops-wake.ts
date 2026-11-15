/**
 * `<data>/ops/wake`, an empty file. The app touches it after it has queued a request and `ops poll` removes it, so the
 * helper, which waits for it inside its minute (wake_wait in scripts/ops-helper.sh), starts the request within seconds.
 * Null path when this process was not told the data folder.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Services } from "./context.ts";

type Where = Pick<Services, "backupDir">;

function wakePath(s: Where): string | null {
  return s.backupDir ? join(dirname(s.backupDir), "ops", "wake") : null;
}

/** Called after the insert of a request has committed. A failure is swallowed: the request is queued all the same. */
export function touchWake(s: Where): void {
  const file = wakePath(s);
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, "", { mode: 0o600 });
  } catch {
    // the helper still looks once a minute
  }
}

/** Called by `ops poll` before it reads the queue, so a request queued after that leaves the file there. */
export function clearWake(s: Where): void {
  const file = wakePath(s);
  if (!file) return;
  try {
    rmSync(file, { force: true });
  } catch {
    // an empty wake at worst
  }
}
