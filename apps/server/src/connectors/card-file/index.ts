import type { Connector } from "../types.ts";

/** Rows the household read from a card statement file in its browser (ADR 0025). Nothing is fetched: the rows arrive through services/card-file.ts. */
export const cardFile: Connector = {
  id: "cardfile",
};
