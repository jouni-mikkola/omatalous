import { api } from "../api.ts";
import { useApi } from "../hooks.ts";
import { queryClient } from "../query-client.ts";
import { t } from "../text.ts";
import { noticeLine, type SecurityNotice } from "./notices.ts";
import "../styles/notices.css";

const NOTICES = "/api/security/notices";

/** The user has read the notices of the events so far: the line of Yhteenveto and the security log both say it. */
export async function markNoticesSeen(): Promise<void> {
  await api(`${NOTICES}/seen`, { method: "POST", quiet: true }).catch(() => undefined);
  await queryClient.invalidateQueries({ queryKey: [NOTICES], exact: true });
}

/**
 * The notices of the server on Yhteenveto: one line at most (`noticeLine`), its text a link to where it is read or
 * mended. Opening a line of events marks them seen, so the line goes; a state's line stays until the server stops
 * sending it. The notice that stops the user on every page stays the banner of the shell. With nothing to say there is
 * nothing to draw.
 */
export function NoticeLine() {
  const security = useApi<{ notices: SecurityNotice[] }>(NOTICES);
  const line = noticeLine(security.data?.notices ?? []);
  if (!line) return null;
  return (
    <p className="home-notice">
      <a className="notice-text" href={line.href} onClick={line.events ? () => void markNoticesSeen() : undefined}>
        <span className="sr-only">{t("notice.alert")}</span>
        <span className="notice-title">{line.title}</span>
      </a>
    </p>
  );
}
