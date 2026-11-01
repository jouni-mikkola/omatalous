import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx.ts";

/** A button that is a mark and no word (×, ⋯, a chevron); the label says what it does and is required. */
export function IconButton({ label, children, className, ...rest }: { label: string; children: ReactNode } & Omit<ComponentProps<"button">, "aria-label" | "children">) {
  return (
    <button type="button" className={cx("btn-icon", className)} aria-label={label} {...rest}>
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
