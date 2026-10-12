/** Bank logos (BL1): which address the server fetches, for whom and how often, and what the browser gets back. */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { offeredBanks } from "../src/connectors/enable-banking/app-setup.ts";
import { offeredFrom } from "../src/connectors/enable-banking/banks.ts";
import { LOGO_MAX_BYTES, logoAddress } from "../src/connectors/enable-banking/logos.ts";
import { type Client, NOW, setupApp } from "./helpers.ts";
import { BRANDS, LIST_WITH_LOGOS, mockBank, picture, SQUARE_PNG, SVG, WIDE_PNG } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const withApp = () => ({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem });
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const OP = `${BRANDS}op/`;

/** A bank list of Nordea and the banks named, each with the logo address given. */
const listOf = (logos: Record<string, unknown>) => [{ name: "Nordea", country: "FI" }, ...Object.entries(logos).map(([name, logo]) => ({ name, country: "FI", logo }))];

/** A household whose application lists `aspsps`. The list has been read, as a page load reads it. */
async function household(aspsps: object[] = LIST_WITH_LOGOS.aspsps, load = true) {
  const bank = mockBank();
  bank.answers["GET /aspsps"] = { status: 200, body: { aspsps } };
  const clock = { now: NOW };
  const ctx = await setupApp(withApp(), bank.fetchMock, { now: () => clock.now });
  if (load) await ctx.admin.call("GET", "/api/meta");
  const before = bank.calls.length;
  /** The request an <img> makes: the session cookie and nothing else. */
  const logo = async (id: string, who: Pick<Client, "cookie"> = ctx.admin) => {
    const res = await ctx.app.request(`http://localhost:8080/api/bank/logos/${id}`, { headers: who.cookie ? { Cookie: who.cookie } : {} });
    return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
  };
  return { ...ctx, bank, clock, logo, fetched: () => bank.pictureCalls.map((c) => c.url), apiCallsSince: () => bank.calls.length - before };
}

const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});
const logged = (spy: ReturnType<typeof quiet>) => spy.mock.calls.map((args) => args.join(" "));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a logo address", () => {
  it("is used when it is https on enablebanking.com or a subdomain of it", () => {
    expect(logoAddress("https://enablebanking.com/brands/FI/OP/")).toBe("https://enablebanking.com/brands/FI/OP/");
    expect(logoAddress("https://cdn.enablebanking.com/a/b.png?v=2")).toBe("https://cdn.enablebanking.com/a/b.png?v=2");
    // the parsed form is the one that is called
    expect(logoAddress("HTTPS://EnableBanking.COM:443/brands/../x.svg")).toBe("https://enablebanking.com/x.svg");
  });

  it("counts as no logo on another host, over http, on another port, with a user name, and when it is no address", () => {
    const refused = [
      "http://enablebanking.com/brands/FI/OP/",
      "https://example.org/op.png",
      "https://enablebanking.com.example.org/op.png",
      "https://notenablebanking.com/op.png",
      "https://enablebanking.com@example.org/op.png",
      "https://user:secret@enablebanking.com/op.png",
      "https://enablebanking.com:8443/op.png",
      "https://example.org\\@enablebanking.com/op.png",
      "https://enablebanking.com./op.png",
      "https://.enablebanking.com/op.png",
      "https://cdn..enablebanking.com/op.png",
      "https://127.0.0.1/op.png",
      "https://[::1]/op.png",
      "//enablebanking.com/op.png",
      "/brands/FI/OP/",
      "ftp://enablebanking.com/op.png",
      "file:///etc/passwd",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      `https://enablebanking.com/${"a".repeat(600)}`,
      "",
      null,
      undefined,
      42,
      { href: "https://enablebanking.com/op.png" },
    ];
    for (const value of refused) expect(logoAddress(value), String(value)).toBeNull();
  });
});

describe("the bank options", () => {
  it("say whether a logo is served: the live list gave an address the server may fetch", async () => {
    const flags = (banks: readonly { id: string; logo?: boolean }[]) => banks.map((b) => [b.id, b.logo]);
    expect(flags(offeredFrom(LIST_WITH_LOGOS.aspsps))).toEqual([
      ["nordea-fi", undefined],
      ["op-fi", true],
      ["danske-fi", true],
      ["s-pankki-fi", true],
      ["aktia-fi", true],
    ]);
    const { s } = await household(listOf({ OP: "http://enablebanking.com/op.png", Aktia: "https://example.org/aktia.png", Holvi: `${BRANDS}holvi/`, Revolut: 7 }));
    expect(flags(await offeredBanks(s))).toEqual([
      ["nordea-fi", undefined],
      ["op-fi", undefined],
      ["aktia-fi", undefined],
      ["holvi-fi", true],
      ["revolut-fi", undefined],
    ]);
  });

  it("reach the web with the flag and without the address", async () => {
    const h = await household();
    for (const who of [h.admin, await h.member("eero")]) {
      const { body } = await who.call("GET", "/api/meta");
      expect(body.bank.banks.filter((b: { logo?: boolean }) => b.logo).map((b: { id: string }) => b.id)).toEqual(["op-fi", "danske-fi", "s-pankki-fi", "aktia-fi"]);
      expect(body.bank.banks.find((b: { id: string }) => b.id === "nordea-fi")).toEqual({ id: "nordea-fi", name: "Nordea", country: "FI" });
      expect(JSON.stringify(body)).not.toContain("enablebanking.com/brands");
    }
  });
});

describe("GET /api/bank/logos/:id", () => {
  it("serves the picture of a bank on the list to any signed-in member, with headers that let it run nothing", async () => {
    const h = await household();
    const eero = await h.member("eero");
    const wide = await h.logo("op-fi", eero);
    expect(wide.status).toBe(200);
    expect(wide.bytes).toEqual(WIDE_PNG);
    expect(wide.headers.get("content-type")).toBe("image/png");
    expect(wide.headers.get("x-content-type-options")).toBe("nosniff");
    expect(wide.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox");
    expect(wide.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(wide.headers.get("set-cookie")).toBeNull();

    const square = await h.logo("danske-fi");
    expect(square.bytes).toEqual(SQUARE_PNG);
    // the type is one of the server's own four strings, not the header Enable Banking sent
    const svg = await h.logo("s-pankki-fi");
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg.headers.get("content-security-policy")).toContain("sandbox");
    expect(new TextDecoder().decode(svg.bytes)).toBe(SVG);
  });

  it("sends Enable Banking a plain GET: no key, no cookie, and no redirect followed", async () => {
    const h = await household();
    await h.logo("op-fi");
    expect(h.bank.pictureCalls).toHaveLength(1);
    const { url, init } = h.bank.pictureCalls[0]!;
    expect(url).toBe(OP);
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.redirect).toBe("manual");
    expect(init?.body).toBeUndefined();
    expect([...new Headers(init?.headers).keys()]).toEqual(["accept"]);
    // the signed API was not called for it either
    expect(h.apiCallsSince()).toBe(0);
  });

  it("asks once per bank for as long as the bank list lives, and again for a new list", async () => {
    const h = await household();
    const three = await Promise.all([h.logo("op-fi"), h.logo("op-fi"), h.logo("op-fi")]);
    expect(three.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(h.fetched()).toEqual([OP]);
    h.clock.now = minutes(23 * 60);
    expect((await h.logo("op-fi")).status).toBe(200);
    expect(h.fetched()).toEqual([OP]);

    // a day later the page load reads a new list, and the picture is asked for again
    h.clock.now = minutes(25 * 60);
    await h.admin.call("GET", "/api/meta");
    expect((await h.logo("op-fi")).status).toBe(200);
    expect(h.fetched()).toEqual([OP, OP]);
  });

  it("gives no picture without a session, and makes no call", async () => {
    const h = await household();
    const anonymous = await h.logo("op-fi", { cookie: "" });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("content-type")).toContain("json");
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    const forged = await h.logo("op-fi", { cookie: "talous_session=nobody" });
    expect(forged.status).toBe(401);
    expect(h.fetched()).toEqual([]);
  });

  it("answers 404 without an outbound call for an id that is no bank with a logo on the household's list", async () => {
    const h = await household();
    // no bank of the registry, a registry bank the list does not have, and a listed bank without a logo address
    for (const id of ["unknown", "op", "OP-FI", "..%2Fmeta", "https%3A%2F%2Fexample.org%2Fa.png", "holvi-fi", "nordea-fi"]) {
      const res = await h.logo(id);
      expect(res.status, id).toBe(404);
      // a refusal keeps the app's own headers
      expect(res.headers.get("cache-control"), id).toBe("no-store");
      expect(res.headers.get("content-security-policy"), id).toContain("default-src 'self'");
    }
    expect(h.fetched()).toEqual([]);
    expect(h.apiCallsSince()).toBe(0);

    // before the bank list has been read there is no list to be on: the request does not fetch one
    const cold = await household(LIST_WITH_LOGOS.aspsps, false);
    expect((await cold.logo("op-fi")).status).toBe(404);
    expect(cold.bank.calls).toEqual([]);
    expect(cold.fetched()).toEqual([]);
  });

  it("never fetches an address on another host, over http, on another port or with a user name", async () => {
    const h = await household(
      listOf({
        OP: "https://example.org/op.png",
        "Danske Bank": "http://enablebanking.com/danske.png",
        "S-Pankki": "https://enablebanking.com.example.org/s.png",
        Aktia: "https://enablebanking.com:8443/aktia.png",
        Holvi: "https://user:secret@enablebanking.com/holvi.png",
        Revolut: "https://169.254.169.254/latest/meta-data/",
      }),
    );
    // every one of them would answer with a picture
    h.bank.pictures = new Proxy({}, { get: () => () => picture(WIDE_PNG, "image/png") });
    for (const id of ["op-fi", "danske-fi", "s-pankki-fi", "aktia-fi", "holvi-fi", "revolut-fi"]) expect((await h.logo(id)).status, id).toBe(404);
    expect(h.fetched()).toEqual([]);
  });

  it("does not follow a redirect: the answer is a failure and its Location is never called", async () => {
    const errors = quiet();
    const h = await household();
    h.bank.pictures["https://example.org/op.png"] = () => picture(WIDE_PNG, "image/png");
    h.bank.pictures[`${BRANDS}moved/op.png`] = () => picture(WIDE_PNG, "image/png");
    h.bank.pictures[OP] = () => new Response(null, { status: 302, headers: { Location: "https://example.org/op.png" } });
    // also to the same host, and when the fetch in use followed it on its own
    h.bank.pictures[`${BRANDS}danske/`] = () => new Response(null, { status: 301, headers: { Location: `${BRANDS}moved/op.png` } });
    h.bank.pictures[`${BRANDS}s-pankki/`] = () => Object.defineProperty(picture(WIDE_PNG, "image/png"), "redirected", { value: true });
    for (const id of ["op-fi", "danske-fi", "s-pankki-fi"]) expect((await h.logo(id)).status, id).toBe(404);
    expect(h.fetched()).toEqual([OP, `${BRANDS}danske/`, `${BRANDS}s-pankki/`]);
    expect(logged(errors)).toEqual(["bank logo: op-fi redirect", "bank logo: danske-fi redirect", "bank logo: s-pankki-fi redirect"]);
  });

  it("leaves the name plate for an answer that is too large, of another type or not the picture it says, and waits ten minutes before it asks again", async () => {
    const errors = quiet();
    const tooLarge = new Uint8Array(LOGO_MAX_BYTES + 1);
    tooLarge.set(WIDE_PNG);
    const endless = () => new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(64_000)) });
    const cases: [name: string, id: string, code: string, answer: () => Response][] = [
      ["OP", "op-fi", "size", () => picture(tooLarge, "image/png")],
      ["Danske Bank", "danske-fi", "size", () => picture(WIDE_PNG, "image/png", { "Content-Length": "5000000" })],
      ["S-Pankki", "s-pankki-fi", "size", () => picture(endless(), "image/png")],
      ["Aktia", "aktia-fi", "type", () => picture("<html><script>alert(1)</script></html>", "text/html")],
      ["Holvi", "holvi-fi", "type", () => picture(WIDE_PNG, "image/gif")],
      ["Revolut", "revolut-fi", "type", () => new Response(WIDE_PNG)],
      ["Eurocard", "eurocard-fi", "content", () => picture(WIDE_PNG, "image/jpeg")],
      ["Resurs Bank", "resurs-fi", "content", () => picture("<html><body>503</body></html>", "image/svg+xml")],
      ["Morrow Bank", "morrow-fi", "content", () => picture(new Uint8Array(0), "image/png")],
      ["POP Pankki", "pop-fi", "content", () => picture("RIFF....WAVEfmt ", "image/webp")],
      ["Säästöpankki", "saastopankki-fi", "status", () => new Response("gone", { status: 404 })],
      ["Ålandsbanken", "alandsbanken-fi", "status", () => new Response(WIDE_PNG, { status: 500, headers: { "Content-Type": "image/png" } })],
    ];
    const h = await household(listOf(Object.fromEntries(cases.map(([name, id]) => [name, `${BRANDS}${id}`]))));
    for (const [, id, , answer] of cases) h.bank.pictures[`${BRANDS}${id}`] = answer;

    for (const [, id] of cases) expect((await h.logo(id)).status, id).toBe(404);
    expect(h.fetched()).toHaveLength(cases.length);
    expect(logged(errors)).toEqual(cases.map(([, id, code]) => `bank logo: ${id} ${code}`));
    // the log has the bank id and a code: no address, nothing of the answer
    expect(logged(errors).join("\n")).not.toMatch(/enablebanking|https?:|html|503/);

    // every page load of the next ten minutes asks nothing
    h.clock.now = minutes(9);
    for (const [, id] of cases) expect((await h.logo(id)).status, id).toBe(404);
    expect(h.fetched()).toHaveLength(cases.length);
    // a new bank list does not make a broken address worth asking sooner
    await h.admin.call("POST", "/api/admin/bank-app/test");
    expect((await h.logo("op-fi")).status).toBe(404);
    expect(h.fetched()).toHaveLength(cases.length);

    // after ten minutes it is asked again, and a picture that has been fixed is served
    h.bank.pictures[`${BRANDS}op-fi`] = () => picture(WIDE_PNG, "image/png");
    h.clock.now = minutes(11);
    const fixed = await h.logo("op-fi");
    expect(fixed.status).toBe(200);
    expect(fixed.bytes).toEqual(WIDE_PNG);
    expect(h.fetched()).toHaveLength(cases.length + 1);
  });

  it("takes a picture of exactly the limit, a JPEG and a WebP", async () => {
    const atLimit = new Uint8Array(LOGO_MAX_BYTES);
    atLimit.set(WIDE_PNG);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
    const webp = new TextEncoder().encode("RIFF\u0010\u0000\u0000\u0000WEBPVP8 ");
    const h = await household(listOf({ OP: OP, Aktia: `${BRANDS}aktia.jpg`, Holvi: `${BRANDS}holvi.webp` }));
    h.bank.pictures[OP] = () => picture(atLimit, "image/png");
    h.bank.pictures[`${BRANDS}aktia.jpg`] = () => picture(jpeg, "IMAGE/JPEG");
    h.bank.pictures[`${BRANDS}holvi.webp`] = () => picture(webp, "image/webp");
    expect((await h.logo("op-fi")).bytes).toHaveLength(LOGO_MAX_BYTES);
    const aktia = await h.logo("aktia-fi");
    expect([aktia.status, aktia.headers.get("content-type")]).toEqual([200, "image/jpeg"]);
    expect(aktia.bytes).toEqual(jpeg);
    const holvi = await h.logo("holvi-fi");
    expect([holvi.status, holvi.headers.get("content-type")]).toEqual([200, "image/webp"]);
  });

  it("gives up on an answer that takes more than five seconds, and does not ask again within ten minutes", async () => {
    const errors = quiet();
    const h = await household();
    // one never answers, one sends its headers and the first bytes and then nothing; neither heeds the abort signal
    h.bank.pictures[OP] = () => new Promise<Response>(() => {});
    h.bank.pictures[`${BRANDS}danske/`] = () => picture(new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(WIDE_PNG.slice(0, 16)) }), "image/png");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let done = false;
    const answers = Promise.all([h.logo("op-fi"), h.logo("danske-fi")]).finally(() => (done = true));
    // the five seconds start when the call is made
    while (h.bank.pictureCalls.length < 2) await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(4900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect((await answers).map((r) => r.status)).toEqual([404, 404]);
    vi.useRealTimers();
    expect(h.bank.pictureCalls.every((c) => c.init?.signal?.aborted)).toBe(true);
    expect(logged(errors).sort()).toEqual(["bank logo: danske-fi timeout", "bank logo: op-fi timeout"]);

    h.clock.now = minutes(9);
    expect((await h.logo("op-fi")).status).toBe(404);
    expect(h.fetched()).toHaveLength(2);
  });
});
