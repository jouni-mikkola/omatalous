/** The English table of set-dpage; the Finnish one it must match is in ../messages-set-dpage.ts. */
import type { FI_SET_DPAGE } from "../messages-set-dpage.ts";

export const EN_SET_DPAGE: Record<keyof typeof FI_SET_DPAGE, string> = {
  "set.dpage.example_data": "Example data",
  "set.dpage.reload": "Reload",
  "set.dpage.load_example_data": "Load example data",
  "set.dpage.remove_example_data": "Remove example data",
  "set.dpage.remove_the_example_data": "Remove the example data?",
  "set.dpage.the_example_accounts_and_their": "The example accounts and their transactions are removed. Your own data is not touched.",
  "set.dpage.example_data_loaded": "Example data loaded.",
  "set.dpage.example_data_removed": "Example data removed.",
};
