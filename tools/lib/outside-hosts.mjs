// @ts-check
/**
 * The list of outside hosts in docs/SECURITY.md and the check of an e2e run against it. Decision: which hosts the server
 * and the browser may call, written once, in the document the household reads, and held by the run.
 *
 * The list is the rows of the table between the `outside-hosts` markers whose first cell is a host in backticks. `host`
 * names that host only; `*.host` names the host and every subdomain of it. The recorders (e2e/record-sockets.mjs for the
 * server, e2e/browser-hosts.ts for the browser) append one `<who>\t<host>` line per call to a file in a folder.
 *
 * A row whose last cell ends in `[opt-in: <name>]` is a service the household turns on itself. Its host is allowed only
 * in a run where a spec turned that service on and wrote an `opt-in\t<name>` line into the recorders' folder (`E2E_HOSTS_DIR`).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Hosts of the machine itself. The e2e runs use a fake bank on 127.0.0.1, so these are allowed by name and are not in the document. */
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]", "::1"];

/** @param {string} text docs/SECURITY.md @param {readonly string[]} [turnedOn] the opt-in services a run turned on @returns {string[]} */
export function listedHosts(text, turnedOn = []) {
  const block = /<!-- outside-hosts -->([\s\S]*?)<!-- \/outside-hosts -->/.exec(text)?.[1];
  if (block === undefined) throw new Error("docs/SECURITY.md has no outside-hosts list");
  const hosts = [...block.matchAll(/^\|\s*`([^`]+)`[^\n]*$/gm)]
    .filter((m) => {
      const name = /\[opt-in: ([a-z-]+)\]\s*\|?\s*$/.exec(m[0])?.[1];
      return name === undefined || turnedOn.includes(name);
    })
    .map((m) => (m[1] ?? "").toLowerCase());
  if (!hosts.length) throw new Error("the outside-hosts list of docs/SECURITY.md is empty");
  return hosts;
}

/** @param {readonly string[]} patterns @param {string} host */
export function isAllowed(patterns, host) {
  const name = host.toLowerCase();
  return patterns.some((p) => (p.startsWith("*.") ? name === p.slice(2) || name.endsWith(p.slice(1)) : name === p));
}

/** What the recorders wrote: host -> who called it ("server" or "browser"). @param {string} dir @returns {Map<string, Set<string>>} */
function recordedHosts(dir) {
  /** @type {Map<string, Set<string>>} */
  const seen = new Map();
  for (const file of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      const [who, host] = line.split("\t");
      if (!who || !host || who === "opt-in") continue;
      seen.set(host, (seen.get(host) ?? new Set()).add(who));
    }
  }
  return seen;
}

/** The opt-in services the specs of a run turned on. @param {string} dir @returns {string[]} */
function turnedOnServices(dir) {
  const names = new Set();
  for (const file of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      const [who, name] = line.split("\t");
      if (who === "opt-in" && name) names.add(name);
    }
  }
  return [...names];
}

/**
 * @param {string} dir the recorders' folder
 * @param {string} securityText docs/SECURITY.md
 * @param {readonly string[]} named extra hosts allowed by name (the fake bank's consent host)
 * @returns {{ report: string, bad: string[] }} one line per host called, and the hosts not allowed
 */
export function checkRecorded(dir, securityText, named) {
  const patterns = [...listedHosts(securityText, turnedOnServices(dir)), ...LOCAL_HOSTS, ...named.map((h) => h.toLowerCase())];
  const seen = recordedHosts(dir);
  const hosts = [...seen.keys()].sort();
  const bad = hosts.filter((h) => !isAllowed(patterns, h));
  const report = hosts.map((h) => `  ${bad.includes(h) ? "NOT LISTED" : "ok        "} ${h} (${[...(seen.get(h) ?? [])].sort().join(", ")})`).join("\n");
  return { report, bad };
}
