/** The English table of set-dx; the Finnish one it must match is in ../messages-set-dx.ts. */
import type { FI_SET_DX } from "../messages-set-dx.ts";

export const EN_SET_DX: Record<keyof typeof FI_SET_DX, string> = {
  "set.dx.data": "Data",
  "set.dx.export_all_data": "Export all data",
  "set.dx.the_file_holds_your_own": "The file holds your own data and the data shared with you. Keep it safe.",
};
