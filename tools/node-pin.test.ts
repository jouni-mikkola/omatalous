import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The node that runs the scripts, the checks, CI and the image is one version. .npmrc names it for pnpm (use-node-version);
// the files below name it again because they cannot read .npmrc: setup-node of the CI jobs and the base of the image.
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const pinned = /^use-node-version=(\d+\.\d+\.\d+)$/m.exec(read(".npmrc"))?.[1] ?? "";

describe("the node of the repository", () => {
  it("is one exact version in .npmrc, at least what package.json asks for", () => {
    const [major = 0, minor = 0] = pinned.split(".").map(Number);
    const asked = /"node": ">=(\d+)\.(\d+)"/.exec(read("package.json"));
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(major).toBe(Number(asked?.[1]));
    expect(minor).toBeGreaterThanOrEqual(Number(asked?.[2]));
  });

  it("is the node of every setup-node step of CI", () => {
    const versions = [...read(".github/workflows/ci.yml").matchAll(/^\s+node-version: (\S+)$/gm)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions).toEqual(versions.map(() => pinned));
  });

  it("is the minor of the node the image is built and run on", () => {
    const bases = [...read("Dockerfile").matchAll(/^FROM (?:--platform=\S+ )?node:(\d+\.\d+)/gm)].map((m) => m[1]);
    expect(bases.length).toBeGreaterThan(0);
    expect(bases).toEqual(bases.map(() => pinned.split(".").slice(0, 2).join(".")));
  });

  it("is not switched to in the build stage of the image, where the base is a newer patch and musl cannot fetch the pin", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile.indexOf("RUN rm -f .npmrc")).toBeGreaterThan(dockerfile.indexOf("COPY . ."));
    expect(dockerfile.indexOf("RUN rm -f .npmrc")).toBeLessThan(dockerfile.indexOf("pnpm build"));
  });
});
