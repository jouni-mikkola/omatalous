/**
 * The index job's script of the release workflow (tools/ci/candidate-index.sh), run on a stand-in of what buildx prints for
 * `imagetools create --dry-run`: the check of the index of a candidate's two images, the digest of the printed bytes and
 * the record of the candidate. The workflow's own shape is in release-workflow.test.ts.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT } from "../repo-rules/lib.ts";

const SCRIPT = resolve(ROOT, "tools/ci/candidate-index.sh");
const h = (c: string) => `sha256:${c.repeat(64)}`;
const AMD64 = h("a");
const ARM64 = h("b");
const SHA = "c".repeat(40);
const INPUT = { IMAGE: "ghcr.io/example/app", AMD64, ARM64, VERSION: "1.2.3", SHA, RUN_ID: "123456789" };

const entry = (digest: string, os: string, architecture: string) => ({
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  digest,
  size: 1234,
  platform: { architecture, os },
});
/** What buildx prints for two images that carry an attestation manifest each (platform unknown/unknown). */
const index = (manifests = [entry(h("1"), "linux", "amd64"), entry(h("2"), "unknown", "unknown"), entry(h("3"), "linux", "arm64"), entry(h("4"), "unknown", "unknown")]) => ({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests,
});
/** buildx marshals with two spaces and prints one newline after the JSON. */
const printed = (o: object) => JSON.stringify(o, null, 2) + "\n";
const sha256 = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

// the digests of the fixed bytes of `printed(index())` and `JSON.stringify(index())`, without the newline at the end
const PINNED = "sha256:990152790e97c7dd3f35bf1436a7ff2c662fade556029ba8596363bec03d8618";
const PINNED_COMPACT = "sha256:fdf816e844859d9dc9db5221c95b984413551d37b74d1a7221e517a7a29f3e3f";

describe("tools/ci/candidate-index.sh", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  function run(text: string | null, env: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "candidate-index-"));
    dirs.push(dir);
    if (text !== null) writeFileSync(join(dir, "index.json"), text);
    const r = spawnSync("bash", [SCRIPT], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "", HOME: dir, ...INPUT, INDEX_FILE: join(dir, "index.json"), GITHUB_STEP_SUMMARY: join(dir, "summary"), ...env },
      encoding: "utf8",
    });
    const record = join(dir, "candidate.json");
    return {
      code: r.status,
      out: r.stdout,
      err: r.stderr,
      record: existsSync(record) ? (JSON.parse(readFileSync(record, "utf8")) as Record<string, unknown>) : null,
      recordText: existsSync(record) ? readFileSync(record, "utf8") : "",
      summary: existsSync(join(dir, "summary")) ? readFileSync(join(dir, "summary"), "utf8") : "",
    };
  }

  it("writes the record of a good index with the digest of the printed bytes, in the fields and order the local command reads", () => {
    const text = printed(index());
    const r = run(text);
    expect(r.code, r.err).toBe(0);
    expect(r.record).toEqual({ schema: 1, version: "1.2.3", sha: SHA, digest: PINNED, amd64: AMD64, arm64: ARM64, run_id: "123456789" });
    expect(r.record?.digest).toBe(sha256(text.slice(0, -1)));
    expect(Object.keys(r.record ?? {})).toEqual(["schema", "version", "sha", "digest", "amd64", "arm64", "run_id"]);
    expect(r.out).toBe(r.recordText);
    expect(r.summary).toBe(`Candidate 1.2.3 at ${SHA}: index ${PINNED} of ${AMD64} and ${ARM64} (ghcr.io/example/app)\n`);
    expect(r.err).toBe("");
  });

  it("hashes the bytes as printed: the same JSON reformatted is another digest, and the newline at the end does not count", () => {
    const o = index();
    const compact = run(JSON.stringify(o) + "\n");
    expect(compact.code, compact.err).toBe(0);
    expect(compact.record?.digest).toBe(PINNED_COMPACT);
    expect(PINNED_COMPACT).not.toBe(PINNED);
    // the newline at the end is not part of the index, so a file without it gives the same digest
    expect(run(printed(o).slice(0, -1)).record?.digest).toBe(PINNED);
    // four spaces instead of two: other bytes, other digest
    expect(run(JSON.stringify(o, null, 4) + "\n").record?.digest).toBe(sha256(JSON.stringify(o, null, 4)));
  });

  it("makes every field of the record a single word: the command that picks the record up splits it on spaces", () => {
    const r = run(printed(index()));
    for (const f of ["schema", "version", "run_id", "digest", "amd64", "arm64"]) expect(String(r.record?.[f]), f).toMatch(/^\S+$/);
  });

  it("warns, and still writes the record, when an image has no attestation manifest", () => {
    const r = run(printed(index([entry(h("1"), "linux", "amd64"), entry(h("3"), "linux", "arm64"), entry(h("4"), "unknown", "unknown")])));
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("::warning::The index holds 1 attestation manifests, not one for each image.");
    expect(r.record?.amd64).toBe(AMD64);
  });

  const only = (...m: ReturnType<typeof entry>[]) => printed(index(m));
  const refusals: [string, string | null, Record<string, string>, RegExp][] = [
    ["a platform missing", only(entry(h("1"), "linux", "amd64"), entry(h("2"), "unknown", "unknown")), {}, /The index holds "linux\/amd64", not linux\/amd64 and linux\/arm64/],
    ["a third platform", only(entry(h("1"), "linux", "amd64"), entry(h("3"), "linux", "arm64"), entry(h("5"), "linux", "arm")), {}, /The index holds "linux\/amd64 linux\/arm linux\/arm64"/],
    ["a platform twice", only(entry(h("1"), "linux", "amd64"), entry(h("5"), "linux", "amd64"), entry(h("3"), "linux", "arm64")), {}, /The index holds "linux\/amd64 linux\/amd64 linux\/arm64"/],
    ["an index with no manifests", printed({ ...index(), manifests: [] }), {}, /The index holds "", not/],
    ["a single image where an index is expected", printed({ ...index(), mediaType: "application/vnd.oci.image.manifest.v1+json" }), {}, /is not an index/],
    ["an empty input", "", {}, /is not an index/],
    ["an input that is not JSON", "Error: unauthorized\n", {}, /is not an index: Error: unauthorized/],
    ["no file", null, {}, /There is no index at/],
    ["an amd64 digest that is not a digest", printed(index()), { AMD64: "sha256:abc" }, /A build gave no digest: amd64 "sha256:abc"/],
    ["an arm64 digest missing", printed(index()), { ARM64: "" }, /A build gave no digest: amd64 ".*", arm64 ""/],
    ["the same digest for both images", printed(index()), { ARM64: AMD64 }, /Both builds gave the same digest/],
    ["a version that is not X.Y.Z", printed(index()), { VERSION: "1.2" }, /The version is "1\.2"/],
    ["a commit that is not 40 hex digits", printed(index()), { SHA: "abc" }, /The commit is "abc"/],
    ["a run number that is not a number", printed(index()), { RUN_ID: "" }, /The run number is ""/],
  ];
  for (const [what, text, env, say] of refusals) {
    it(`refuses ${what}, in one line, and writes no record`, () => {
      const r = run(text, env);
      expect(r.code).toBe(1);
      expect(r.err.trim().split("\n")).toHaveLength(1);
      expect(r.err).toMatch(say);
      expect(r.record).toBeNull();
      expect(r.summary).toBe("");
    });
  }

  it("refuses a multi-line input in one line", () => {
    const r = run("<html>\n<body>\nbad gateway\n</body>\n</html>\n");
    expect(r.code).toBe(1);
    expect(r.err.trim().split("\n")).toHaveLength(1);
    expect(r.err).toContain("<html> <body> bad gateway");
  });
});
