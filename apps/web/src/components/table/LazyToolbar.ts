import { type ComponentProps, type ComponentType, createElement, type ReactElement, Suspense, use } from "react";
import { settled } from "./settled.ts";
import type { Toolbar as Loaded } from "./Toolbar.tsx";

type Props = ComponentProps<typeof Loaded>;

/** The toolbar is react-aria, the heaviest part of a table, and a page whose tables have none (Yhteenveto) must not load it. */
let ready: ComponentType<Props> | null = null;
let loading: Promise<void> | null = null;
/** Fetches the toolbar's chunk; a test awaits it first (tools/lib/test-markup.ts) so a table draws its toolbar at once. */
export const loadToolbar = (): Promise<void> => (loading ??= settled(import("./Toolbar.tsx").then((m) => void (ready = m.Toolbar))));

function Waiting(props: Props): ReactElement {
  // called on every render: one that suspended must call use() again when it resumes, even with the chunk there
  use(loadToolbar());
  return createElement(ready!, props);
}

/** The toolbar once its chunk is there; the place it takes is held meanwhile, so the table does not jump. */
export function Toolbar(props: Props): ReactElement {
  return createElement(Suspense, { fallback: createElement("div", { className: "rt-toolbar-wait" }) }, createElement(Waiting, props));
}
