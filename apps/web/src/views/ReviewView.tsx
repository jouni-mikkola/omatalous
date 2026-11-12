import { useApi } from "../hooks.ts";
import { FirstRun } from "../pages/FirstRun.tsx";
import { Review } from "../pages/Review.tsx";
import type { ReviewAnswer } from "../pages/review-items.ts";
import { useShell } from "../shell-context.ts";

/** The page of the whole queue (Yhteenveto shows its first rows); the header reads only its length (`/api/review/count`). */
export function ReviewView() {
  const { meta, noData, loadDemo, reloadMeta } = useShell();
  const queue = useApi<ReviewAnswer>(noData ? null : "/api/review", true);
  // with no account there is nothing to check: the page says what it will answer
  return noData ? <FirstRun view="review" onDemo={loadDemo} meta={meta} onReload={reloadMeta} /> : <Review meta={meta} queue={queue} />;
}
