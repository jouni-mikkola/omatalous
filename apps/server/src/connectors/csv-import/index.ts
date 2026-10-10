import type { Connector } from "../types.ts";

/** Files the user uploads. Nothing is fetched, so there is no `sync`. */
export const csvImport: Connector = {
  id: "csv",
  label: "CSV",
  kind: "file",
};
