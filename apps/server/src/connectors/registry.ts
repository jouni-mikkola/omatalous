/**
 * Every connector the app ships, by static import so the server bundle and its tests see exactly this list.
 * A folder in connectors/ that is not listed here fails apps/server/test/connectors.test.ts.
 */
import type { Services } from "../services/context.ts";
import { csvImport } from "./csv-import/index.ts";
import { enableBanking } from "./enable-banking/index.ts";
import type { Connector } from "./types.ts";

/** In the order of the folders. */
export const CONNECTORS: readonly Connector[] = [csvImport, enableBanking];

/** Ends every active consent of a user at every connector that has consents, for a member who is being removed. */
export async function revokeAllConnections(s: Services, userId: string): Promise<{ revoked: number; failed: number }> {
  const total = { revoked: 0, failed: 0 };
  for (const connector of CONNECTORS) {
    const r = await connector.revokeAll?.(s, userId);
    if (r) {
      total.revoked += r.revoked;
      total.failed += r.failed;
    }
  }
  return total;
}
