import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

/** A folder and the test file that made it ("" when no file is running). */
interface Made {
  dir: string;
  file: string;
}

// One list per worker, on globalThis and not in this module: a second copy of the module (a setup file and a test can
// each load one when workers share modules) must remove what the first made.
const KEY = Symbol.for("omatalous.tmp-kit.made");
const store = globalThis as { [KEY]?: Made[] };
if (!store[KEY]) {
  store[KEY] = [];
  // the last file of a worker has no next file to remove its folders: they go when the worker ends (once, by the first copy)
  process.once("exit", removeMade);
}
const made: Made[] = store[KEY];

function current(): string {
  return expect.getState().testPath ?? "";
}

/** Removes the folders made so far. tools/lib/test-setup.ts runs it after every test file: a hook of this module would register for the first file a worker runs only, as workers share modules (vitest.config.ts).
 * It also runs when the worker ends, and tempDir() removes what a finished file left (removeOthers). */
export function removeMade(): void {
  for (const { dir } of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Removes the folders of the test files other than `file`. The files of a worker run one after the other, so those files are done. */
export function removeOthers(file: string): void {
  if (!file) return;
  for (let i = made.length - 1; i >= 0; i--) {
    const m = made[i]!;
    if (!m.file || m.file === file) continue;
    made.splice(i, 1);
    rmSync(m.dir, { recursive: true, force: true });
  }
}

/** A new empty folder under `base` (default tmpdir()), removed when the importing test file is done (also from inside a test body). A file whose suites are all skipped
 * never runs its afterAll: make the folder inside a test, a beforeAll or a suite that runs. Should the hook of test-setup.ts not run for a file, its folders go when the next
 * file of the worker makes one, or when the worker ends. */
export function tempDir(prefix: string, base: string = tmpdir()): string {
  const file = current();
  removeOthers(file);
  const dir = mkdtempSync(join(base, prefix));
  made.push({ dir, file });
  return dir;
}
