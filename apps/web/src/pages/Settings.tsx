import { api } from "../api.ts";
import { plural } from "../format.ts";
import { onTechnicalPage, SETTINGS_ANCHOR } from "../routes.ts";
import type { Meta } from "../types.ts";
import { About } from "./settings/About.tsx";
import { Accounts } from "./settings/Accounts.tsx";
import { BankConnections, connectedMessage, connectError } from "./settings/BankConnections.tsx";
import { Loans } from "./settings/Loans.tsx";
import { Members } from "./settings/Members.tsx";
import { Password } from "./settings/Security.tsx";
import { Sharing } from "./settings/Sharing.tsx";
import { Technical } from "./settings/Technical.tsx";
import { useCardScroll, useLoadedCount, useRunner } from "./settings/use-settings-page.ts";
import "../styles/settings.css";

interface PageProps {
  meta: Meta;
  params: URLSearchParams;
  anchor?: string;
  onChange: () => void;
}

/**
 * Asetukset is two pages. The plain one is what a household sets: bank connections, accounts, the members (admin), how
 * accounts are shared, loans and the password, then the way to the technical page. The technical page is
 * `?section=technical`; `?section=server` and `?section=maintenance` open it at their card. `?add=1` opens the plain page
 * at the bank picker, and an address anchor (`#lainat`) scrolls to its card. `?section=csv` of the removed import opens
 * the plain page and scrolls nowhere.
 */
export function Settings(props: PageProps) {
  return onTechnicalPage(props.params) ? <Technical {...props} /> : <Plain {...props} />;
}

function Plain({ meta, params, anchor, onChange }: PageProps) {
  const isAdmin = meta.user.role === "admin";
  const { busy, message, setMessage, run } = useRunner(onChange, () => {
    const connected = params.get("connected");
    if (connected !== null && /^\d+$/.test(connected)) return connectedMessage(Number(connected));
    const error = params.get("error");
    return error ? { tone: "warning", text: connectError(error) } : null;
  });

  // an address names a card (#lainat, #salasana): scroll to it once, after the cards above it that load their own data
  const [loaded, partLoaded] = useLoadedCount();
  useCardScroll(anchor, `${params.toString()}#${anchor}`, loaded >= (isAdmin ? 2 : 1));

  return (
    <div className="stack">
      {message && <div className={`notice ${message.tone}`}>{message.text}</div>}

      <BankConnections
        meta={meta}
        pickerOpen={params.get("add") === "1"}
        onChange={onChange}
        onMessage={setMessage}
        sync={{
          busy: busy === "sync",
          disabled: busy !== null,
          start: () =>
            void run("sync", async () => {
              const r = await api<{ status: string; inserted: number; messages: string[] }>("/api/sync", { method: "POST" });
              return [`${plural(r.inserted, "uusi tapahtuma", "uutta tapahtumaa")}.`, ...r.messages].join(" ");
            }),
        }}
      />

      <Accounts meta={meta} onChange={onChange} />

      {isAdmin && <Members me={meta.user} onChange={onChange} onLoaded={partLoaded} />}

      <Sharing meta={meta} onChange={onChange} />

      <Loans meta={meta} onLoaded={partLoaded} />

      <Password openPassword={anchor === SETTINGS_ANCHOR.password} />

      <div className="card half">
        <div className="card-head">
          <div>
            <h2>Tekniset asetukset</h2>
          </div>
          <a className="btn" href="#/settings?section=technical">
            Avaa
          </a>
        </div>
      </div>

      <About version={meta.version.app} />
    </div>
  );
}
