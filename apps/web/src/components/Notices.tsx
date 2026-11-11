import { useState } from "react";
import { api } from "../api.ts";
import { useApi } from "../hooks.ts";
import { t } from "../text.ts";
import { dismissPath, type SecurityNotice, securityRows } from "./notices.ts";
import "../styles/notices.css";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";

/**
 * The notices of the server at the top of Yhteenveto (a sign-in from a new device, copies, disk, the helper): one line
 * each, the text a link to where it is mended. The Kuittaa of a row reads that notice alone; with two or more rows one
 * Kuittaa kaikki under the list reads them all. The notice that stops the user on every page stays the banner of the
 * shell. With nothing to say there is nothing to draw. A failed Kuittaa shows the server's sentence under the list and
 * the rows stay.
 */
export function ServerNotices() {
  const security = useApi<{ notices: SecurityNotice[] }>("/api/security/notices");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = securityRows(security.data?.notices ?? []);
  if (!rows.length) return null;
  const read = (id?: string) => {
    setReading(true);
    setError(null);
    api(dismissPath(id), { method: "POST" })
      .then(() => security.reload())
      .catch((e: Error) => setError(e.message))
      .finally(() => setReading(false));
  };
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
            <div className="notice-actions">
              <Button variant="secondary" disabled={reading} aria-busy={reading || undefined} aria-label={t("notice.read_title", { title: n.title })} onClick={() => read(n.id)}>
                {t("notice.read")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > 1 && (
        <div className="notice-all">
          <Button variant="secondary" disabled={reading} aria-busy={reading || undefined} onClick={() => read()}>
            {t("notice.read_all")}
          </Button>
        </div>
      )}
      {error && (
        <Notice tone="error" className="notice-error" as="p">
          {error}
        </Notice>
      )}
    </section>
  );
}
