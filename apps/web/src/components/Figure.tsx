const SPLIT = /^([+−-]?[\d\s  ]*\d)(,\d+)?(.*)$/s;

/**
 * A sum as a reader sees it: the sign and whole part at full size, the decimals and the unit smaller and quieter.
 * Takes the string `money()` or `percent()` already gives and changes no character; a text that is no number (a
 * dash for a missing value) passes through whole.
 */
export function Figure({ text, size }: { text: string; size: "s" | "m" | "l" }) {
  const m = SPLIT.exec(text);
  if (!m) return <span key={text} className={`fig fig-${size}`}>{text}</span>;
  return (
    <span key={text} className={`fig fig-${size}`}>
      <span className="fig-int">{m[1]}</span>
      {m[2] && <span className="fig-dec">{m[2]}</span>}
      {m[3] && <span className="fig-unit">{m[3]}</span>}
    </span>
  );
}
