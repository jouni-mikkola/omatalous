// Decision: none of its own, the names of the question pages and of the comparisons they offer

/** The questions of Raportit, in the order of the list. The id is in the address (`?q=menot`). */
export const QUESTIONS = ["kuukausi", "menot", "tulot", "kiinteat", "velat", "saldot", "yhteiset"] as const;
export type QuestionId = (typeof QUESTIONS)[number];

/** What a figure is set beside: the expected level, the period right before, the same period a year ago, the household's budget. */
export const COMPARE_KINDS = ["expected", "previous", "yearAgo", "budget"] as const;
export type CompareKind = (typeof COMPARE_KINDS)[number];
