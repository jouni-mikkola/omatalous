import { describe, expect, it } from "vitest";
import { CloudflareApi, durationSeconds } from "../src/providers/cloudflare/api.ts";
import { CLOUDFLARE_API, CloudflareClient, CloudflareError } from "../src/providers/cloudflare/client.ts";

const TOKEN = "cf-api-token-0123456789abcdef";
const envelope = (result: unknown, info?: object, status = 200) => Response.json({ success: status < 400, errors: [], messages: [], result, ...(info ? { result_info: info } : {}) }, { status });

function client(answer: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const seen: { url: URL; init: RequestInit }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url, init: init ?? {} });
    return answer(url, init ?? {});
  }) as typeof fetch;
  return { seen, client: new CloudflareClient(TOKEN, fetchFn, 1000) };
}

describe("Cloudflare client", () => {
  it("sends the token as a bearer header to the API only, never follows a redirect and reads the envelope", async () => {
    const { seen, client: c } = client(() => envelope({ ok: 1 }));
    const a = await c.call("do a thing", "POST", "/accounts/a1/cfd_tunnel", { query: { name: "x y" }, body: { name: "x" } });
    expect(a.result).toEqual({ ok: 1 });
    expect(seen).toHaveLength(1);
    expect(String(seen[0]!.url)).toBe(`${CLOUDFLARE_API}/accounts/a1/cfd_tunnel?name=x+y`);
    expect(seen[0]!.init.redirect).toBe("manual");
    expect(new Headers(seen[0]!.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]!.init.body).toBe('{"name":"x"}');
  });

  it("a redirect is an error, not a second request with the token", async () => {
    const { seen, client: c } = client(() => new Response(null, { status: 301, headers: { location: "https://evil.example.net/" } }));
    await expect(c.call("do a thing", "GET", "/zones")).rejects.toMatchObject({ status: 301 });
    expect(seen).toHaveLength(1);
  });

  it("names the permission on a 403, tells a bad token on a 401 and keeps Cloudflare's words for the rest", async () => {
    const answers = new Map<number, Response>([
      [401, Response.json({ success: false, errors: [{ code: 9109, message: "Invalid access token" }] }, { status: 401 })],
      [403, Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, { status: 403 })],
      [400, Response.json({ success: false, errors: [{ code: 81053, message: "An A, AAAA, or CNAME record with that host already exists." }] }, { status: 400 })],
    ]);
    const c = (status: number) => client(() => answers.get(status)!.clone()).client.call("create the tunnel", "POST", "/x", { needs: "Account: Cloudflare Tunnel: Edit" });
    await expect(c(403)).rejects.toThrow('Cloudflare refused to create the tunnel (HTTP 403). The API token needs the permission "Account: Cloudflare Tunnel: Edit".');
    await expect(c(401)).rejects.toThrow("did not accept the API token (HTTP 401)");
    await expect(c(400)).rejects.toThrow("Cloudflare could not create the tunnel (HTTP 400): An A, AAAA, or CNAME record with that host already exists. (code 81053)");
  });

  it("a page that is not JSON, a 200 without success and an unreachable host fail without the body or the token in the message", async () => {
    const html = client(() => new Response("<html>Bad gateway: secret-body</html>", { status: 502 })).client;
    const e1 = await html.call("list the zones", "GET", "/zones").catch((e) => e as CloudflareError);
    expect(e1).toMatchObject({ status: 502, message: "Cloudflare could not list the zones (HTTP 502)" });
    const odd = client(() => Response.json({ success: false, errors: [{ code: 1, message: "odd" }] })).client;
    await expect(odd.call("list the zones", "GET", "/zones")).rejects.toMatchObject({ status: 200 });
    const down = client(() => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED", message: `connect with ${TOKEN}` } });
    }).client;
    const e3 = (await down.call("list the zones", "GET", "/zones").catch((e) => e)) as CloudflareError;
    expect(e3).toMatchObject({ status: 0, message: "Cloudflare is not reachable while trying to list the zones: TypeError ECONNREFUSED" });
    expect(e3.message).not.toContain(TOKEN);
  });

  it("refuses an answer that is too large", async () => {
    const big = client(() => new Response("x".repeat(5_000_001), { status: 200 })).client;
    await expect(big.call("list the zones", "GET", "/zones")).rejects.toThrow("too large");
  });
});

describe("Cloudflare api", () => {
  const zone = (n: number) => ({ id: `z${n}`, name: `Site${n}.example.fi`, account: { id: "a1", name: "A" } });

  it("reads every page of a list, and lower-cases the zone names", async () => {
    const { seen, client: c } = client((url) => {
      const page = Number(url.searchParams.get("page"));
      return envelope([zone(page * 2), zone(page * 2 + 1)], { page, per_page: 50, total_count: 6, total_pages: 3 });
    });
    const zones = await new CloudflareApi(c).listZones();
    expect(zones.map((z) => z.name)).toEqual(["site2.example.fi", "site3.example.fi", "site4.example.fi", "site5.example.fi", "site6.example.fi", "site7.example.fi"]);
    expect(seen.map((s) => s.url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
  });

  it("drops items that are not what the API describes", async () => {
    const { client: c } = client(() => envelope([zone(1), { id: "z9" }, "junk", { id: "z8", name: "x.fi", account: {} }]));
    expect((await new CloudflareApi(c).listZones()).map((z) => z.id)).toEqual(["z1"]);
  });

  it("reads a Go duration however the API spells it", () => {
    expect(durationSeconds("24h")).toBe(86400);
    expect(durationSeconds("24h0m0s")).toBe(86400);
    expect(durationSeconds("1440m")).toBe(86400);
    expect(durationSeconds("2h45m")).toBe(9900);
    expect(durationSeconds("tomorrow")).toBeNull();
    expect(durationSeconds(undefined)).toBeNull();
  });
});
