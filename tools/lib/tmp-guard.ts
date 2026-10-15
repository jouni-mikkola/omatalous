/**
 * Vitest global setup: a run gets a private temporary folder (TMPDIR for itself and everything it starts), and the
 * run fails when a test left anything in it. A test makes its folders through tempDir() in tmp-kit.ts, which removes
 * them; a test that forgets is named here by the entry it left. The leftovers are removed so the machine stays clean.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup(): () => void {
  const outer = process.env.TMPDIR;
  const own = mkdtempSync(join(tmpdir(), "vitest-run-"));
  process.env.TMPDIR = own;
  return () => {
    if (outer === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = outer;
    const left = readdirSync(own);
    rmSync(own, { recursive: true, force: true });
    if (!left.length) return;
    process.exitCode = 1;
    throw new Error(`the tests left ${left.length} temporary entries behind (removed now): ${left.slice(0, 8).join(", ")}. Make folders with tempDir() from tools/lib/tmp-kit.ts, or remove them in afterAll.`);
  };
}
