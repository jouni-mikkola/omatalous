// What the stylesheet tests share: the rules of a sheet, and the WCAG contrast of two `#rrggbb` colours.

/** Every rule with a body, innermost first, as its selector and its declarations (an `@media` wrapper is not a rule). */
export function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]!.trim() });
  }
  return out;
}

const channel = (c: string, i: number): number => {
  const v = parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
/** The three channels of a `#rrggbb` colour in linear light. */
export const linearOf = (c: string): [number, number, number] => [channel(c, 0), channel(c, 1), channel(c, 2)];
/** The relative luminance of a `#rrggbb` colour (WCAG). */
export const luminanceOf = (c: string): number => {
  const [r, g, b] = linearOf(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** The contrast of two `#rrggbb` colours (WCAG), 1 to 21. */
export const ratioOf = (a: string, b: string): number => {
  const [hi = 0, lo = 0] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
