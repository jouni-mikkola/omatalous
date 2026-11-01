import { useLookAgain, waitsForFirstFetch } from "../../first-fetch.ts";
import type { Meta } from "../../types.ts";
import { Card } from "../ui/Card.tsx";
import { t, tn } from "../../text.ts";

type FetchMeta = Pick<Meta, "connections" | "accounts">;

/** One line per active bank that has not answered yet: what it is still waiting for. */
export function fetchLines(meta: FetchMeta): { id: string; bank: string; text: string }[] {
  return meta.connections
    .filter((c) => c.state === "active")
    .flatMap((c) => {
      const own = meta.accounts.filter((a) => a.connectionId === c.id);
      if (own.length === 0) return [{ id: c.id, bank: c.institution, text: t("home.fetching_accounts") }];
      const left = own.filter((a) => !a.lastSyncedAt && !a.problem).length;
      return left > 0 ? [{ id: c.id, bank: c.institution, text: tn(left, "home.waiting_one", "home.waiting_many") }] : [];
    });
}

/**
 * Decision: whether to wait for the first fetch or to leave the figures for later. After a bank is linked the front page
 * says what is still being fetched, so zeros are not read as real data. Looks again until the fetch has answered.
 */
export function FirstFetch({ meta, onReload }: { meta: FetchMeta; onReload?: () => void }) {
  const waiting = waitsForFirstFetch(meta.connections, meta.accounts);
  useLookAgain(waiting && onReload !== undefined, () => onReload?.());
  if (!waiting) return null;
  return (
    <Card className="first-fetch" title={t("home.first_fetch")} role="status">
      <p>{t("home.first_fetch_text")}</p>
      <ul className="first-fetch-list">
        {fetchLines(meta).map((l) => (
          <li key={l.id}>
            {l.bank}: {l.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}
