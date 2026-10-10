import type { ImportParser } from "../types.ts";
import { findHeader, parseBankCsv } from "./parser.ts";

export const nordeaCsv: ImportParser = {
  id: "nordea-csv",
  label: "Nordea, CSV",
  accepts: { extensions: [".csv", ".txt"], mime: ["text/csv", "text/plain"] },
  // a header row with a date and an amount column in a known language is all the parser needs
  sniff: (head) => (findHeader(head.replace(/^\uFEFF/, "")) === null ? 0 : 1),
  parse: parseBankCsv,
};
