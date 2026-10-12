const NUMBER = /\d{1,2}\.\d{1,2}\.(?:\d{4})?|[−-]?\d{1,3}(?:[   ]\d{3})+(?:,\d+)?|[−-]?\d+(?:,\d+)?/g;

/**
 * The numbers of a Finnish text as written: "1 234,56", "12", "12.3.2026", "−5". Group spaces become plain spaces.
 * Rule 5's test reads every number of a title from its calc lines with this.
 */
export function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((n) => n.replace(/[  ]/g, " ").replace(/^-/, "−"));
}
