import { WEB_EXTENSIONS } from "../extensions.ts";
import { useShell } from "../shell-context.ts";

/** The page of a module at `#/<id>`; the shell has already checked that its flag is on. */
export function ExtensionView({ id }: { id: string }) {
  const { params } = useShell();
  const own = WEB_EXTENSIONS.find((e) => e.id === id)?.page;
  return own ? <own.component params={params} /> : null;
}
