import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "./cx.ts";

/** warning: something needs a look. info: a fact. good: it is done. error: it failed. */
export type NoticeTone = "warning" | "info" | "good" | "error";

/**
 * The one notice: a ground and a shape tell the tone, the reason opens the text in bold and one action closes it. It
 * goes when its reason goes; there is no button to dismiss it.
 */
export function Notice({ tone = "info", title, action, children, className, as = "div", ...rest }: {
  tone?: NoticeTone;
  title?: ReactNode;
  action?: ReactNode;
  as?: "div" | "p" | "li" | "section";
  ref?: Ref<HTMLElement>;
} & HTMLAttributes<HTMLElement>) {
  // the tags share one set of attributes; the type of the element is the div's
  const Tag = as as "div";
  return (
    <Tag className={cx("notice", className)} data-tone={tone} role={tone === "error" ? "alert" : undefined} {...(rest as HTMLAttributes<HTMLDivElement>)}>
      {title !== undefined && <strong>{title} </strong>}
      {children}
      {action !== undefined && <span className="notice-action">{action}</span>}
    </Tag>
  );
}
