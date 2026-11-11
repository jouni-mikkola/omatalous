/**
 * Asetukset > Pankit ja tilit: the bank connections and the fetch, the accounts, the fetch runs, the bank app (the
 * household's Enable Banking application for an admin, or one's own), and the data itself: its export and import, and
 * the example data.
 */
import { api } from "../../api.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { tn } from "../../text.ts";
import { BankApp } from "./BankApp.tsx";
import { Accounts } from "./Accounts.tsx";
import { BankConnections, connectedMessage, connectError } from "./BankConnections.tsx";
import { CardStack } from "./CardStack.tsx";
import { DataExport } from "./DataExport.tsx";
import { ExampleData } from "./ExampleData.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { StatementFile } from "./StatementFile.tsx";
import { SyncRuns } from "./SyncRuns.tsx";
import { useCardScroll, useCardsShown, useRunner } from "./use-settings-page.ts";

export function BanksPage({ meta, params, anchor, onChange }: SettingsPageProps) {
  const { busy, message, setMessage, run } = useRunner(onChange, () => {
    const connected = params.get("connected");
    if (connected !== null && /^\d+$/.test(connected)) return connectedMessage(Number(connected));
    const error = params.get("error");
    return error ? { tone: "warning", text: connectError(error) } : null;
  });
  const admin = meta.user.role === "admin";
  const { shown, partLoaded } = useCardsShown({ expected: admin ? 2 : 1 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);

  return (
    <div className="stack">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <CardStack shown={shown}>
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
                return [`${tn(r.inserted, "set.banks.one_new_transaction", "set.banks.n_new_transactions")}.`, ...r.messages].join(" ");
              }),
          }}
        />
        {/* one place for the card, so saving the application does not mount it again */}
        <BankApp meta={meta} onChange={onChange} onLoaded={partLoaded} />
        <Accounts meta={meta} onChange={onChange} />
        <StatementFile meta={meta} onChange={onChange} />
        <SyncRuns meta={meta} onLoaded={partLoaded} />
        <DataExport />
        <ExampleData meta={meta} busy={busy} run={run} />
      </CardStack>
    </div>
  );
}
