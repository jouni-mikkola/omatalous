import type { ReactNode } from "react";
import { keyStyle } from "./draw.ts";
import "../styles/charts.css";

/** Positioned inside a `.chart` container; flips to the left near the right edge. */
export function Tooltip({ x, y, containerWidth, children }: { x: number; y: number; containerWidth: number; children: ReactNode }) {
  const flip = x > containerWidth - 190;
  return (
    <div className="tooltip" role="status" style={{ top: y, ...(flip ? { right: containerWidth - x + 12 } : { left: x + 12 }) }}>
      {children}
    </div>
  );
}

export function TooltipRow({ color, dash, name, value }: { color?: string; dash?: string; name: string; value: string }) {
  return (
    <div className="tooltip-row">
      <span className="name">
        {color && <span className="line-key" style={keyStyle(color, dash)} />}
        {name}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
