import { ExtensionBoundary } from "../components/ExtensionBoundary.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { WEB_EXTENSIONS } from "../extensions.ts";
import { useShell } from "../shell-context.ts";
import { t } from "../text.ts";

/** The page of an add-on module at `/<id>`; the shell has already checked that the module added it. */
export function ExtensionView({ id }: { id: string }) {
  const { params } = useShell();
  const own = WEB_EXTENSIONS.find((e) => e.id === id)?.page;
  return own ? (
    <ExtensionBoundary fallback={<ErrorCard message={t("app.error")} onRetry={() => window.location.reload()} />}>
      <own.component params={params} />
    </ExtensionBoundary>
  ) : null;
}
