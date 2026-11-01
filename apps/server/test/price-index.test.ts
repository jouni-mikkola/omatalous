import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPriceIndex } from "../src/providers/statfin/client.ts";
import { priceIndexInput, refreshPriceIndex } from "../src/services/price-index.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { setupApp } from "./helpers.ts";

afterEach(() => vi.restoreAllMocks());

/** A made-up json-stat2 answer shaped like table 11xs: 36 months from 2023M10, index 100 rising by one a month. */
function answer(overrides: Record<string, unknown> = {}) {
  const labels: string[] = [];
  for (let i = 0; i < 36; i++) {
    const m = 10 + i - 1;
    labels.push(`${2023 + Math.floor(m / 12)}M${String((m % 12) + 1).padStart(2, "0")}`);
  }
  return {
    id: ["timeperiod_m", "contentscode"],
    size: [36, 1],
    dimension: {
      timeperiod_m: { category: { index: Object.fromEntries(labels.map((l, i) => [l, i])) } },
      contentscode: { category: { index: { ip_0_1972: 0 } } },
    },
    value: labels.map((_, i) => 100 + i),
    ...overrides,
  };
}

function fakeStatfin(body: unknown = answer(), status = 200) {
  const calls: { url: string; body: string }[] = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchMock };
}

const parsePriceIndex = async (body: unknown, fetchedAt: string) => fetchPriceIndex(fakeStatfin(body).fetchMock, fetchedAt).catch(() => null);

describe("price index parse", () => {
  it("reads the months of a json-stat2 answer", async () => {
    const p = (await parsePriceIndex(answer(), "2026-10-30"))!;
    expect(p.months["2023-10"]).toBe(100);
    expect(p.months["2026-09"]).toBe(135);
    expect(Object.keys(p.months)).toHaveLength(36);
  });

  it("refuses another table, a short series and a bad figure", async () => {
    expect(await parsePriceIndex(answer({ id: ["x", "y"] }), "2026-10-30")).toBeNull();
    expect(await parsePriceIndex(answer({ size: [3, 1], value: [1, 2, 3] }), "2026-10-30")).toBeNull();
    expect(await parsePriceIndex(null, "2026-10-30")).toBeNull();
    const bad = answer();
    (bad.value as unknown[])[5] = null;
    expect(Object.keys((await parsePriceIndex(bad, "2026-10-30"))!.months)).toHaveLength(35);
  });

  it("asks Statistics Finland for the public series only and fails on an error answer", async () => {
    const f = fakeStatfin();
    await fetchPriceIndex(f.fetchMock, "2026-10-30");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe("https://statfin.stat.fi/PxWeb/api/v1/en/StatFin/khi/11xs.px");
    expect(JSON.parse(f.calls[0]!.body).query).toEqual([{ code: "contentscode", selection: { filter: "item", values: ["ip_0_1972"] } }]);
    await expect(fetchPriceIndex(fakeStatfin({}, 503).fetchMock, "2026-10-30")).rejects.toThrow(/price index/);
    await expect(fetchPriceIndex(fakeStatfin({ id: [] }).fetchMock, "2026-10-30")).rejects.toThrow(/price index/);
  });
});

describe("price index setting", () => {
  it("is off by default: no request, no series, and the report says there is no comparison", async () => {
    const f = fakeStatfin();
    const t = await setupApp({}, f.fetchMock);
    expect(await refreshPriceIndex(t.s)).toBe("off");
    await hourlyTick(t.s);
    expect(f.calls).toHaveLength(0);
    expect(await priceIndexInput(t.s)).toBeNull();
  });

  it("fetches once a day when an admin turns it on, and the series is read only while it is on", async () => {
    const f = fakeStatfin();
    const t = await setupApp({}, f.fetchMock);
    const put = await t.admin.call("PUT", "/api/admin/instance", { priceIndex: true });
    expect(put.status).toBe(200);
    await vi.waitFor(async () => expect((await priceIndexInput(t.s))?.months["2026-09"]).toBe(135));
    expect(f.calls).toHaveLength(1);
    expect(await refreshPriceIndex(t.s)).toBe("fresh");
    expect(f.calls).toHaveLength(1);

    await t.admin.call("PUT", "/api/admin/instance", { priceIndex: false });
    expect(await priceIndexInput(t.s)).toBeNull();
  });

  it("keeps the stored series when a fetch fails", async () => {
    const ok = fakeStatfin();
    const t = await setupApp({}, ok.fetchMock);
    await t.admin.call("PUT", "/api/admin/instance", { priceIndex: true });
    await vi.waitFor(async () => expect(await priceIndexInput(t.s)).not.toBeNull());
    const key = "instance_price_index";
    const stored = JSON.parse((await t.s.settings.get(key))!);
    await t.s.settings.set(key, JSON.stringify({ ...stored, fetchedAt: "2000-01-01" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    (t.s as { fetch?: typeof fetch }).fetch = fakeStatfin({}, 503).fetchMock;
    expect(await refreshPriceIndex(t.s)).toBe("failed");
    expect((await priceIndexInput(t.s))?.months["2026-09"]).toBe(135);
  });
});
