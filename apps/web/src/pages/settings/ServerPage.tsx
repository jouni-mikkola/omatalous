/** Asetukset > Palvelin ja ylläpito (admin): the status line, the server, remote access, the maintenance and the add-on. */
import { AddOn } from "./AddOn.tsx";
import { CardStack } from "./CardStack.tsx";
import { Maintenance, useOpsState } from "./Maintenance.tsx";
import { useRemoteAccessPoll } from "./RemoteAccess.tsx";
import { ServerSettings } from "./Server.tsx";
import { ServerStatusLine } from "./ServerStatusLine.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function ServerPage({ params, anchor, onChange }: SettingsPageProps) {
  const { shown, partLoaded } = useCardsShown({ expected: 1 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  // both polls live here: the status line at the top and the cards below read the same answers
  const ops = useOpsState();
  const remote = useRemoteAccessPoll();
  return (
    <CardStack shown={shown}>
      <ServerStatusLine ops={ops.data} remote={remote} />
      <ServerSettings remote={remote} onChange={onChange} onLoaded={partLoaded} />
      <Maintenance ops={ops} />
      <AddOn />
    </CardStack>
  );
}
