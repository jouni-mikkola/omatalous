/**
 * Decision: how far a card's picture leans toward the pointer, and when it does not. The picture turns up to 12 degrees
 * sideways and 10 up or down, and a band of light follows the pointer across it. It stays flat for a finger (a touch
 * has no place to lean toward and would tilt on every scroll) and for a person who asked the system for less motion.
 */

/** The turn of the picture in degrees about each axis, and where the pointer is across it, 0 to 100. */
type Tilt = { rx: number; ry: number; gx: number };

/** The media query of a person who asked the system for less motion. */
export const STILL_QUERY = "(prefers-reduced-motion: reduce)";

const tenth = (x: number) => Math.round(x * 10) / 10;
const unit = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The tilt for a pointer over `box`, or null when the picture stays flat: `still` is the reduced-motion setting, a touch
 * never tilts, and a box with no size has nowhere to lean toward. A pointer outside the box is read at its nearest edge.
 */
export function tiltAt(
  pointer: { pointerType: string; clientX: number; clientY: number },
  box: { left: number; top: number; width: number; height: number },
  still: boolean,
): Tilt | null {
  if (still || pointer.pointerType === "touch" || box.width <= 0 || box.height <= 0) return null;
  const x = unit((pointer.clientX - box.left) / box.width);
  const y = unit((pointer.clientY - box.top) / box.height);
  return { rx: tenth((x - 0.5) * 24), ry: tenth((0.5 - y) * 20), gx: tenth(x * 100) };
}
