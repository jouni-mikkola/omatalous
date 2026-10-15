import type { ReactNode } from "react";

/** A payee of a bill that is paid and not booked yet: the word Tapahtumat gives such a row stands after the name, which is cut first on a narrow screen. */
export function PendingPayee({ children }: { children: ReactNode }) {
  return (
    <div className="payee-pending">
      <span>{children}</span>
      <span className="badge warn">varaus</span>
    </div>
  );
}
