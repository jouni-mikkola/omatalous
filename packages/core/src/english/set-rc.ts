/** The English table of set-rc; the Finnish one it must match is in ../messages-set-rc.ts. */
import type { FI_SET_RC } from "../messages-set-rc.ts";

export const EN_SET_RC: Record<keyof typeof FI_SET_RC, string> = {
  "set.rc.suggestion": "Suggestion",
  "set.rc.in_use": "In use",
  "set.rc.ended": "Ended",
  "set.rc.add_a_home_loan": "Add a home loan",
  "set.rc.no_home_loan": "No home loan",
  "set.rc.other_category": "Other category…",
  "set.rc.choose_a_category": "Choose a category",
  "set.rc.cancel": "Cancel",
  "set.rc.search_categories": "Search categories",
  "set.rc.no_category_matches_the_search": "No category matches the search.",
  "set.rc.payments_left": "Payments left",
  "set.rc.save": "Save",
  "set.rc.last_month": "Last month",
  "set.rc.save_month": "Save month",
  "set.rc.i_don_t_know": "I don't know",
  "set.rc.not_a_loan": "Not a loan",
  "set.rc.why": "Why we suggest this: {why}.",
};
