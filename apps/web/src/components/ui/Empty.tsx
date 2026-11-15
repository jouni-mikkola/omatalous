import type { ReactNode, Ref } from "react";
import { Card } from "./Card.tsx";
import { cx } from "./cx.ts";

/**
 * Nothing to show: one sentence and, when there is a way on, one action. With a `title` it is a card of its own, the
 * title the page's heading (the page gives it focus through `headingRef`) and the children its paragraphs; without a
 * title it is a line inside a card.
 */
export function Empty({ title, mark, children, action, headingRef, className, id }: {
  title?: string;
  /** A sign drawn above the title. */
  mark?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  className?: string;
  id?: string;
}) {
  if (title === undefined) {
    return (
      <div className={cx("empty", className)} id={id}>
        {children}
        {action !== undefined && <div className="form-row">{action}</div>}
      </div>
    );
  }
  return (
    <Card className={cx("empty", className)} id={id} heading={title} headingRef={headingRef}>
      {mark}
      {children}
      {action !== undefined && <div className="form-row">{action}</div>}
    </Card>
  );
}
