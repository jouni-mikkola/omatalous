import type { RefCallback } from "react";

/** CSS properties by their CSS names (`inline-size`, `--from`). An undefined value removes the property. */
export type Css = Record<string, string | number | undefined>;

/**
 * A ref that sets a computed value (a bar's width, a series colour) through the element's CSSOM. The style-src of the
 * response has no 'unsafe-inline', which blocks a style attribute in the HTML but not `element.style.setProperty`.
 * A number is a length in px unless the name is a custom property (`--n`) or `flex-grow`; write other units as text.
 */
export function css(props: Css): RefCallback<HTMLElement | SVGElement> {
  return (el) => {
    if (!el) return;
    for (const [name, value] of Object.entries(props)) {
      if (value === undefined) el.style.removeProperty(name);
      else el.style.setProperty(name, typeof value === "number" && !name.startsWith("--") && name !== "flex-grow" ? `${value}px` : String(value));
    }
  };
}
