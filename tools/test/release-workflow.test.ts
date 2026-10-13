/**
 * The shape of the release workflow (.github/workflows/release.yml), read from its YAML.
 *
 * The line it holds: no step that makes a tag on the image, a signature, a GitHub release or anything else a user's
 * install can see runs in a job that does not need the commit check, both builds and both smoke tests. The types, the
 * build and the tests are not here: the local gate runs them on the public tree before the push (the last tests below).
 * Besides it: the permissions of each job, the pins of the actions, and the rows of what a run checks, signs and
 * publishes (a cut that drops a row fails here).
 *
 * The candidate half (a push to a branch candidate/X.Y.Z-<short>) is below: no job of it holds a right to sign, write or
 * release, and the run on main is the one it was (the plan script has its own test, release-plan.test.ts).
 *
 * `violations` reads the workflow text, so each test below also feeds it a text with one fault put in and expects the
 * fault to be named: a guard that nothing can trip would pass for ever.
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, readText } from "../repo-rules/lib.ts";

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
  environment?: string;
  permissions?: Record<string, string> | string;
  outputs?: Record<string, string>;
  strategy?: { matrix?: { shard?: string[]; include?: { arch?: string }[] } };
  steps: Step[];
}
interface Workflow {
  on?: { push?: { branches?: string[]; tags?: string[] } };
  permissions?: unknown;
  concurrency?: { group?: string; "cancel-in-progress"?: string };
  jobs: Record<string, Job>;
}

/** Jobs that must have passed before anything public is made: the commit check, both builds, both smoke tests. */
const GATES = ["verify", "build", "smoke"];
/** The jobs that are neither a gate nor a publisher. The dry run builds and smoke tests, and makes nothing; the index only prints. */
const OTHERS = ["plan", "dry-run", "index"];
const RANK: Record<string, number> = { none: 0, read: 1, write: 2 };
/** The widest each job may be. The build pushes images by digest and nothing else, so it holds packages: write. */
const LIMITS: Record<string, Record<string, string>> = {
  build: { contents: "read", packages: "write" },
  smoke: { contents: "read", packages: "read" },
  index: { contents: "read", packages: "read" },
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

/** What a step makes that a user's install can find. An image pushed by digest with no tag is not among it, nor is an index that `--dry-run` only prints. */
function madePublic(step: Step): string[] {
  const out: string[] = [];
  const run = (step.run ?? "").replace(/^\s*#.*$/gm, ""); // a comment line names a command and runs nothing
  const uses = step.uses ?? "";
  if (/imagetools\s+create(?![^\n]*--dry-run)|--tag\b|docker\s+(tag|push)\b/.test(run)) out.push("a tag on an image");
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
  ["the version, the tag and the agreement of the tree (the plan script)", /tools\/ci\/release-plan\.sh/, ["plan"]],
  ["the commit is on main", /merge-base --is-ancestor HEAD origin\/main/, ["verify"]],
  ["the compose layout number", /x-talous-compat missing/, ["build", "dry-run"]],
  ["each image pushed by digest", /push-by-digest=true/, ["build"]],
  ["the smoke test of each pushed image", /smoke-image\.sh "\$IMAGE@\$DIGEST"/, ["smoke"]],
  ["the smoke test of the rehearsal", /smoke-image\.sh omatalous:dry-run/, ["dry-run"]],
  ["the index under the version tag", /imagetools create --tag/, ["publish"]],
  ["the platforms of the index", /linux\/amd64 linux\/arm64/, ["publish"]],
  ["the index of a candidate, printed and not pushed", /imagetools create --dry-run/, ["index"]],
  ["the check and the record of a candidate (its script)", /tools\/ci\/candidate-index\.sh/, ["index"]],
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

  // no row disappears
  for (const [what, pattern, where] of ROWS) {
    const found = ids.filter((id) => jobs[id]?.steps.some((s) => pattern.test(textOf(s)))).sort();
    if (found.join() !== [...where].sort().join()) out.push(`${what}: made in ${found.join(", ") || "no job"}, expected ${where.join(", ")}`);
  }
  return out;
}

// ── the tests ────────────────────────────────────────────────────────────────────────────────────────────────────
const WORKFLOW = readText(".github/workflows/release.yml");
const PUBLISH_NEEDS = "needs: [plan, verify, build, smoke]";

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
    expect([...closure(w.jobs, "release")].sort()).toEqual(["build", "plan", "publish", "smoke", "verify"]);
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
    const extra = (run: string) => change("verify", `"The commit is not on main"; exit 1; }\n`, `"The commit is not on main"; exit 1; }\n      - run: ${run}\n`);
    expect(violations(extra('cosign sign --yes "$IMAGE@$D"')).join("\n")).toMatch(/verify makes a signature/);
    expect(violations(extra('gh release create "$TAG"')).join("\n")).toMatch(/verify makes a release or a git tag/);
    expect(violations(extra('docker buildx imagetools create --tag "$IMAGE:$V" a b')).join("\n")).toMatch(/verify makes a tag on an image/);
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
    expect(violations(change("verify", "timeout-minutes: 15", "timeout-minutes: 15\n    continue-on-error: true")).join("\n")).toMatch(/continue-on-error/);
  });

  it("gives no job a wider permission than it has today, and every job names its own", () => {
    expect(violations(change("verify", "contents: read", "contents: write")).join("\n")).toMatch(/verify holds contents: write/);
    expect(violations(change("dry-run", "contents: read", "contents: read\n      id-token: write")).join("\n")).toMatch(/dry-run holds id-token: write/);
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

  it("starts the commit check, the rehearsal and the build as soon as plan is done, and the smoke tests as soon as the build is", () => {
    const w = parseYaml(WORKFLOW) as unknown as Workflow;
    for (const id of ["verify", "build", "dry-run"]) expect(needsOf(w.jobs[id] as Job), id).toEqual(["plan"]);
    expect(needsOf(w.jobs.smoke as Job).sort()).toEqual(["build", "plan"]);
    // the commit check also runs when only a rehearsal is asked for
    expect((w.jobs.verify as Job).if).toMatch(/release == 'true' \|\| .*dry_run == 'true'/);
  });

  it("leaves the types, the build and the tests to the local gate: no job for them, and publish needs exactly plan, verify, build and smoke", () => {
    const w = parseYaml(WORKFLOW) as unknown as Workflow;
    expect(Object.keys(w.jobs).sort()).toEqual(["build", "dry-run", "index", "plan", "publish", "release", "smoke", "verify"]);
    expect(needsOf(w.jobs.publish as Job).sort()).toEqual(["build", "plan", "smoke", "verify"]);
    expect(JSON.stringify(w)).not.toMatch(/pnpm (typecheck|test|install)|check-migrations|--shard/);
  });

  it("keeps every row of what a run checks, signs and publishes", () => {
    expect(violations(change("publish", "run: cosign sign --yes", "run: echo")).join("\n")).toMatch(/the signature by digest: made in no job/);
    expect(violations(change("verify", "merge-base --is-ancestor HEAD origin/main", "merge-base --is-ancestor HEAD HEAD")).join("\n")).toMatch(/the commit is on main: made in no job/);
    // a row that moves to another job is named too
    expect(violations(change("smoke", "      - uses: docker/login-action", "      - run: gh release create \"$TAG\"\n      - uses: docker/login-action")).join("\n")).toMatch(/smoke makes a release or a git tag/);
  });
});

// ── the candidate half ───────────────────────────────────────────────────────────────────────────────────────────
// A push to a branch candidate/X.Y.Z-<short> builds and smoke tests both images and signs, tags and releases nothing.
const MAIN_OR_TAG = "github.ref == 'refs/heads/main'";
/** What each job holds on a candidate branch, by name: its permissions, or "never" when the job cannot start there. */
const ON_CANDIDATE: Record<string, Record<string, string> | "never"> = {
  plan: { contents: "read" },
  build: { contents: "read", packages: "write" },
  smoke: { contents: "read", packages: "read" },
  index: { contents: "read", packages: "read" },
  verify: "never",
  "dry-run": "never",
  publish: "never",
  release: "never",
};

/** Everything that gives a job on a candidate branch a right to sign, write or release, in words. Empty when none does. */
function candidateViolations(text: string): string[] {
  const jobs = (parseYaml(text) as unknown as Workflow).jobs;
  const out: string[] = [];
  for (const id of Object.keys(jobs)) {
    const job = jobs[id] as Job;
    const proof = ON_CANDIDATE[id];
    const perms = typeof job.permissions === "object" ? job.permissions : {};
    if (proof === undefined) {
      out.push(`${id} is a job with no proof of what it holds on a candidate branch: say it in ON_CANDIDATE`);
    } else if (proof === "never") {
      // only plan's outputs start such a job, and a candidate run leaves release and dry_run false (the plan tests below)
      const cond = job.if ?? "";
      if (/candidate/.test(cond)) out.push(`${id} must not start on a candidate branch, and its condition names candidate: "${cond}"`);
      if (!/outputs\.(release|dry_run) == 'true'/.test(cond)) out.push(`${id} does not wait for release or dry_run to be true: "${cond}"`);
      if (id === "publish" || id === "release") {
        if (!cond.includes(MAIN_OR_TAG) || !cond.includes("startsWith(github.ref, 'refs/tags/v')")) out.push(`${id} runs on no ref of main or a version tag only: "${cond}"`);
      }
    } else {
      if (JSON.stringify(Object.entries(perms).sort()) !== JSON.stringify(Object.entries(proof).sort())) out.push(`${id} holds ${JSON.stringify(perms)} on a candidate branch, not ${JSON.stringify(proof)}`);
      if (job.environment !== undefined) out.push(`${id} runs in the environment ${job.environment}`);
      if (id !== "plan" && !(job.if ?? "").includes("outputs.candidate == 'true'") && !(job.if ?? "").includes("outputs.release == 'true'")) out.push(`${id} does not wait for plan: "${job.if}"`);
    }
    // whatever a job is called, these three never reach a job that can start on a candidate branch
    if (proof !== "never") {
      if (perms["id-token"] !== undefined) out.push(`${id} holds id-token on a candidate branch`);
      if (perms.contents === "write") out.push(`${id} holds contents: write on a candidate branch`);
    }
  }
  for (const id of Object.keys(ON_CANDIDATE)) if (!jobs[id]) out.push(`ON_CANDIDATE names ${id}, which is no job`);
  return out;
}

/** The job's block of the workflow text, from its name line to the next job. */
const jobText = (id: string) => {
  const start = WORKFLOW.indexOf(`\n  ${id}:\n`);
  const end = WORKFLOW.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  return WORKFLOW.slice(start, end < 0 ? undefined : start + 1 + end);
};

describe("release workflow on a candidate branch", () => {
  const w = parseYaml(WORKFLOW) as unknown as Workflow;

  it("runs on a push to candidate/**, in the block form the local guard reads", () => {
    expect(w.on?.push?.branches).toEqual(["main", "candidate/**"]);
    expect(w.on?.push?.tags).toEqual(["v*"]);
    expect(WORKFLOW).toMatch(/^on:\n {2}push:\n {4}branches:\n {6}- main\n {6}- "candidate\/\*\*"\n/m);
  });

  it("gives no job on a candidate branch id-token: write, contents: write or the release environment, and names every job", () => {
    expect(candidateViolations(WORKFLOW)).toEqual([]);
    expect(Object.keys(ON_CANDIDATE).sort()).toEqual(Object.keys(w.jobs).sort());
    // the rights are held by two jobs, and both cannot start on a candidate branch
    const holders = Object.keys(w.jobs).filter((id) => {
      const j = w.jobs[id] as Job;
      const p = typeof j.permissions === "object" ? j.permissions : {};
      return p["id-token"] !== undefined || p.contents === "write" || j.environment !== undefined;
    });
    expect(holders.sort()).toEqual(["publish", "release"]);
    expect((w.jobs.publish as Job).environment).toBe("release");
  });

  it("names the job that gets a right on a candidate branch, whichever job it is", () => {
    const seen = (text: string) => candidateViolations(text).join("\n");
    expect(seen(change("index", "packages: read", "packages: read\n      id-token: write"))).toMatch(/index holds .*on a candidate branch, not|index holds id-token/);
    expect(seen(change("build", "packages: write", "packages: write\n      id-token: write"))).toMatch(/build holds id-token on a candidate branch/);
    expect(seen(change("smoke", "contents: read", "contents: write"))).toMatch(/smoke holds contents: write on a candidate branch/);
    expect(seen(change("plan", "contents: read", "contents: read\n      packages: write"))).toMatch(/plan holds .* not /);
    expect(seen(change("smoke", "    timeout-minutes: 10\n", "    timeout-minutes: 10\n    environment: release\n"))).toMatch(/smoke runs in the environment release/);
    // publish and release stay behind the ref of main or a version tag, and plan's release output
    expect(seen(change("publish", " && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))", ""))).toMatch(/publish runs on no ref/);
    expect(seen(change("release", " && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))", ""))).toMatch(/release runs on no ref/);
    expect(seen(change("publish", "needs.plan.outputs.release == 'true'", "needs.plan.outputs.candidate == 'true'"))).toMatch(/publish must not start on a candidate branch/);
    expect(seen(change("verify", "needs.plan.outputs.release == 'true' ||", "needs.plan.outputs.candidate == 'true' ||"))).toMatch(/verify must not start on a candidate branch/);
    // a new job has no proof until the table says what it holds
    expect(seen(`${WORKFLOW}\n  extra:\n    needs: plan\n    permissions:\n      id-token: write\n    steps:\n      - run: echo\n`)).toMatch(/extra is a job with no proof/);
    // near miss: a narrower permission set is still a different one, the table says it exactly
    expect(seen(change("index", "packages: read", "packages: none"))).toMatch(/index holds/);
  });

  it("builds and smoke tests on a candidate as on main, and makes the index of the digests only after both smoke tests", () => {
    const cond = /\(needs\.plan\.outputs\.release == 'true' \|\| needs\.plan\.outputs\.candidate == 'true'\)/;
    expect((w.jobs.build as Job).if).toMatch(cond);
    expect((w.jobs.smoke as Job).if).toMatch(cond);
    expect(needsOf(w.jobs.index as Job).sort()).toEqual(["build", "plan", "smoke"]);
    expect((w.jobs.index as Job).if).toMatch(/outputs\.candidate == 'true'$/);
    // the verify job asks whether the commit is on main, which a candidate's commit is not yet
    expect((w.jobs.verify as Job).if).not.toMatch(/candidate/);
    // no gate of the workflow is made optional by a status function
    expect(WORKFLOW).not.toMatch(/\b(always|cancelled|failure)\s*\(/);
  });

  it("hands plan's outputs on as the step wrote them: only the step's own release and dry_run start publish, release and the rehearsal", () => {
    for (const k of ["release", "dry_run", "version", "tag", "new_tag", "candidate"]) expect((w.jobs.plan as Job).outputs?.[k], k).toBe("${{ steps.v.outputs." + k + " }}");
  });

  it("makes the index with --dry-run, pushes it nowhere and writes candidate.json for three days", () => {
    const index = w.jobs.index as Job;
    const run = index.steps.map((s) => s.run ?? "").join("\n");
    expect(run).toMatch(/imagetools create --dry-run "\$IMAGE@\$AMD64" "\$IMAGE@\$ARM64"/);
    expect(run).not.toMatch(/--tag|docker push|imagetools create(?![^\n]*--dry-run)/);
    expect(index.steps.flatMap(madePublic)).toEqual([]);
    // the check of the index, its digest and the record are in the script, which candidate-index.test.ts runs
    expect(run).toMatch(/^tools\/ci\/candidate-index\.sh$/m);
    const upload = index.steps.find((s) => s.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.with).toMatchObject({ name: "candidate", path: "candidate.json", "retention-days": "3", "if-no-files-found": "error" });
  });

  it("keeps one candidate run, and a newer one ends the build of the older; a release is never cut short", () => {
    expect(w.concurrency?.group).toMatch(/startsWith\(github\.ref, 'refs\/heads\/candidate\/'\) && 'candidate' \|\| 'release'/);
    expect(w.concurrency?.["cancel-in-progress"]).toBe("${{ startsWith(github.ref, 'refs/heads/candidate/') && github.event_name == 'push' }}");
    expect(WORKFLOW).not.toMatch(/cancel-in-progress: true/);
  });

  it("keeps the run on main to the same jobs, needs, permissions and environment as before the candidate half", () => {
    // as the workflow stood before the candidate half: job, needs, permissions, environment
    const before: Record<string, [string[], Record<string, string>, string | undefined]> = {
      plan: [[], { contents: "read" }, undefined],
      verify: [["plan"], { contents: "read" }, undefined],
      build: [["plan"], { contents: "read", packages: "write" }, undefined],
      "dry-run": [["plan"], { contents: "read" }, undefined],
      smoke: [["build", "plan"], { contents: "read", packages: "read" }, undefined],
      publish: [["build", "plan", "smoke", "verify"], { contents: "read", packages: "write", "id-token": "write" }, "release"],
      release: [["plan", "publish"], { contents: "write" }, undefined],
    };
    expect(Object.keys(w.jobs).filter((id) => !(id in before))).toEqual(["index"]);
    for (const [id, [needs, perms, env]] of Object.entries(before)) {
      const job = w.jobs[id] as Job;
      expect(needsOf(job).sort(), `${id} needs`).toEqual(needs);
      expect(job.permissions, `${id} permissions`).toEqual(perms);
      expect(job.environment, `${id} environment`).toBe(env);
    }
    // the conditions that start the jobs on main
    expect((w.jobs.verify as Job).if).toMatch(/release == 'true' \|\| .*dry_run == 'true'/);
    expect((w.jobs["dry-run"] as Job).if).toMatch(/dry_run == 'true'$/);
    expect((w.jobs.publish as Job).if).toMatch(/outputs\.release == 'true' && \(github\.ref == 'refs\/heads\/main' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)\)$/);
    // plan runs the script, which holds what the step held
    expect((w.jobs.plan as Job).steps.find((s) => s.name === "Version and tag")?.run).toBe("tools/ci/release-plan.sh");
  });

  it("has the smoke test read the three labels of the image on each processor", () => {
    const smoke = readText("tools/ci/smoke-image.sh");
    for (const label of ["talous.version", "talous.commit", "talous.compose"]) expect(smoke, label).toContain(`"${label}"`);
    expect(smoke).toMatch(/\[\[ \$platform == "\$host" \]\]/);
    expect(textOf((w.jobs.smoke as Job).steps.at(-1) as Step)).toContain("smoke-image.sh");
  });
});

// ── the public tree leg of the local gate ────────────────────────────────────────────────────────────────────────
// The checks of the types, the build and the tests run once, before the push, on the tree that this repository holds
// (the private one less its excluded paths and blocks). The script of the gate is in the private tree only: a tree
// without it has nothing to read here, and these tests are skipped.
// found by its full name, not by a pattern: `pnpm check --changed` runs a test only when the test names the script it reads
const GATE = readdirSync(resolve(ROOT, "tools/release")).find((f) => f === "release-gate.sh");
// the chain: the install and the build, one after the other; then the type check and the tests side by side (pt_side)
const LEG_COMMANDS = ["pnpm install --frozen-lockfile --offline", "pnpm build"];
const SIDE_COMMANDS = ["typecheck", "test"];

/** Everything wrong with the public tree leg of the gate script, in words. Empty when it holds. */
function gateViolations(text: string): string[] {
  const out: string[] = [];
  const leg = /^public_tree\(\) \(\n([\s\S]*?)\n\)$/m.exec(text)?.[1];
  if (leg === undefined) return ["the gate has no public_tree leg"];
  const cmds = leg.replace(/\\\n/g, " ").split(/\s*&&\s*/).map((c) => c.trim());
  const all = cmds.filter((c) => c.startsWith("pt_run ")).map((c) => c.slice("pt_run ".length));
  if (all.filter((c) => /^git init\b/.test(c)).length !== 1 || !all.some((c) => /^git add -A$/.test(c)) || !all.some((c) => /^git .*\bcommit\b/.test(c))) out.push("the folder is not made a git repository with one commit");
  const run = all.filter((c) => !c.startsWith("git "));
  if (!/^"\$ROOT\/tools\/[\w-]+\.sh" --export "\$1"$/.test(run[0] ?? "")) out.push("the leg does not start with the export of HEAD into its folder");
  if (cmds[1] !== 'cd "$1"') out.push("the commands do not run in the exported folder");
  if (run.slice(1).join("|") !== LEG_COMMANDS.join("|")) out.push(`the leg runs "${run.slice(1).join('", "')}", not "${LEG_COMMANDS.join('", "')}"`);
  if (cmds[cmds.length - 1] !== "pt_side") out.push("the leg does not end in the type check and the tests side by side (pt_side)");
  const side = /^pt_side\(\) \{[^\n]*\n([\s\S]*?)\n\}$/m.exec(text)?.[1];
  if (side === undefined) out.push("the gate has no pt_side");
  else {
    const lists = [...side.matchAll(/for cmd in ([a-z ]+); do/g)].map((m) => m[1]);
    if (lists.length < 2 || lists.some((l) => l !== SIDE_COMMANDS.join(" "))) out.push(`the side by side part loops over "${lists.join('", "')}", not "${SIDE_COMMANDS.join(" ")}"`);
    if (!side.includes('pt_run pnpm "$cmd" >"$d.$cmd" &')) out.push("the side by side part does not run each command in the background with a log of its own");
  }
  if (!/GATE_LABEL="public tree" bg gate_run public-tree public_tree "\$GATE_PT_DIR"/.test(text)) out.push("the leg is not started beside check and e2e as the public tree");
  if (!/GATE_PT_DIR=\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/[\w.-]+\.XXXXXX"\)/.test(text)) out.push("the folder is not made under the temp folder");
  if (!/trap 'rm -rf "\$GATE_PT_DIR"' EXIT/.test(text) || !/trap 'exit 130' INT/.test(text) || !/trap 'exit 143' TERM/.test(text)) out.push("the folder is not removed when the gate ends or is signalled");
  return out;
}

describe("release gate, public tree leg", () => {
  const gate = GATE === undefined ? "" : readText(`tools/release/${GATE}`);
  /** The gate text with the line of one command taken out. */
  const without = (cmd: string) => gate.replace(new RegExp(`^\\s*&& pt_run ${cmd}( \\\\)?\\n`, "m"), "");

  it.skipIf(GATE === undefined)("installs offline and builds the exported tree, then typechecks and tests it side by side, in a folder under the temp folder", () => {
    expect(gateViolations(gate)).toEqual([]);
  });

  it.skipIf(GATE === undefined)("names the leg that lost a command, ran them in another order, or left its folder behind", () => {
    for (const cmd of LEG_COMMANDS) expect(gateViolations(without(cmd)).join("\n"), cmd).toMatch(/the leg runs/);
    expect(gateViolations(gate.replace(" --offline", "")).join("\n")).toMatch(/the leg runs "pnpm install --frozen-lockfile", /);
    expect(gateViolations(gate.replace("pt_run pnpm build", "pt_run pnpm @").replace("pt_run pnpm install --frozen-lockfile --offline", "pt_run pnpm build").replace("pt_run pnpm @", "pt_run pnpm install --frozen-lockfile --offline")).join("\n")).toMatch(/the leg runs/);
    // the side by side part: a name dropped from either list, the background left out, the chain not ending in it
    const loop = `for cmd in ${SIDE_COMMANDS.join(" ")}; do`;
    const nth = (n: number) => gate.split(loop).reduce((acc, part, i) => (i === 0 ? part : acc + (i === n ? "for cmd in typecheck; do" : loop) + part), "");
    expect(gateViolations(nth(1)).join("\n")).toMatch(/side by side part loops over/);
    expect(gateViolations(nth(2)).join("\n")).toMatch(/side by side part loops over/);
    expect(gateViolations(gate.replace('>"$d.$cmd" &', '>"$d.$cmd"')).join("\n")).toMatch(/in the background with a log of its own/);
    expect(gateViolations(gate.replace("    && pt_side", "")).join("\n")).toMatch(/does not end in the type check and the tests side by side/);
    expect(gateViolations(gate.replace('--export "$1" && cd "$1"', '--export "$1"')).join("\n")).toMatch(/do not run in the exported folder/);
    expect(gateViolations(without("git init -q")).join("\n")).toMatch(/not made a git repository with one commit/);
    expect(gateViolations(gate.replace('"${TMPDIR:-/tmp}/gate-public', '"$ROOT/gate-public')).join("\n")).toMatch(/not made under the temp folder/);
    expect(gateViolations(gate.replace(`trap 'rm -rf "$GATE_PT_DIR"' EXIT`, "")).join("\n")).toMatch(/not removed when the gate ends or is signalled/);
    expect(gateViolations(gate.replace("GATE_LABEL=\"public tree\" bg ", "")).join("\n")).toMatch(/not started beside check and e2e/);
  });
});
