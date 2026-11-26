// Decision: what the page's figures come to, in one sentence
import type { ReactNode } from "react";
import "../../styles/reports.css";

/** The sentence a report page leads with: under the page's name, and nothing when the page has no sentence to say. */
export function Lead({ children }: { children?: ReactNode }) {
  return children ? <p className="q-lead">{children}</p> : null;
}
