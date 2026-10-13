import { define } from "../../../src/features/contract.ts";

export const module = define({
  kind: "section",
  id: "basket",
  order: 20,
  reads: ["range", "inputs"],
  uses: ["price-rises"],
  decision: "change what goes in the basket",
  build: ({ use }) => ({ names: ["milk"], rises: use<{ cents: number }>("price-rises").cents }),
});
