import type { Connector } from "../types.ts";

/** Nothing imports or fetches any more. The entry stays because the fold of an old CSV account into a linked bank account reads its id (fold-accounts.ts), and installed databases store that id. */
export const csvImport: Connector = {
  id: "csv",
};
