import { define } from "../../../src/features/contract.ts";

/** A section module as a feature will write one: its `id` is a literal and `build` has its own return type. */
export const module = define({
  kind: "section",
  id: "price-rises",
  order: 10,
  reads: ["range"],
  decision: "cancel a contract that got dearer",
  build: () => ({ cents: 1250 }),
});
