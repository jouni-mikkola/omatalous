import { useApi } from "../hooks.ts";
import { Review } from "../pages/Review.tsx";
import type { ReviewAnswer } from "../pages/review-items.ts";
import { useShell } from "../shell-context.ts";

/** The one page that reads the whole queue; the header reads only its length (`/api/review/count`). */
export function ReviewView() {
  const { meta } = useShell();
  const queue = useApi<ReviewAnswer>("/api/review", true);
  return <Review meta={meta} queue={queue} />;
}
