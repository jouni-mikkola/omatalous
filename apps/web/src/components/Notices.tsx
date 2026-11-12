import { useApi } from "../hooks.ts";
import { t } from "../text.ts";
import { type SecurityNotice, securityRows } from "./notices.ts";
// the rows are the statement's: its sheet comes first, so the notice's own rules of the same weight win
import "../styles/statement.css";
import "../styles/notices.css";

/**
 * The notices of the server at the top of Yhteenveto (a sign-in from a new device, copies, disk, the helper): one line
 * each, the text a link to where it is mended. A row has no button: the server stops sending a notice when its cause
 * or its time has ended (the server's services/security.ts). The notice that stops the user on every page stays the
 * banner of the shell. With nothing to say there is nothing to draw.
 */
export function ServerNotices() {
  const security = useApi<{ notices: SecurityNotice[] }>("/api/security/notices");
  const rows = securityRows(security.data?.notices ?? []);
  if (!rows.length) return null;
  return (
    <section className="card home-server" aria-labelledby="server-notices-h">
      <h2 id="server-notices-h">{t("notice.heading")}</h2>
      <ul className="st-rows notice-list" aria-labelledby="server-notices-h">
        {rows.map((n) => (
          <li key={n.id} className="st-row notice-item warn">
            <a className="st-name notice-text" href={n.href} title={n.title}>
              <span className="sr-only">{t("notice.alert")}</span>
              <span className="notice-title">{n.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
