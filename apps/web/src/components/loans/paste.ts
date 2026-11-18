export const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
export const isText = (file: File) => file.type.startsWith("text/") || /\.(txt|csv)$/i.test(file.name);

/** What a paste brings in: a file to read, or the text of the loan. */
export type Pasted = { file: File } | { text: string };

/**
 * What to read from a clipboard. A PDF is read as a file. Text is the loan's text. A file copied in a file manager
 * brings its own name as the text, which is not the loan, so a text that is only a file's name does not count.
 */
export function whatWasPasted(files: readonly File[], plain: string): Pasted | null {
  const pdf = files.find(isPdf);
  if (pdf) return { file: pdf };
  const text = plain.trim();
  if (text !== "" && !files.some((f) => f.name === text)) return { text: plain };
  return null;
}
