import { type HTMLAttributes, type ReactNode, type Ref, useId } from "react";
import { cx } from "./cx.ts";

/**
 * The one card: a white panel on the page. With a `title` it has a name on the left and at most one `action` on the
 * right; the body goes under them. `flush` is a card whose body is a table that runs to its edges. A card holds no
 * other card; groups inside it are told by a rule or a subheading.
 */
export function Card({ title, heading, headingRef, action, sub, flush, as: Tag = "section", className, children, ...rest }: {
  title?: ReactNode;
  /** A heading that stands alone in the card: the name of an empty page, which the page may focus. */
  heading?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  action?: ReactNode;
  sub?: ReactNode;
  flush?: boolean;
  as?: "section" | "div" | "article" | "li";
} & HTMLAttributes<HTMLElement>) {
  const titleId = useId();
  const named = title !== undefined;
  return (
    <Tag className={cx("card", flush && "flush", className)} aria-labelledby={named || heading !== undefined ? titleId : undefined} {...rest}>
      {named && (
        <div className="card-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {sub !== undefined && <div className="card-sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      {heading !== undefined && (
        <h2 id={titleId} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
          {heading}
        </h2>
      )}
      {children}
    </Tag>
  );
}
