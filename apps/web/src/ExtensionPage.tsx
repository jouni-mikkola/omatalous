import { useParams } from "@tanstack/react-router";
import { ExtensionView } from "./views/ExtensionView.tsx";

/** A page the router has no route of its own for: an add-on module's, which the shell lets through when the module added it. */
export function ExtensionPage() {
  const { page } = useParams({ from: "/$page" });
  return <ExtensionView id={page} />;
}
