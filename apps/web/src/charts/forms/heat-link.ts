import { monthEnd } from "@banking/core";
import { query } from "../../api.ts";

/** The address of Tapahtumat for the rows behind one cell of the category grid: the category in that month. */
export function cellHref(category: string, month: string): string {
  return `#/transactions${query({ category, from: `${month}-01`, to: monthEnd(month) })}`;
}
