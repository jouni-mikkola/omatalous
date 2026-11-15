/** Asetukset > Tiedot: the data itself, its export and import, and the example data. */
import { Notice } from "../../components/ui/Notice.tsx";
import { CardStack } from "./CardStack.tsx";
import { DataExport } from "./DataExport.tsx";
import { ExampleData } from "./ExampleData.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown, useRunner } from "./use-settings-page.ts";

export function DataPage({ meta, params, anchor, onChange }: SettingsPageProps) {
  const { busy, message, run } = useRunner(onChange);
  const { shown } = useCardsShown({ expected: 0 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return (
    <div className="stack">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <CardStack shown={shown}>
        <DataExport />
        <ExampleData meta={meta} busy={busy} run={run} />
      </CardStack>
    </div>
  );
}
