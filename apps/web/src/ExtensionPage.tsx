import { useParams } from "@tanstack/react-router";
import { ExtensionView } from "./views/ExtensionView.tsx";

/** A page the router has no route of its own for: a module's, which the shell shows while its flag is on. */
export function ExtensionPage() {
  const { page } = useParams({ from: "/$page" });
  return <ExtensionView id={page} />;
}
