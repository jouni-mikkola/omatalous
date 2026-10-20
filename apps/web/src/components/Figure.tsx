const SPLIT = /^([+−-]?[\d\s  ]*\d)(,\d+)?(.*)$/s;

/**
 * A sum as a reader sees it: the sign and whole part at full size, the decimals and the unit smaller and quieter.
 * Takes the string `money()` or `percent()` already gives and changes no character (`whole`: a number that is not money keeps its decimals at full size); a text that is no number (a
 * dash for a missing value) passes through whole.
 */
export function Figure({ text, size, whole = false }: { text: string; size: "s" | "m" | "l"; whole?: boolean }) {
  const m = SPLIT.exec(text);
  if (!m) return <span key={text} className={`fig fig-${size}`}>{text}</span>;
  // `whole`: the figure is no money, so what follows the comma is part of the number and not small print for cents
  return (
    <span key={text} className={`fig fig-${size}`}>
      <span className="fig-int">{whole ? m[1] + (m[2] ?? "") : m[1]}</span>
      {!whole && m[2] && <span className="fig-dec">{m[2]}</span>}
      {m[3] && <span className="fig-unit">{m[3]}</span>}
    </span>
  );
}
