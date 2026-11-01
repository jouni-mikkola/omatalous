import type { ComponentProps } from "react";
import { cx } from "./cx.ts";

/** primary: the one main action of a page or dialog. secondary: any other action in sight. link: a row's action or a move to another page. */
export type ButtonVariant = "primary" | "secondary" | "link";

interface Own {
  variant?: ButtonVariant;
  /** The action destroys something; only a confirmation dialog shows it. */
  danger?: boolean;
  /** Its request is on the way: disabled, and told to a screen reader (aria-busy). */
  busy?: boolean;
}
type AsButton = Own & ComponentProps<"button"> & { href?: undefined };
type AsLink = Own & ComponentProps<"a"> & { href: string };

/** The one button: a `<button>`, or an `<a>` when it has an `href`. A `<button>` is type="button" unless it says it submits. */
export function Button(props: AsButton | AsLink) {
  const { variant = "secondary", danger, busy, className, ...rest } = props;
  const cls = cx("btn", variant === "primary" && "btn-primary", variant === "link" && "btn-link", className);
  const tone = danger ? "danger" : undefined;
  if (rest.href !== undefined) return <a className={cls} data-tone={tone} {...(rest as AsLink)} />;
  const { disabled, type = "button", ...button } = rest as ComponentProps<"button">;
  return <button className={cls} data-tone={tone} type={type} disabled={disabled || busy} aria-busy={busy || undefined} {...button} />;
}
