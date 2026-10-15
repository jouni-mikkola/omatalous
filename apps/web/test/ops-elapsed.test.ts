import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapsed, queuedSentence, restartWait, startTicker } from "../src/components/ops/ops-elapsed.ts";
import { OpsProgress } from "../src/components/ops/OpsProgress.tsx";
import { failWait } from "../src/components/ops/use-polled.ts";
import type { OpsRequestView, OpsState } from "../src/components/ops/types.ts";

const NOW = Date.parse("2026-10-13T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const req = (over: Partial<OpsRequestView> = {}): OpsRequestView => ({
  id: "r1", action: "update", label: "päivitys", status: "queued", by: null, requestedAt: ago(30_000), finishedAt: null, summary: null, output: null, steps: [], ...over,
});
const html = (request: OpsRequestView, seenAgo: number | null = null, downSince: number | null = null, helperWakes = false) =>
  renderToStaticMarkup(createElement(OpsProgress, { request, down: downSince !== null, downSince, helperSeenAt: seenAgo === null ? null : NOW - seenAgo, helperWakes, onCancel: () => {} }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("elapsed", () => {
  it("counts seconds under a minute and minutes after", () => {
    expect(elapsed(0)).toBe("0 s");
    expect(elapsed(59_999)).toBe("59 s");
    expect(elapsed(60_000)).toBe("1 min 0 s");
    expect(elapsed(72_000)).toBe("1 min 12 s");
    expect(elapsed(-5000)).toBe("0 s");
  });
});

describe("the queued sentence", () => {
  it("names the next look of the helper, rounded up to 5 s", () => {
    expect(html(req(), 20_000)).toContain("noin 40 s kuluttua");
    expect(queuedSentence(NOW - 17_000, NOW)).toContain("noin 45 s kuluttua");
  });
  it("is the short one when the moment has passed or the time is missing", () => {
    expect(html(req(), 90_000)).toContain("Jonossa. Apuri hakee pyynnöt kerran minuutissa. Odotettu 30 s.");
    expect(html(req(), null)).not.toContain("kuluttua");
  });
  it("promises seconds only from a helper that wakes and polled under 50 s ago", () => {
    expect(html(req(), 20_000, null, true)).toContain("Jonossa. Apuri aloittaa muutamassa sekunnissa. Odotettu 30 s.");
    expect(html(req(), 49_000, null, true)).toContain("muutamassa sekunnissa");
    // polled 50 s ago or more: the earlier sentences, as they were
    expect(html(req(), 50_000, null, true)).toContain("Jonossa. Apuri hakee pyynnöt kerran minuutissa, seuraavan kerran noin 10 s kuluttua.");
    expect(html(req(), 90_000, null, true)).toContain("Jonossa. Apuri hakee pyynnöt kerran minuutissa. Odotettu 30 s.");
    // an older helper never promises it, however fresh its last look
    expect(html(req(), 5_000, null, false)).toContain("seuraavan kerran noin 55 s kuluttua");
    expect(html(req(), null, null, true)).not.toContain("sekunnissa");
  });
});

describe("a live and a finished request", () => {
  it("shows the time a running request has taken", () => {
    expect(html(req({ status: "running", requestedAt: ago(72_000) }))).toContain("Käynnissä, aikaa kulunut 1 min 12 s.");
  });
  it("counts a down app from when the page lost it", () => {
    expect(html(req({ status: "running" }), null, NOW - 12_000)).toContain("Sovellus käynnistyy uudelleen… Odotettu 12 s.");
  });
  it("stops the timer when the request is done, and shows the duration", () => {
    const stop = startTicker(() => {});
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    const out = html(req({ status: "ok", requestedAt: ago(80_000), finishedAt: ago(1000), summary: "Valmis." }));
    expect(out).toContain("Kesto 1 min 19 s.");
    expect(out).not.toContain("Käynnissä");
  });
  it("numbers a step", () => {
    expect(html(req({ status: "ok", steps: [{ n: 2, m: 4, text: "Rakennus" }] }))).toContain('Vaihe 2/4:</span> <span>Rakennus</span>');
  });
  it("shows a finished step's own duration after its text, and the running step's clock", () => {
    const steps = [{ n: 1, m: 3, text: "Tarkistetaan", at: 0 }, { n: 2, m: 3, text: "Haetaan", at: 12 }];
    const out = html(req({ status: "running", startedAt: ago(40_000), steps }));
    expect(out).toContain('<span>Tarkistetaan</span><span class="muted"> 12 s</span>');
    expect(out).toContain('<span>Haetaan</span><span class="muted"> 28 s</span>');
  });
  it("shows the last step of a finished request up to its end, and none where the host gave no seconds", () => {
    const steps = [{ n: 1, m: 2, text: "Yksi", at: 0 }, { n: 2, m: 2, text: "Kaksi", at: 20 }];
    const done = html(req({ status: "ok", startedAt: ago(100_000), finishedAt: ago(50_000), summary: "Valmis.", steps }));
    expect(done).toContain('<span>Yksi</span><span class="muted"> 20 s</span>');
    expect(done).toContain('<span>Kaksi</span><span class="muted"> 30 s</span>');
    // a closing step that took under a second shows no duration, and a step without `at` none
    const quick = html(req({ status: "ok", startedAt: ago(100_000), finishedAt: ago(79_500), summary: "Valmis.", steps }));
    expect(quick).not.toContain("<span>Kaksi</span><span");
    const plain = html(req({ status: "running", startedAt: ago(40_000), steps: [{ n: 1, m: 2, text: "Yksi" }, { n: 2, m: 2, text: "Kaksi" }] }));
    expect(plain).toContain("<span>Yksi</span></li>");
    expect(plain).toContain("<span>Kaksi</span></li>");
  });
});

describe("the wait after a failed poll", () => {
  const st = (active: boolean) => ({ active }) as OpsState;
  it("is short while a request is live", () => {
    expect([1, 2, 3].map((n) => failWait(restartWait, st(true), n))).toEqual([2000, 2000, 2000]);
    expect(failWait(restartWait, st(true), 4)).toBe(5000);
  });
  it("still grows to a minute when nothing is live", () => {
    expect(failWait(restartWait, st(false), 1)).toBeCloseTo(4800);
    expect(failWait(restartWait, null, 20)).toBe(60_000);
  });
});
