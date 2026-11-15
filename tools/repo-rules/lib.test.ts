import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { listFiles } from "./lib.ts";

/** A repository of its own under the system's temp folder: nothing here is written into the repo under test. */
const dir = mkdtempSync(join(tmpdir(), "repo-rules-lib-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// a hook that runs the tests sets GIT_DIR and GIT_INDEX_FILE: these git calls must reach the repository of `dir`
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, stdio: "ignore" });
const put = (rel: string, text = "x\n") => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

describe("listFiles", () => {
  it("lists tracked files and untracked files that are not ignored, and nothing else", () => {
    git("init", "-q");
    put(".gitignore", "ignored.txt\nbuild/\n");
    put("tracked.ts");
    put("gone.ts");
    git("add", ".gitignore", "tracked.ts", "gone.ts");
    rmSync(join(dir, "gone.ts"));
    put("new/untracked.ts");
    put("ignored.txt");
    put("build/out.js");
    const saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("GIT_")));
    for (const k of Object.keys(saved)) delete process.env[k];
    try {
      // a new file is listed before it is staged; an ignored file and a tracked file deleted from the folder are not
      expect(listFiles(dir)).toEqual([".gitignore", "new/untracked.ts", "tracked.ts"]);
    } finally {
      Object.assign(process.env, saved);
    }
  });
});
