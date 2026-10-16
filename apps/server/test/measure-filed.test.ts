import { describe, expect, it, vi } from "vitest";
import type { FiledWithoutAsking } from "../../../packages/core/src/analysis/filed.ts";
import { KIT_TODAY } from "../../../packages/core/test/kit/index.ts";
import { setupApp } from "./helpers.ts";
import { loadKit } from "./kit-load.ts";

/**
 * Prints the share of 12 months' spending that the app files without asking, for the demo and for the test kit's
 * household, so a release can record it: `pnpm vitest run apps/server/test/measure-filed.test.ts` and read the lines.
 * Both are read as Tietojen laatu reads them (`/api/reports`, own and household view).
 * The floor the test holds is far under the 90 % the app aims at: it catches a household that falls apart, not a drift.
 */
const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
const line = (name: string, f: FiledWithoutAsking) =>
  `filed without asking, ${name}: ${pct(f.share)} (guesses ${pct(f.guessShare)}, own answers ${pct(f.userShare)}, ${f.cents / 100} of ${f.totalCents / 100} EUR)`;

const HOUSEHOLDS = [
  { name: "demo", day: "2026-10-09", load: async (app: Awaited<ReturnType<typeof setupApp>>) => void expect((await app.admin.call("POST", "/api/demo")).status).toBe(200) },
  { name: "kit household", day: KIT_TODAY, load: loadKit },
] as const;

describe("the share of spending filed without asking", () => {
  for (const h of HOUSEHOLDS) {
    it(`${h.name}: both views, printed`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${h.day}T10:00:00Z`));
      try {
        const app = await setupApp({}, undefined, { now: () => new Date(`${h.day}T10:00:00Z`) });
        await h.load(app);
        for (const scope of ["own", "household"]) {
          const res = await app.app.request(`http://localhost:8080/api/reports?scope=${scope}`, { headers: { "X-Requested-With": "fetch", Cookie: app.admin.cookie } });
          const filed = ((await res.json()) as { dataQuality: { filed: FiledWithoutAsking | null } }).dataQuality.filed;
          expect(filed, scope).not.toBeNull();
          console.log(line(`${h.name} ${scope}`, filed!));
          expect(filed!.share, scope).toBeGreaterThan(0.5);
        }
      } finally {
        vi.useRealTimers();
      }
    });
  }
});
