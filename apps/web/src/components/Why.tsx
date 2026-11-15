import type { ReactNode } from "react";
import { Estimate } from "./Estimate.tsx";

/**
 * What add-on modules built against host API 1 import from `components/Why` (module-host.ts,
 * contracts/1.5.0/module-host.json): the two marks of an estimate and the door of a figure. The door is only the figure
 * now: it has no toggle and no panel, so `label`, `open`, `onToggle`, `controls` and `className` are not used.
 */
export { approxText, Estimate } from "./Estimate.tsx";

export function BasisDoor({ text, estimate = false, children }: { label?: string; text: string; estimate?: boolean; open?: boolean; onToggle?: () => void; controls?: string; className?: string; children?: ReactNode }) {
  return <Estimate when={estimate}>{children ?? text}</Estimate>;
}
