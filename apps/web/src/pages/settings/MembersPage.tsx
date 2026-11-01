/** Asetukset > Jäsenet, for the administrator: who is in the household, with a login or without. */
import { CardStack } from "./CardStack.tsx";
import { Members } from "./Members.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function MembersPage({ meta, params, anchor, onChange }: SettingsPageProps) {
  const isAdmin = meta.user.role === "admin";
  const { shown, partLoaded } = useCardsShown({ expected: isAdmin ? 1 : 0 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return <CardStack shown={shown}>{isAdmin && <Members me={meta.user} meta={meta} onChange={onChange} onLoaded={partLoaded} />}</CardStack>;
}
