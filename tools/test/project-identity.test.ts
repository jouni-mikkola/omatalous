/**
 * The project's identity (project.json: owner, repository, image, signer, return page) is written once. Files that
 * cannot read it hold a copy: the workflows (a job guard cannot read a file), the Dockerfile label, the installer that
 * runs before any clone exists, and the documents. This test holds every copy to project.json byte for byte, and
 * lists the only files that may name the owner's account.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ROOT, readText } from "../repo-rules/lib.ts";

const project = JSON.parse(readText("project.json")) as Record<string, string>;
const { owner = "", repo = "", image = "", signerWorkflow = "", pagesUrl = "", returnUrl = "" } = project;

/** The pattern an image must be signed under, built here from the parts and not read from any file. */
const dots = (s: string) => s.replaceAll(".", "\\.");
const SIGN = `^https://github\\.com/${dots(owner)}/${dots(repo)}/${dots(signerWorkflow)}@refs/(tags/v[0-9]+\\.[0-9]+\\.[0-9]+|heads/main)$`;

const files = () =>
  execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter((f) => f !== "" && !f.endsWith("pnpm-lock.yaml"));

/** Files that may name the owner's account, with the reason. Everything else reads project.json. */
const ALLOWED: Record<string, string> = {
  "project.json": "the one place",
  "CHANGELOG.md": "history",
  LICENSE: "the attribution term names the source address",
  "README.md": "the install command and the source links of the public front page",
  "docs/ADVANCED.md": "documents the return page and the private channel",
  "docs/INSTALL.md": "the install command",
  "docs/RELEASING.md": "the release procedure names the repositories",
  "docs/SECURITY.md": "documents the signature check",
  Dockerfile: "the image source label (checked below)",
  "docker-compose.yml": "a comment",
  "relay/install.sh": "runs before any clone exists (checked below)",
  "scripts/lib/release.sh": "what an install verifies with; a copy, checked below",
  "apps/server/test/instance.test.ts": "pins the default return address of existing installs",
  "apps/web/test/about.test.ts": "pins the footer links",
  "tools/lib/outside-hosts.test.ts": "pins the return page host in the list of outside hosts",
};
const ALLOWED_PREFIXES = [".github/workflows/", "tools/test/"];
/** The owner's private tooling (the audit and the publisher) names the account for the commit address. The public tree has none of it, and the pattern avoids its paths because the public scan reads this file. */
const PRIVATE_TOOLING = /^tools\/(pr|pu)[a-z-]+/;

describe("project.json", () => {
  it("holds https addresses and no private path", () => {
    for (const u of [pagesUrl, returnUrl, project.authorUrl ?? "", project.supportUrl ?? ""]) expect(u).toMatch(/^https:\/\/[a-z0-9.-]+\//);
    expect(returnUrl).toBe(`${pagesUrl}callback/`);
    expect(image).toBe(`ghcr.io/${owner}/${repo}`);
    expect(readText("project.json")).not.toMatch(/\/home\/|banking-app|\.claude/);
  });

  it("is one key and value per line, which the release tools read in plain bash", () => {
    for (const line of readText("project.json").trimEnd().split("\n").slice(1, -1)) expect(line).toMatch(/^ {2}"[A-Za-z]+": "[^"\\]*",?$/);
  });
});

describe("the signature check", () => {
  it("scripts/lib/release.sh builds the same pattern byte for byte", () => {
    const out = execFileSync("bash", ["-c", '. scripts/lib/release.sh; printf %s "$SIGN_IDENTITY_REGEXP|$REGISTRY_IMAGE|$RELEASES_API|$PROJECT_OWNER/$PROJECT_REPO"'], { cwd: ROOT, encoding: "utf8" });
    expect(out).toBe(`${SIGN}|${image}|https://api.github.com/repos/${owner}/${repo}/releases|${owner}/${repo}`);
  });

  it("the release tools read the same owner, repository and image from project.json", () => {
    const out = execFileSync("bash", ["-c", '. tools/lib/project.sh; printf %s "$PROJECT_OWNER/$PROJECT_REPO|$PROJECT_IMAGE"'], { cwd: ROOT, encoding: "utf8" });
    expect(out).toBe(`${owner}/${repo}|${image}`);
  });

  it("release.yml pins the same pattern and image", () => {
    const text = readText(".github/workflows/release.yml");
    expect(text).toContain(`\n  SIGN_IDENTITY_REGEXP: ${SIGN}\n`);
    expect(text).toContain(`\n  IMAGE: ${image}\n`);
  });
});

describe("the copies", () => {
  it("every workflow guards on the project's repository", () => {
    for (const f of files().filter((f) => f.startsWith(".github/workflows/"))) {
      const guards = readText(f).match(/github\.repository == '[^']*'/g) ?? [];
      for (const g of guards) expect(g, f).toBe(`github.repository == '${owner}/${repo}'`);
    }
  });

  it("the Dockerfile label and the installer name the same repository", () => {
    expect(readText("Dockerfile")).toContain(`org.opencontainers.image.source="https://github.com/${owner}/${repo}"`);
    const installer = readText("relay/install.sh");
    expect(installer).toContain(`\n  API_URL=https://api.github.com/repos/${owner}/${repo}/releases/latest\n`);
    expect(installer).toContain(`\n  REPO_URL=https://github.com/${owner}/${repo}.git\n`);
  });

  it("the documents download the installer from the Pages address", () => {
    for (const f of ["README.md", "docs/INSTALL.md"]) expect(readText(f), f).toContain(`curl -fsSLo omatalous-install.sh ${pagesUrl}install.sh`);
  });
});

describe("the owner's account name", () => {
  it("is found only in the allowed files, and every allowed file still has it", () => {
    const re = new RegExp(owner, "i");
    const found = files().filter((f) => re.test(readText(f)));
    const allowed = (f: string) => f in ALLOWED || PRIVATE_TOOLING.test(f) || ALLOWED_PREFIXES.some((p) => f.startsWith(p));
    expect(found.filter((f) => !allowed(f))).toEqual([]);
    expect(Object.keys(ALLOWED).filter((f) => !found.includes(f))).toEqual([]);
  });
});
