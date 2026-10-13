import type { Ahead } from "../src/components/next-days.ts";

type Pay = NonNullable<Ahead["rows"][number]["pay"]>;

/** The estimate of a pay that came the same every month: twelve pays of `cents`. */
export const steady = (cents: number): Pay => ({ count: 12, lowCents: cents, highCents: cents, usualCents: cents, floorCents: cents, ceilCents: cents, kind: "steady", baseCents: cents });

/** The estimate of a commission pay: 1 950 to 3 240 euros over twelve pays, the usual 2 480, at least 2 100 and at most 2 900 to be expected. */
export const varies = (over: Partial<Pay> = {}): Pay => ({ count: 12, lowCents: 195_000, highCents: 324_000, usualCents: 248_000, floorCents: 210_000, ceilCents: 290_000, kind: "varies", ...over });
