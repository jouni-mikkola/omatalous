/**
 * Asetukset > Palvelin ja ylläpito (admin): the status line, the server, the maintenance, the software information
 * (the author's page and the link to support the development) and, while no add-on module is loaded, the add-on's code. A loaded module brings Asetukset > Lisäosa, and the code card is there.
 */
import { addOnTargetOffered } from "../../routes.ts";
import { AboutApp } from "./AboutApp.tsx";
import { AddOn } from "./AddOn.tsx";
import { CardStack } from "./CardStack.tsx";
import { Maintenance, useOpsState } from "./Maintenance.tsx";
import { ServerSettings } from "./Server.tsx";
import { ServerStatusLine } from "./ServerStatusLine.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function ServerPage({ params, anchor, onChange }: SettingsPageProps) {
  const { shown, partLoaded } = useCardsShown({ expected: 1 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  // the poll lives here: the status line at the top and the cards below read the same answer
  const ops = useOpsState();
  return (
    <CardStack shown={shown}>
      <ServerStatusLine ops={ops.data} />
      <ServerSettings onChange={onChange} onLoaded={partLoaded} />
      <Maintenance ops={ops} />
      {!addOnTargetOffered("admin") && <AddOn />}
      <AboutApp />
    </CardStack>
  );
}
