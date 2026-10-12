/**
 * The shape of the release workflow (.github/workflows/release.yml), read from its YAML.
 *
 * The line it holds: no step that makes a tag on the image, a signature, a GitHub release or anything else a user's
 * install can see runs in a job that does not need every check, both builds and both smoke tests. The checks, the
 * build and the smoke tests run side by side to save time, so this line is what keeps the speed from costing safety.
 * Besides it: the permissions of each job, the pins of the actions, the shards of the tests, and the rows of what a
 * run checks, signs and publishes (a cut that drops a row fails here).
 *
 * `violations` reads the workflow text, so each test below also feeds it a text with one fault put in and expects the
 * fault to be named: a guard that nothing can trip would pass for ever.
 */
import { describe, expect, it } from "vitest";
import { readText } from "../repo-rules/lib.ts";

// ── the YAML this repository writes workflows in ──────────────────────────────────────────────────────────────────
// Block mappings and lists, `[a, b]` and `{}`, quoted and plain scalars, `|` blocks and `#` comments, every scalar a
// string. Anything else (an anchor, a flow mapping with keys, a scalar on two lines, a repeated key) throws, so a file
// this cannot read fails the test instead of passing it.

type Y = string | Y[] | { [key: string]: Y };

const KEY = /^([^\s#"'][^:]*?|"[^"]*"|'[^']*')\s*:(?:\s+(.*))?$/;

/** The line without its comment: a `#` after a space, outside quotes. */
function stripComment(s: string): string {
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? "";
    if (quote) {
      if (c === quote) quote = "";
    } else if ((c === '"' || c === "'") && (i === 0 || /[\s[,]/.test(s[i - 1] ?? ""))) quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1] ?? ""))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

function parseYaml(src: string): Y {
  const lines = src.split("\n");
  let at = 0;
  const indent = (l: string) => l.length - l.trimStart().length;
  const skip = () => {
    while (at < lines.length && /^\s*(#.*)?$/.test(lines[at] ?? "")) at++;
  };
  const fail = (why: string): never => {
    throw new Error(`YAML line ${at + 1}: ${why}: ${lines[at] ?? "(end of file)"}`);
  };
  const scalar = (s: string): string => {
    const q = /^(["'])(.*)\1$/.exec(s);
    if (q) return q[1] === "'" ? (q[2] ?? "").replace(/''/g, "'") : (q[2] ?? "");
    if (/^["'&*!]/.test(s)) return fail("a scalar this reader cannot take");
    return s;
  };
  const flowList = (s: string): Y[] => {
    if (!s.endsWith("]")) fail("a flow list on more than one line");
    const inner = s.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((item) => scalar(item.trim()));
  };
  const block = (ind: number, head: string): string => {
    const body: string[] = [];
    let width = -1;
    while (at < lines.length) {
      const l = lines[at] ?? "";
      if (l.trim() === "") body.push("");
      else {
        const n = indent(l);
        if (n <= ind) break;
        if (width < 0) width = n;
        if (n < width) fail("a block line indented less than the first");
        body.push(l.slice(width));
      }
      at++;
    }
    while (body.length > 0 && body[body.length - 1] === "") body.pop();
    return body.join(head.startsWith(">") ? " " : "\n") + (head.endsWith("-") ? "" : "\n");
  };
  function parseMap(ind: number): { [key: string]: Y } {
    const out: { [key: string]: Y } = {};
    for (;;) {
      skip();
      const line = lines[at];
      if (line === undefined || indent(line) !== ind || /^-(\s|$)/.test(line.trim())) break;
      const m = KEY.exec(stripComment(line.trim()));
      if (!m) return fail("not a key");
      const key = scalar(m[1] ?? "");
      const rest = m[2] ?? "";
      if (key in out) fail("a repeated key");
      at++;
      if (rest === "") {
        skip();
        const next = lines[at];
        const nested = next !== undefined && (indent(next) > ind || (indent(next) === ind && /^-(\s|$)/.test(next.trim())));
        out[key] = nested ? parseBlock() : "";
      } else if (/^[|>][+-]?$/.test(rest)) out[key] = block(ind, rest);
      else if (rest.startsWith("[")) out[key] = flowList(rest);
      else if (rest === "{}") out[key] = {};
      else {
        if (rest.startsWith("{")) fail("a flow mapping");
        out[key] = scalar(rest);
        skip();
        if (at < lines.length && indent(lines[at] ?? "") > ind) fail("a scalar on more than one line");
      }
    }
    return out;
  }
  function parseSeq(ind: number): Y[] {
    const out: Y[] = [];
    for (;;) {
      skip();
      const line = lines[at];
      if (line === undefined || indent(line) !== ind || !/^-(\s|$)/.test(line.trim())) break;
      const rest = line.trim().slice(1).trimStart();
      if (rest === "") {
        at++;
        out.push(parseBlock());
      } else {
        // the item starts on the dash line: read it as a block that starts at its own column
        lines[at] = " ".repeat(ind + line.trim().length - rest.length) + rest;
        out.push(parseBlock());
      }
    }
    return out;
  }
  function parseBlock(): Y {
    skip();
    const line = lines[at];
    if (line === undefined) return "";
    const body = stripComment(line.trim());
    if (/^-(\s|$)/.test(body)) return parseSeq(indent(line));
    if (KEY.test(body)) return parseMap(indent(line));
    at++;
    return body.startsWith("[") ? flowList(body) : scalar(body);
  }
  const root = parseBlock();
  skip();
  if (at < lines.length) fail("a line this reader did not understand");
  return root;
}

// ── what the workflow looks like to the rules ────────────────────────────────────────────────────────────────────
interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
}
interface Job {
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string> | string;
  strategy?: { matrix?: { shard?: string[]; include?: { arch?: string }[] } };
  steps: Step[];
}
interface Workflow {
  permissions?: unknown;
  jobs: Record<string, Job>;
}

/** Jobs that must have passed before anything public is made: every check, both builds, both smoke tests. */
const GATES = ["verify", "typecheck", "test", "build", "smoke"];
/** The jobs that are neither a gate nor a publisher. The dry run builds and smoke tests, and makes nothing. */
const OTHERS = ["plan", "dry-run"];
const RANK: Record<string, number> = { none: 0, read: 1, write: 2 };
/** The widest each job may be. The build pushes images by digest and nothing else, so it holds packages: write. */
const LIMITS: Record<string, Record<string, string>> = {
  build: { contents: "read", packages: "write" },
  smoke: { contents: "read", packages: "read" },
  publish: { contents: "read", packages: "write", "id-token": "write" },
  release: { contents: "write" },
};
const DEFAULT_LIMIT = { contents: "read" };

const needsOf = (job: Job): string[] => [job.needs ?? []].flat();

/** Every job that must have ended green before this one starts: its needs, theirs, and so on. */
function closure(jobs: Record<string, Job>, id: string, seen = new Set<string>()): Set<string> {
  for (const n of needsOf(jobs[id] ?? { steps: [] })) {
    if (!seen.has(n)) {
      seen.add(n);
      closure(jobs, n, seen);
    }
  }
  return seen;
}

/** What a step makes that a user's install can find. An image pushed by digest with no tag is not among it. */
function madePublic(step: Step): string[] {
  const out: string[] = [];
  const run = (step.run ?? "").replace(/^\s*#.*$/gm, ""); // a comment line names a command and runs nothing
  const uses = step.uses ?? "";
  if (/imagetools\s+create|--tag\b|docker\s+(tag|push)\b/.test(run)) out.push("a tag on an image");
  if (/cosign\s+(sign|attest)\b/.test(run)) out.push("a signature");
  if (/gh\s+release\b|gh\s+api\b[^\n]*(-X|--method)\s*(POST|PUT|PATCH|DELETE)|\bgit\s+push\b|\bgit\s+tag\b(?!\s+(-l|--list)\b)/.test(run)) out.push("a release or a git tag");
  if (/release-action|action-gh-release|create-release|upload-release-asset/.test(uses)) out.push("a release");
  if (uses.startsWith("docker/build-push-action@")) {
    const w = step.with ?? {};
    const outputs = w.outputs ?? "";
    const pushes = w.push === "true" || /(^|,)push=true(,|$)/.test(outputs);
    const byDigestOnly = /(^|,)push-by-digest=true(,|$)/.test(outputs) && !w.tags;
    if (pushes && !byDigestOnly) out.push("a tag on an image");
  }
  return out;
}

/** The text a step is matched on in ROWS. */
const textOf = (s: Step) => [s.run ?? "", s.uses ?? "", ...Object.values(s.with ?? {})].join("\n");

/** Every check, signature and publication of a run, and the jobs that make it. A row never disappears. */
const ROWS: [string, RegExp, string[]][] = [
  ["the version, the tag and the agreement of the tree", /CHANGELOG top heading is/, ["plan"]],
  ["the commit is on main", /merge-base --is-ancestor HEAD origin\/main/, ["verify"]],
  ["migrations are only added", /check-migrations\.sh/, ["verify"]],
  ["types", /^pnpm typecheck$/m, ["typecheck"]],
  ["the build of the web app and the server", /^pnpm build$/m, ["typecheck"]],
  ["tests", /^pnpm test --shard /m, ["test"]],
  ["the compose layout number", /x-talous-compat missing/, ["build", "dry-run"]],
  ["each image pushed by digest", /push-by-digest=true/, ["build"]],
  ["the smoke test of each pushed image", /smoke-image\.sh "\$IMAGE@\$DIGEST"/, ["smoke"]],
  ["the smoke test of the rehearsal", /smoke-image\.sh omatalous:dry-run/, ["dry-run"]],
  ["the index under the version tag", /imagetools create --tag/, ["publish"]],
  ["the platforms of the index", /linux\/amd64 linux\/arm64/, ["publish"]],
  ["the signature by digest", /cosign sign --yes/, ["publish"]],
  ["the signature that the check installs run accept", /verify_signature/, ["publish"]],
  ["the labels of the image", /talous\.compose says/, ["publish"]],
  ["the GitHub release", /gh release create/, ["release"]],
];

/** Everything wrong with a release workflow, in words. Empty when it holds the line and the rest. */
function violations(text: string): string[] {
  const w = parseYaml(text) as unknown as Workflow;
  const out: string[] = [];
  const jobs = w.jobs;
  const ids = Object.keys(jobs);

  if (JSON.stringify(w.permissions) !== "{}") out.push("the workflow must start with permissions: {}, so every job names its own");
  if (/continue-on-error/.test(text)) out.push("continue-on-error lets a red job count as green");
  for (const g of GATES) if (!jobs[g]) out.push(`no job ${g}`);
  for (const id of ids) {
    const job = jobs[id] as Job;
    for (const n of needsOf(job)) if (!jobs[n]) out.push(`${id} needs ${n}, which is no job`);
    // a job reads the outputs of the jobs it names in needs, and of no other
    for (const n of new Set([...JSON.stringify(job).matchAll(/needs\.([\w-]+)\./g)].map((m) => m[1] ?? ""))) {
      if (!needsOf(job).includes(n)) out.push(`${id} reads needs.${n} and does not name ${n} in needs`);
    }

    // the line
    const made = [...new Set(job.steps.flatMap(madePublic))];
    const perms = typeof job.permissions === "object" ? job.permissions : {};
    const writes = perms.contents === "write" || perms["id-token"] === "write";
    if (made.length > 0 || writes) {
      const missing = GATES.filter((g) => g !== id && !closure(jobs, id).has(g));
      if (missing.length > 0) out.push(`${id} makes ${made.join(" and ") || "a write"} and does not need ${missing.join(", ")}`);
      for (const s of [{ if: job.if }, ...job.steps]) {
        if (/\b(always|cancelled|failure)\s*\(/.test(s.if ?? "")) out.push(`${id} runs after a red job: "${s.if}"`);
      }
    } else if (!GATES.includes(id) && !OTHERS.includes(id)) out.push(`${id} is no gate and makes nothing public: say which in GATES or OTHERS`);

    // the permissions
    if (typeof job.permissions !== "object") out.push(`${id} gives no permissions, so it takes the default`);
    const limit = LIMITS[id] ?? DEFAULT_LIMIT;
    for (const [scope, level] of Object.entries(perms)) {
      if ((RANK[level] ?? 9) > (RANK[(limit as Record<string, string>)[scope] ?? "none"] ?? 0)) out.push(`${id} holds ${scope}: ${level}, wider than ${JSON.stringify(limit)}`);
    }

    // the pins
    for (const s of job.steps) {
      if (s.uses && !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(s.uses)) out.push(`${id} uses ${s.uses}, which is not pinned to a commit`);
    }

    // both processors
    if (["build", "smoke", "dry-run"].includes(id)) {
      const arch = (job.strategy?.matrix?.include ?? []).map((i) => i.arch).sort();
      if (arch.join() !== "amd64,arm64") out.push(`${id} runs on ${arch.join() || "no"} processor, not amd64 and arm64`);
    }
  }

  // the shards of the tests: 1 to N, and each runs `pnpm test` cut into N
  const shards = jobs.test?.strategy?.matrix?.shard ?? [];
  const n = shards.length;
  if (n < 2 || shards.join() !== Array.from({ length: n }, (_, i) => i + 1).join()) out.push(`the test shards are [${shards.join(", ")}], not 1 to N with N of 2 or more`);
  const cmds = (jobs.test?.steps ?? []).map((s) => s.run).filter((r): r is string => /^pnpm test\b/.test(r ?? ""));
  if (cmds.join("|") !== `pnpm test --shard \${{ matrix.shard }}/${n}`) out.push(`the test job runs "${cmds.join('", "')}", not pnpm test --shard \${{ matrix.shard }}/${n}`);
  if (/passWithNoTests/.test(text)) out.push("a shard that runs no test must fail, so passWithNoTests stays out");

  // no row disappears
  for (const [what, pattern, where] of ROWS) {
    const found = ids.filter((id) => jobs[id]?.steps.some((s) => pattern.test(textOf(s)))).sort();
    if (found.join() !== [...where].sort().join()) out.push(`${what}: made in ${found.join(", ") || "no job"}, expected ${where.join(", ")}`);
  }
  return out;
}

// ── the tests ────────────────────────────────────────────────────────────────────────────────────────────────────
const WORKFLOW = readText(".github/workflows/release.yml");
const PUBLISH_NEEDS = "needs: [plan, verify, typecheck, test, build, smoke]";

/** The text with `from` replaced by `to`, inside the block of one job. Throws when the workflow has no such text. */
function change(id: string, from: string | RegExp, to: string): string {
  const start = WORKFLOW.indexOf(`\n  ${id}:\n`);
  const end = WORKFLOW.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  const block = WORKFLOW.slice(start, end < 0 ? undefined : start + 1 + end);
  const next = block.replace(from, () => to);
  if (start < 0 || next === block) throw new Error(`the test cannot find ${from} in ${id}`);
  return WORKFLOW.replace(block, () => next);
}

describe("release workflow", () => {
  it("holds the line: nothing public is made in a job that does not need every check, both builds and both smoke tests", () => {
    expect(violations(WORKFLOW)).toEqual([]);
    const w = parseYaml(WORKFLOW) as unknown as Workflow;
    // the jobs that make something public are these two, and the second needs the first
    const publishers = Object.keys(w.jobs).filter((id) => (w.jobs[id] as Job).steps.some((s) => madePublic(s).length > 0));
    expect(publishers.sort()).toEqual(["publish", "release"]);
    expect([...closure(w.jobs, "release")].sort()).toEqual(["build", "plan", "publish", "smoke", "test", "typecheck", "verify"]);
  });

  it("names the job that lacks a gate, whichever gate it is", () => {
    for (const gate of GATES) {
      const found = violations(change("publish", PUBLISH_NEEDS, PUBLISH_NEEDS.replace(`, ${gate}`, ""))).join("\n");
      // the smoke tests need the build, so publish stays behind it; but publish reads the digests the build wrote
      const expected = gate === "build" ? /publish reads needs.build and does not name build in needs/ : new RegExp(`publish makes .* does not need ${gate}`);
      expect(found, `without ${gate}`).toMatch(expected);
    }
    expect(violations(change("release", "needs: [plan, publish]", "needs: [plan]")).join("\n")).toMatch(/release makes a release or a git tag and does not need/);
    // a job reads the outputs of the jobs it names in needs, and of no other
    expect(violations(change("release", "needs: [plan, publish]", "needs: [publish]")).join("\n")).toMatch(/release reads needs.plan and does not name plan in needs/);
  });

  it("keeps the build to pushing by digest, and calls a tag or a signature made anywhere else public", () => {
    const tagged = change("build", "push-by-digest=true,name-canonical=true,push=true", "name-canonical=true,push=true");
    expect(violations(tagged).join("\n")).toMatch(/build makes a tag on an image and does not need verify/);
    const extra = (run: string) => change("test", "      - run: pnpm install --frozen-lockfile\n", `      - run: pnpm install --frozen-lockfile\n      - run: ${run}\n`);
    expect(violations(extra('cosign sign --yes "$IMAGE@$D"')).join("\n")).toMatch(/test makes a signature/);
    expect(violations(extra('gh release create "$TAG"')).join("\n")).toMatch(/test makes a release or a git tag/);
    expect(violations(extra('docker buildx imagetools create --tag "$IMAGE:$V" a b')).join("\n")).toMatch(/test makes a tag on an image/);
    // near misses: a read of the API and a read of the tags make nothing
    expect(violations(extra('gh api "repos/$GH_REPO/releases/tags/$TAG"'))).toEqual([]);
    expect(violations(extra("git tag --list 'v*'"))).toEqual([]);
  });

  it("refuses a publisher that runs after a red job", () => {
    const ifOf = "if: github.repository == 'jouni-mikkola/omatalous' && needs.plan.outputs.release == 'true'";
    for (const status of ["always()", "${{ !cancelled() }}", "failure()"]) {
      expect(violations(change("publish", ifOf, `if: ${status} && needs.plan.outputs.release == 'true'`)).join("\n"), status).toMatch(/publish runs after a red job/);
    }
    expect(violations(change("publish", ifOf, `if: success() && needs.plan.outputs.release == 'true'`))).toEqual([]);
    expect(violations(change("test", "timeout-minutes: 15", "timeout-minutes: 15\n    continue-on-error: true")).join("\n")).toMatch(/continue-on-error/);
  });

  it("gives no job a wider permission than it has today, and every job names its own", () => {
    expect(violations(change("typecheck", "contents: read", "contents: write")).join("\n")).toMatch(/typecheck holds contents: write/);
    expect(violations(change("test", "contents: read", "contents: read\n      id-token: write")).join("\n")).toMatch(/test holds id-token: write/);
    expect(violations(change("build", "packages: write", "packages: write\n      id-token: write")).join("\n")).toMatch(/build holds id-token: write/);
    expect(violations(change("publish", "contents: read", "contents: write")).join("\n")).toMatch(/publish holds contents: write/);
    expect(violations(change("release", "contents: write", "contents: write\n      packages: write")).join("\n")).toMatch(/release holds packages: write/);
    expect(violations(change("smoke", "packages: read", "packages: write")).join("\n")).toMatch(/smoke holds packages: write/);
    expect(violations(change("verify", "    permissions:\n      contents: read\n", "")).join("\n")).toMatch(/verify gives no permissions/);
    expect(violations(WORKFLOW.replace("permissions: {}", "permissions: write-all")).join("\n")).toMatch(/permissions: \{\}/);
    // near miss: a narrower one is fine
    expect(violations(change("smoke", "packages: read", "packages: none"))).toEqual([]);
  });

  it("pins every action to a commit", () => {
    expect(violations(WORKFLOW.replace(/actions\/checkout@[0-9a-f]{40}/, "actions/checkout@v7")).join("\n")).toMatch(/uses actions\/checkout@v7, which is not pinned/);
    expect(violations(WORKFLOW.replace(/docker\/login-action@[0-9a-f]{40}/, "docker/login-action@main")).join("\n")).toMatch(/docker\/login-action@main/);
  });

  it("starts the checks, the rehearsal and the build as soon as plan is done, and the smoke tests as soon as the build is", () => {
    const w = parseYaml(WORKFLOW) as unknown as Workflow;
    for (const id of ["verify", "typecheck", "test", "build", "dry-run"]) expect(needsOf(w.jobs[id] as Job), id).toEqual(["plan"]);
    expect(needsOf(w.jobs.smoke as Job).sort()).toEqual(["build", "plan"]);
    // the checks also run when only a rehearsal is asked for
    for (const id of ["verify", "typecheck", "test"]) expect((w.jobs[id] as Job).if, id).toMatch(/release == 'true' \|\| .*dry_run == 'true'/);
  });

  it("runs the tests in shards 1 to N whose command cuts pnpm test into N, and a shard with no test fails", () => {
    const w = parseYaml(WORKFLOW) as unknown as Workflow;
    expect(w.jobs.test?.strategy?.matrix?.shard).toEqual(["1", "2", "3"]);
    expect(w.jobs.test?.steps.map((s) => s.run)).toContain("pnpm test --shard ${{ matrix.shard }}/3");
    // two shards under a command that cuts into three leave a third of the tests out
    expect(violations(change("test", "shard: [1, 2, 3]", "shard: [1, 2]")).join("\n")).toMatch(/the test job runs .*\/3", not .*\/2/);
    expect(violations(change("test", "shard: [1, 2, 3]", "shard: [1, 3]")).join("\n")).toMatch(/test shards are \[1, 3\]/);
    expect(violations(change("test", "/3", "/2")).join("\n")).toMatch(/the test job runs "pnpm test --shard \$\{\{ matrix.shard \}\}\/2", not .*\/3/);
    // vitest ends with an error when a shard has no file to run, unless asked to pass: nothing asks
    const asked = change("test", "/3", "/3 --passWithNoTests");
    expect(violations(asked).join("\n")).toMatch(/passWithNoTests/);
    for (const file of ["vitest.config.ts", "package.json"]) expect(readText(file), file).not.toMatch(/passWithNoTests/);
  });

  it("keeps every row of what a run checks, signs and publishes", () => {
    expect(violations(change("publish", "run: cosign sign --yes", "run: echo")).join("\n")).toMatch(/the signature by digest: made in no job/);
    expect(violations(change("typecheck", "      - run: pnpm typecheck\n", "")).join("\n")).toMatch(/types: made in no job/);
    expect(violations(change("verify", "tools/ci/check-migrations.sh", "tools/ci/other.sh")).join("\n")).toMatch(/migrations are only added: made in no job/);
    // a row that moves to another job is named too
    expect(violations(change("typecheck", "      - run: pnpm build", "      - run: pnpm build\n      - run: pnpm test --shard 1/3")).join("\n")).toMatch(/tests: made in test, typecheck, expected test/);
  });
});
