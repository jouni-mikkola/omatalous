import { useApi } from "./hooks.ts";
import { queryClient } from "./query-client.ts";
import { t } from "./text.ts";

/** How many questions are open: the one number the shell reads on every page. The queue itself (`/api/review`) is read by Tarkistettavat alone. */
export const REVIEW_COUNT_PATH = "/api/review/count";

interface Counted {
  count: number;
}

/**
 * The count for the mark in the header, and a way to ask again. `known` is false until the server has answered, and while
 * its answer has failed with none before it: the count is then 0 as a placeholder, which is not an answer that nothing is open.
 */
export function useReviewCount(): { count: number; known: boolean; reload: () => void } {
  const { data, reload } = useApi<Counted>(REVIEW_COUNT_PATH, true);
  return { count: data?.count ?? 0, known: data !== null, reload };
}

/**
 * The questions still open on Tarkistettavat, written over the count: the mark, the tab title, the heading and the
 * queue then say the same number from the moment an answer is given, before the queue is read again.
 */
export function publishReviewCount(count: number): void {
  queryClient.setQueryData<Counted>([REVIEW_COUNT_PATH], { count });
}

/** How the count reads wherever it is shown, as words: the mark in the header, the title of the tab and the page's heading. */
export const openWord = () => t("nav.review_open");
const openText = (count: number) => `${count} ${openWord()}`;

/** The name of Tarkistettavat with the one count after it; with nothing open, the name alone. */
export const reviewTitle = (label: string, count: number) => (count > 0 ? `${label}: ${openText(count)}` : label);
