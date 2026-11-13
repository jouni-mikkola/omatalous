import { api } from "../api.ts";
import { useApi } from "../hooks.ts";
import { queryClient } from "../query-client.ts";
import { SETTINGS_ANCHOR } from "../routes.ts";
import { t } from "../text.ts";
import { newsCount, noticeRows, type SecurityNotice } from "./notices.ts";
import "../styles/notices.css";

const NOTICES = "/api/security/notices";

/** The user has read the notices of the events so far: the security log says it on opening, and the dot goes. */
export async function markNoticesSeen(): Promise<void> {
  await api(`${NOTICES}/seen`, { method: "POST", quiet: true }).catch(() => undefined);
  await queryClient.invalidateQueries({ queryKey: [NOTICES], exact: true });
}

/** How many notices are news to the user: the dot on the user menu. */
export function useNoticeNews(): number {
  const { data } = useApi<{ notices: SecurityNotice[] }>(NOTICES);
  return newsCount(data?.notices ?? []);
}

/**
 * The notices of the server on Asetukset > Turvallisuus, one line each (`noticeRows`): a state leads where it is mended,
 * an event is read in the log under it. No page shows them elsewhere; the user menu has a dot while one is news. With
 * nothing to say there is nothing to draw.
 */
export function NoticeList() {
  const { data } = useApi<{ notices: SecurityNotice[] }>(NOTICES);
  const rows = noticeRows(data?.notices ?? []);
  if (!rows.length) return null;
  return (
    <section className="card notice-list" id={SETTINGS_ANCHOR.notices} aria-labelledby="notice-list-h">
      <h2 id="notice-list-h">{t("notice.list_title")}</h2>
      <ul>
        {rows.map((row) => (
          <li key={row.id} className={row.news ? "notice-news" : undefined}>
            {row.href ? <a href={row.href}>{row.title}</a> : row.title}
          </li>
        ))}
      </ul>
    </section>
  );
}
