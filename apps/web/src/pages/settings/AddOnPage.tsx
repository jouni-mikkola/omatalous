/**
 * Asetukset > Lisäosa, offered while an add-on module is loaded (routes.ts `ADD_ON_TARGET`): the module's own cards
 * (extensions.ts `settingsCard`) and, for an admin, the add-on's code, version and state, so that whatever the module
 * asks of the household and what keeps it running are found under one name.
 */
import { WEB_EXTENSIONS } from "../../extensions.ts";
import { AddOn } from "./AddOn.tsx";
import { CardStack } from "./CardStack.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function AddOnPage({ meta, params, anchor }: SettingsPageProps) {
  // each card reads its own data and keeps its own placeholder
  const { shown } = useCardsShown({ expected: 0 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return (
    <CardStack shown={shown}>
      {WEB_EXTENSIONS.map((e) => e.settingsCard && <e.settingsCard key={e.id} />)}
      {meta.user.role === "admin" && <AddOn />}
    </CardStack>
  );
}
