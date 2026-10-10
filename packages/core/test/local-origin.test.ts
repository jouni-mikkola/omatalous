import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { originFromRelayState, parseLocalOrigin, relayState } from "../src/local-origin.ts";

const PAGE = readFileSync(new URL("../../../relay/paluu/index.html", import.meta.url), "utf8");
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(PAGE)![1]!;
const STYLE = /<style>([\s\S]*?)<\/style>/.exec(PAGE)![1]!;

/** The return page's own copy of the rule, loaded the way a browser would run it. */
function pageFunctions() {
  const ctx = createContext({ URL, URLSearchParams, atob });
  runInContext(SCRIPT, ctx);
  return ctx as unknown as {
    parseLocalOrigin(v: unknown): string | null;
    originFromState(v: unknown): string | null;
    returnTarget(search: string): { origin: string; url: string } | null;
    paluu(loc: unknown, doc: unknown, nav: unknown): unknown;
  };
}

const ACCEPT: Array<[string, string]> = [
  ["http://192.168.1.10:8080", "http://192.168.1.10:8080"],
  ["http://192.168.1.10:8080/", "http://192.168.1.10:8080"],
  ["http://10.0.0.5", "http://10.0.0.5"],
  ["http://10.255.255.255:81", "http://10.255.255.255:81"],
  ["http://172.16.0.1:8081", "http://172.16.0.1:8081"],
  ["http://172.31.255.254", "http://172.31.255.254"],
  ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
  ["http://127.5.5.5", "http://127.5.5.5"],
  ["http://localhost:5173", "http://localhost:5173"],
  ["https://localhost", "https://localhost"],
  ["http://talous.local:8080", "http://talous.local:8080"],
  ["http://nas.lan", "http://nas.lan"],
  ["http://koti.home.arpa:8080", "http://koti.home.arpa:8080"],
  ["http://a.b.internal", "http://a.b.internal"],
  ["http://[::1]:8080", "http://[::1]:8080"],
  ["http://[fd12:3456:789a::1]:8080", "http://[fd12:3456:789a::1]:8080"],
  ["http://[fc00::1]", "http://[fc00::1]"],
  ["https://192.168.0.2:8443", "https://192.168.0.2:8443"],
];

const REJECT: string[] = [
  // public addresses and names
  "http://8.8.8.8",
  "http://1.1.1.1:8080",
  "https://talous.example.fi",
  "https://example.com",
  "http://evil.com.local.example.com",
  "http://notlocal.com",
  "http://192.169.1.1",
  "http://172.15.0.1",
  "http://172.32.0.1",
  "http://11.0.0.1",
  "http://100.64.0.1",
  "http://169.254.1.1",
  "http://0.0.0.0",
  "http://[2001:db8::1]",
  "http://[fe80::1]",
  "http://[fb00::1]",
  "http://[fe00::1]",
  "http://[::ffff:192.168.1.1]",
  "http://[::]",
  // forms that are not plain origins
  "http://192.168.1.10/path",
  "http://192.168.1.10/?x=1",
  "http://192.168.1.10/#x",
  "http://192.168.1.10?x=1",
  "http://user@192.168.1.10",
  "http://user:pw@192.168.1.10",
  "http://192.168.1.10@evil.com",
  "http://evil.com@192.168.1.10",
  "http://192.168.1.10:80",
  "https://192.168.1.10:443",
  "http://192.168.1.10:0",
  "http://192.168.1.10:65536",
  "http://192.168.1.10:abc",
  "javascript:alert(1)",
  "ftp://192.168.1.10",
  "//192.168.1.10",
  "192.168.1.10",
  "192.168.1.10:8080",
  "file:///etc/passwd",
  "data:text/html,<script>1</script>",
  "",
  " http://192.168.1.10",
  "http://192.168.1.10 ",
  "http://192.168.1.10\n",
  "http://192.168.1.10\\@evil.com",
  "http://192.168.1.10%2f@evil.com",
  "http://192.168.1.10\t",
  // numeric tricks that URL parsing would normalise into a private address
  "http://0xC0.168.1.10",
  "http://0300.168.1.10",
  "http://3232235786",
  "http://192.168.1",
  "http://192.168.0x1.10",
  "http://127.1",
  "http://2130706433",
  "http://1",
  // case and trailing dots
  "HTTP://192.168.1.10",
  "http://TALOUS.LOCAL",
  "http://Talous.local",
  "http://talous",
  "http://ai",
  "http://wpad",
  "http://com",
  "http://localhost.",
  "http://talous.local.",
  // names that are not local
  "http://xn--80ak6aa92e.local.evil",
  "http://-bad.local",
  "http://bad-.local",
  "http://a..local",
  "http://.local",
  "http://under_score.local",
  "http://a.local@b.com",
  // IPv6 zone ids and odd literals
  "http://[fe80::1%25eth0]",
  "http://[fd12::1%eth0]",
  "http://[::1",
  "http://::1",
  "http://[fd12::1]x",
];

describe("parseLocalOrigin", () => {
  it.each(ACCEPT)("accepts %s", (input, origin) => {
    expect(parseLocalOrigin(input)).toBe(origin);
  });

  it.each(REJECT)("refuses %j", (input) => {
    expect(parseLocalOrigin(input)).toBeNull();
  });

  it("refuses non-strings, long input and control characters", () => {
    for (const v of [undefined, null, 5, {}, [], true, ["http://localhost"]]) expect(parseLocalOrigin(v)).toBeNull();
    expect(parseLocalOrigin(`http://${"a".repeat(130)}.local`)).toBeNull();
    expect(parseLocalOrigin(`http://${"a".repeat(64)}.local`)).toBeNull();
    expect(parseLocalOrigin("http://local\u0000host")).toBeNull();
    expect(parseLocalOrigin("http://talous‮.local")).toBeNull();
  });

  it("never accepts a private-looking host with a public one hidden around it", () => {
    for (const host of ["192.168.1.10.evil.com", "10.0.0.1.nip.io", "evil.com#192.168.1.1", "evil.com?192.168.1.1", "192.168.1.1.evil"]) {
      expect(parseLocalOrigin(`http://${host}`), host).toBeNull();
    }
  });

  it("fuzz: every accepted value is a canonical private or local origin", () => {
    let seed = 20261009;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
    const schemes = ["http://", "https://", "HTTP://", "ftp://", "//", "", "http:/", "http:\\\\"];
    const hosts = ["192.168.1.1", "10.1.2.3", "172.20.0.9", "8.8.8.8", "localhost", "talous.local", "a.b.c", "[::1]", "[fd00::2]", "[2001::1]", "0x7f.1", "evil.com", "", "-", "1.2.3", "%31%39%32.168.1.1", "ａ.local", "talous.LOCAL"];
    const tails = ["", "/", ":8080", ":0", ":99999", "/x", "?q", "#f", "@evil.com", " ", "\t", ".", "%00", ":80", ":443"];
    const page = pageFunctions();
    let accepted = 0;
    for (let i = 0; i < 6000; i++) {
      const value = pick(schemes) + pick(hosts) + pick(tails);
      const got = parseLocalOrigin(value);
      // the page's copy decides the same way
      expect(page.parseLocalOrigin(value), value).toBe(got);
      if (got === null) continue;
      accepted++;
      const url = new URL(got);
      expect(got).toBe(url.origin);
      expect(url.pathname).toBe("/");
      expect(url.username + url.password + url.search + url.hash).toBe("");
      expect(parseLocalOrigin(got)).toBe(got);
    }
    expect(accepted).toBeGreaterThan(50);
  });
});

describe("relay state", () => {
  it("round trips the origin and keeps the token apart", () => {
    for (const [, origin] of ACCEPT) {
      const state = relayState("0a1b2c3d-1111-4222-8333-444455556666", origin);
      expect(state.startsWith("0a1b2c3d-1111-4222-8333-444455556666.")).toBe(true);
      expect(state).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(originFromRelayState(state)).toBe(origin);
    }
  });

  it("refuses a state without a valid local origin", () => {
    const pub = relayState("tok", "https://talous.example.fi");
    expect(originFromRelayState(pub)).toBeNull();
    expect(originFromRelayState("plain-token-without-dot")).toBeNull();
    expect(originFromRelayState(".aHR0cDovL2xvY2FsaG9zdA")).toBeNull();
    expect(originFromRelayState("tok.")).toBeNull();
    expect(originFromRelayState("tok.!!!")).toBeNull();
    expect(originFromRelayState("tok.a")).toBeNull();
    expect(originFromRelayState(`tok.${"A".repeat(400)}`)).toBeNull();
    expect(originFromRelayState(undefined)).toBeNull();
  });

  it("a changed origin part changes the whole state, which the server stores as its key", () => {
    expect(relayState("tok", "http://10.0.0.5")).not.toBe(relayState("tok", "http://10.0.0.6"));
  });
});

describe("return page", () => {
  it("carries a CSP that names exactly its own script and style", () => {
    const sha = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
    const csp = /Content-Security-Policy" content="([^"]*)"/.exec(PAGE)![1]!;
    expect(csp).toContain(`script-src ${sha(SCRIPT)};`);
    expect(csp).toContain(`style-src ${sha(STYLE)};`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/unsafe-|https?:|\*/);
    expect(PAGE).toContain('<meta name="referrer" content="no-referrer">');
    expect(PAGE).not.toMatch(/<script[^>]*src=|<link|<img|<iframe|@import|[^A-Za-z]url\(/);
    expect(PAGE).not.toMatch(/innerHTML|document\.write|eval\(|new Function/);
  });

  it("the page's parser agrees with the shared table", () => {
    const page = pageFunctions();
    for (const [input, origin] of ACCEPT) expect(page.parseLocalOrigin(input)).toBe(origin);
    for (const input of REJECT) expect(page.parseLocalOrigin(input), input).toBeNull();
  });

  it("forwards only code and state to the fixed callback path", () => {
    const page = pageFunctions();
    const state = relayState("tok-1", "http://192.168.1.10:8080");
    const t = page.returnTarget(`?code=abc123&state=${state}&error_description=hello&extra=1&session_state=x`);
    expect(t?.origin).toBe("http://192.168.1.10:8080");
    expect(t?.url).toBe(`http://192.168.1.10:8080/api/connections/callback?code=abc123&state=${state}`);
  });

  it("forwards a bank error as error and state, without the description", () => {
    const page = pageFunctions();
    const state = relayState("tok-2", "http://talous.local");
    const t = page.returnTarget(`?error=access_denied&error_description=${encodeURIComponent("<script>x</script>")}&state=${state}`);
    expect(t?.url).toBe(`http://talous.local/api/connections/callback?error=access_denied&state=${state}`);
  });

  it("forwards nowhere when the state or the query is bad", () => {
    const page = pageFunctions();
    const pub = relayState("tok", "https://talous.example.fi");
    const ok = relayState("tok", "http://10.0.0.5");
    expect(page.returnTarget(`?code=a&state=${pub}`)).toBeNull();
    expect(page.returnTarget("?code=a&state=plain")).toBeNull();
    expect(page.returnTarget("?code=a")).toBeNull();
    expect(page.returnTarget("")).toBeNull();
    expect(page.returnTarget(`?state=${ok}`)).toBeNull();
    // a state with a smuggled path or host does not decode to a local origin
    const evil = relayState("tok", "http://10.0.0.5/@evil.com");
    expect(page.returnTarget(`?code=a&state=${evil}`)).toBeNull();
  });

  it("the state the page reads is the one the server builds", () => {
    const page = pageFunctions();
    for (const [, origin] of ACCEPT) {
      const state = relayState("t", origin);
      expect(page.originFromState(state)).toBe(originFromRelayState(state));
    }
  });

  it("sends the browser on, shows the target as text and refuses bad input without navigating", () => {
    const page = pageFunctions();
    const make = () => {
      const els: Record<string, { textContent: string; hidden: boolean; attrs: Record<string, string>; handlers: Record<string, () => void> }> = {};
      for (const id of ["title", "where", "actions", "go", "copy"]) els[id] = { textContent: "", hidden: true, attrs: {}, handlers: {} };
      const doc = {
        getElementById: (id: string) => {
          const e = els[id]!;
          return { ...e, set textContent(v: string) { e.textContent = v; }, get textContent() { return e.textContent; }, set hidden(v: boolean) { e.hidden = v; }, setAttribute: (k: string, v: string) => (e.attrs[k] = v), addEventListener: (k: string, f: () => void) => (e.handlers[k] = f) };
        },
      };
      return { els, doc };
    };

    const good = make();
    const state = relayState("tok", "http://192.168.1.10:8080");
    const assigned: string[] = [];
    const copied: string[] = [];
    page.paluu({ search: `?code=c1&state=${state}`, assign: (u: string) => assigned.push(u) }, good.doc, { clipboard: { writeText: (t: string) => copied.push(t) } });
    expect(assigned).toEqual([`http://192.168.1.10:8080/api/connections/callback?code=c1&state=${state}`]);
    expect(good.els.where!.textContent).toBe("Palataan Omatalouteen: http://192.168.1.10:8080");
    expect(good.els.go!.attrs.href).toBe(assigned[0]);
    good.els.copy!.handlers.click!();
    expect(copied).toEqual(assigned);

    const bad = make();
    const none: string[] = [];
    page.paluu({ search: `?code=c1&state=${relayState("tok", "https://evil.example")}`, assign: (u: string) => none.push(u) }, bad.doc, {});
    expect(none).toEqual([]);
    expect(bad.els.title!.textContent).toBe("Paluuosoite ei kelpaa");
  });
});
