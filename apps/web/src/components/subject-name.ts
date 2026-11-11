/** What the input form and Tarkistettavat share: the name of a series and the call after a save. */
import { seriesName } from "../format.ts";

/** Called after something was saved; the page fetches again and says what happened. */
export type Changed = (message: string) => void;

/** The name of a recurring series id (`out:<account>:<merchant>#1299`), as every page says it; any other subject is returned as it is. */
export function subjectName(subject: string): string {
  return seriesName(subject) ?? subject;
}
