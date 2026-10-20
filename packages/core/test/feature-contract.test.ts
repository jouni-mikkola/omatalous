/**
 * The contract of a feature module survives a generated registry. `export { module as x }` and `import * as all` must
 * keep the literal `id` and `kind` of each module and what its `build` returns, or `SectionDataIn<R, "id">` would be a
 * union of everything. The type assertions are checked by `tsc` (pnpm typecheck); a module whose id widened to
 * `string` fails to compile here.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { type SectionDataIn, define } from "../src/features/contract.ts";
import * as all from "./fixtures/features/registry.ts";

describe("feature contract", () => {
  it("keeps the literal id and kind through define, the registry line and import * as", () => {
    expectTypeOf(all.price_rises.id).toEqualTypeOf<"price-rises">();
    expectTypeOf(all.basket.id).toEqualTypeOf<"basket">();
    expectTypeOf(all.basket.kind).toEqualTypeOf<"section">();
    expect([all.basket.id, all.price_rises.id]).toEqual(["basket", "price-rises"]);
  });

  it("reads the answer of a section by its id from the registry", () => {
    expectTypeOf<SectionDataIn<typeof all, "price-rises">>().toEqualTypeOf<{ cents: number }>();
    expectTypeOf<SectionDataIn<typeof all, "basket">>().toEqualTypeOf<{ names: string[]; rises: number }>();
    expectTypeOf<SectionDataIn<typeof all, "no-such-section">>().toBeNever();
  });

  it("refuses a module of the wrong shape and an unknown read", () => {
    // @ts-expect-error a section without `build` is not a module
    define({ kind: "section", id: "x", order: 1, reads: ["range"], decision: "d" });
    // @ts-expect-error "money" is not something an answer reads
    define({ kind: "insight", id: "x", order: 1, reads: ["money"], find: () => [] });
    expect(define({ kind: "insight", id: "x", order: 1, reads: [], find: () => [] }).id).toBe("x");
  });
});
