/** The mark of an estimate where the figure is plain text (a datum, a cell, a sentence a screen reader reads): "≈ 12,40 €". Apart from Why.tsx so a chart can use it without loading the table. */
export const approxText = (text: string, estimated: boolean): string => (estimated ? `≈ ${text}` : text);
