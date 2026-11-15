import { describe, expect, it } from "vitest";
import { RUNNERS, floatingRunners } from "./runners.ts";

const job = (runsOn: string, rest = "") => `jobs:\n  a:\n    runs-on: ${runsOn}\n${rest}`;
const whys = (text: string) => floatingRunners(text).map((f) => f.why);

describe("rule 23 detection", () => {
  it("refuses a -latest label and says where", () => {
    expect(floatingRunners(job("ubuntu-latest"))).toEqual([{ line: 3, why: "ubuntu-latest moves to a newer image on a day GitHub picks" }]);
    expect(whys(job('"ubuntu-latest" # as it was'))).toEqual(["ubuntu-latest moves to a newer image on a day GitHub picks"]);
    expect(whys(job("macos-latest"))).toHaveLength(1);
    expect(whys(`${job("ubuntu-24.04")}  b:\n    runs-on: ubuntu-latest\n`)).toHaveLength(1);
  });

  it("accepts the two images, also quoted and with a comment after them", () => {
    for (const r of RUNNERS) expect(floatingRunners(job(r))).toEqual([]);
    expect(floatingRunners(job('"ubuntu-24.04"'))).toEqual([]);
    expect(floatingRunners(job("ubuntu-24.04-arm # the arm64 half"))).toEqual([]);
    expect(floatingRunners("    # runs-on: ubuntu-latest\n")).toEqual([]);
  });

  it("refuses any other label, a list, an expression and a runner named on other lines", () => {
    expect(whys(job("ubuntu-22.04"))).toEqual(["ubuntu-22.04 is not ubuntu-24.04 or ubuntu-24.04-arm"]);
    expect(whys(job("[self-hosted, linux]"))).toHaveLength(1);
    expect(whys(job("${{ inputs.runner }}"))).toHaveLength(1);
    expect(whys(job("${{ matrix.runner || 'ubuntu-24.04' }}"))).toHaveLength(1);
    expect(whys(job("", "      group: big\n"))).toEqual(["names its runner on other lines"]);
  });

  it("refuses a job written as one flow mapping on a line, whatever it names", () => {
    const why = "holds runs-on after something else on the line, where this rule cannot read it";
    expect(floatingRunners("jobs:\n  a: { runs-on: ubuntu-latest, steps: [{ run: make }] }\n")).toEqual([{ line: 2, why }]);
    expect(whys("jobs:\n  a: { runs-on: ubuntu-24.04, steps: [{ run: make }] }\n")).toEqual([why]);
    expect(whys('jobs:\n  a: { "runs-on": ubuntu-latest }\n')).toEqual([why]);
    expect(whys("jobs: { a: { steps: [], runs-on: ubuntu-latest } }\n")).toEqual([why]);
    expect(whys("jobs:\n  a: {\n    runs-on: ubuntu-latest,\n    steps: []\n  }\n")).toHaveLength(1);
    expect(floatingRunners("    # a job as { runs-on: ubuntu-latest } is not written here\n")).toEqual([]);
  });

  it("follows a matrix key to every value the file gives it", () => {
    const on = job("${{ matrix.runner }}");
    const include = (second: string) => `    strategy:\n      matrix:\n        include:\n          - arch: amd64\n            runner: ubuntu-24.04\n          - arch: arm64\n            runner: ${second}\n`;
    expect(floatingRunners(on + include("ubuntu-24.04-arm"))).toEqual([]);
    expect(floatingRunners(on + include("ubuntu-latest"))).toEqual([{ line: 3, why: "runs on matrix.runner, which can be ubuntu-latest" }]);
    expect(floatingRunners(`${on}    strategy:\n      matrix:\n        runner: [ubuntu-24.04, ubuntu-24.04-arm]\n`)).toEqual([]);
    expect(whys(`${on}    strategy:\n      matrix:\n        runner: [ubuntu-24.04, ubuntu-latest]\n`)).toEqual(["runs on matrix.runner, which can be ubuntu-latest"]);
    expect(floatingRunners(`${on}    strategy:\n      matrix:\n        runner:\n          - ubuntu-24.04\n          # the arm64 half\n          - ubuntu-24.04-arm\n    steps: []\n`)).toEqual([]);
    expect(whys(`${on}    strategy:\n      matrix:\n        runner:\n          - ubuntu-24.04\n          - ubuntu-latest\n`)).toEqual(["runs on matrix.runner, which can be ubuntu-latest"]);
    expect(floatingRunners(`${on}    strategy:\n      matrix:\n        include:\n          - { arch: amd64, runner: ubuntu-24.04 }\n          - { runner: ubuntu-24.04-arm, arch: arm64 }\n`)).toEqual([]);
    expect(whys(`${on}    strategy:\n      matrix:\n        include:\n          - { arch: arm64, runner: ubuntu-latest }\n`)).toEqual(["runs on matrix.runner, which can be ubuntu-latest"]);
    expect(whys(on)).toEqual(["runs on matrix.runner, and the file gives runner no value"]);
  });
});
