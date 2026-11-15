import type { Meta } from "../../types.ts";

/** What every target of Asetukset is given: the signed-in household's meta, the address, and the way to read meta again after a change. */
export interface SettingsPageProps {
  meta: Meta;
  params: URLSearchParams;
  /** The card the address names (`#lainat`): the target scrolls to it once its cards have their data. */
  anchor?: string;
  onChange: () => void;
}
