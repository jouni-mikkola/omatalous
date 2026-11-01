/** The English table of views; the Finnish one it must match is in ../messages-views.ts. */
import type { FI_VIEWS } from "../messages-views.ts";

export const EN_VIEWS: Record<keyof typeof FI_VIEWS, string> = {
  "views.title": "Unopened views",
  "views.sub": "Reports, observations and tips that no household member has opened in {days} days. The opening days stay on this install and nothing is sent anywhere.",
  "views.caption": "Unopened views",
  "views.col_view": "View",
  "views.col_kind": "Kind",
  "views.col_last": "Last opened",
  "views.kind_report": "Report",
  "views.kind_insight": "Observation",
  "views.kind_finding": "Saving tip",
  "views.never": "not once while tracking",
  "views.none": "Every tracked view was opened in the last {days} days.",
  "views.young": "Tracking began on {date}. The list appears when it has run for {days} days.",
  "views.not_started": "Tracking begins when the first view is opened.",
};
