import type { ReactNode } from "react";
import { Estimate } from "./Estimate.tsx";

/**
 * What add-on modules built against host API 1 import from `components/Why` (module-host.ts,
 * contracts/1.5.0/module-host.json): the two marks of an estimate and the door of a figure. The door is only the figure
 * now: it has no toggle and no panel, so `label`, `open`, `onToggle` and `controls` are not used. `className` goes on a
 * wrapper, so the figure classes an add-on styles (`why-fig`) stay on the page.
 */
export { approxText, Estimate } from "./Estimate.tsx";

export function BasisDoor({ text, estimate = false, className, children }: { label?: string; text: string; estimate?: boolean; open?: boolean; onToggle?: () => void; controls?: string; className?: string; children?: ReactNode }) {
  const figure = <Estimate when={estimate}>{children ?? text}</Estimate>;
  return className ? <span className={className}>{figure}</span> : figure;
}
