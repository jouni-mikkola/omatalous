/**
 * The questions of Raportit, in the order of the list. The id is in the address (`?q=menot`). Kept apart from the
 * registry (index.ts) so the page's address code, which loads with the app, does not pull in every report.
 */
export const QUESTIONS = ["kuukausi", "menot", "tulot", "kiinteat", "velat", "saldot", "yhteiset"] as const;
export type QuestionId = (typeof QUESTIONS)[number];
