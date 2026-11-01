import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BANKS } from "../../apps/server/src/connectors/enable-banking/banks.ts";
import { CLOUDFLARE_API } from "../../apps/server/src/providers/cloudflare/client.ts";
import { PRH_SEARCH_URL } from "../../apps/server/src/providers/prh/client.ts";
import { checkRecorded, isAllowed, listedHosts } from "./outside-hosts.mjs";

const security = readFileSync(join(import.meta.dirname, "../../docs/SECURITY.md"), "utf8");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function recorded(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hosts-"));
  dirs.push(dir);
  writeFileSync(join(dir, "server-1.log"), lines.join("\n") + "\n");
  return dir;
}

describe("outside hosts list", () => {
  it("matches a host by name, and a starred host with its subdomains", () => {
    const list = ["api.enablebanking.com", "*.nordea.com"];
    expect(isAllowed(list, "API.enablebanking.com")).toBe(true);
    expect(isAllowed(list, "enablebanking.com")).toBe(false);
    expect(isAllowed(list, "nordea.com")).toBe(true);
    expect(isAllowed(list, "login.nordea.com")).toBe(true);
    expect(isAllowed(list, "evilnordea.com")).toBe(false);
  });

  it("holds the hosts the code calls: the bank, the register, Cloudflare and every bank's sign-in hosts", () => {
    const list = listedHosts(security);
    expect(isAllowed(list, "api.enablebanking.com")).toBe(true);
    expect(isAllowed(list, "logo.enablebanking.com")).toBe(true);
    expect(isAllowed(list, new URL(PRH_SEARCH_URL).hostname)).toBe(true);
    expect(isAllowed(list, new URL(CLOUDFLARE_API).hostname)).toBe(true);
    expect(isAllowed(list, "team.cloudflareaccess.com")).toBe(true);
    expect(isAllowed(list, "jouni-mikkola.github.io")).toBe(true);
    for (const bank of BANKS) for (const host of bank.authHosts) expect(isAllowed(list, host), `${bank.id}: ${host}`).toBe(true);
  });

  it("fails on a host that is not listed and allows the machine and the named fake host", () => {
    const dir = recorded(["server\t127.0.0.1", "browser\tlocalhost", "browser\tconsent.fake.example", "browser\tfonts.googleapis.com", "server\t[::1]"]);
    const { bad, report } = checkRecorded(dir, security, ["consent.fake.example"]);
    expect(bad).toEqual(["fonts.googleapis.com"]);
    expect(report).toContain("NOT LISTED fonts.googleapis.com");
  });

  it("allows the ntfy host only in a run where a spec turned notices on", () => {
    expect(isAllowed(listedHosts(security), "ntfy.sh")).toBe(false);
    expect(isAllowed(listedHosts(security, ["notices"]), "ntfy.sh")).toBe(true);
    expect(checkRecorded(recorded(["server\tntfy.sh"]), security, []).bad).toEqual(["ntfy.sh"]);
    expect(checkRecorded(recorded(["server\tntfy.sh", "opt-in\tnotices"]), security, []).bad).toEqual([]);
    // the marker is no host
    expect(checkRecorded(recorded(["opt-in\tnotices"]), security, []).report).toBe("");
  });

  it("refuses a document with no list", () => {
    expect(() => listedHosts("# Security")).toThrow(/no outside-hosts list/);
  });
});
