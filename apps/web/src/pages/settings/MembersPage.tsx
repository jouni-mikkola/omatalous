/** Asetukset > Jäsenet (admin): the household's members and their accounts. */
import { CardStack } from "./CardStack.tsx";
import { Members } from "./Members.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function MembersPage({ meta, params, anchor, onChange }: SettingsPageProps) {
  const { shown, partLoaded } = useCardsShown({ expected: 1 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return (
    <CardStack shown={shown}>
      <Members me={meta.user} meta={meta} onChange={onChange} onLoaded={partLoaded} />
    </CardStack>
  );
}
