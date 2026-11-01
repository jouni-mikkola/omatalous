import { Settings } from "../pages/Settings.tsx";
import { useShell } from "../shell-context.ts";

export function SettingsView() {
  const { meta } = useShell();
  return <Settings meta={meta} />;
}
