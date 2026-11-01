import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made: string[] = [];

/** Removes the folders made so far. tools/lib/test-setup.ts runs it after every test file: a hook of this module would register for the first file a worker runs only, as workers share modules (vitest.config.ts). */
export function removeMade(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A new empty folder under `base` (default tmpdir()), removed when the importing test file is done (also from inside a test body). A file whose suites are all skipped
 * never runs its afterAll: make the folder inside a test, a beforeAll or a suite that runs. */
export function tempDir(prefix: string, base: string = tmpdir()): string {
  const dir = mkdtempSync(join(base, prefix));
  made.push(dir);
  return dir;
}
