/**
 * The text of a picture as the reader gives it, tidied before the loan is looked for in it. Where a word's capital
 * leaves room beside it, the reader at times puts a space there ("L yhennystapa", "T asalyhennys"), and a label split
 * like that is not found. A lone F, L, P, T, V, W or Y before four or more small letters is joined to them. A and I
 * are left alone: they are words in English.
 */
export function tidyPictureText(text: string): string {
  // no lookbehind: a browser that does not know it would refuse the whole script
  return text.replace(/(^|[^\p{L}\p{N}])([FLPTVWY]) (?=\p{Ll}{4})/gmu, "$1$2");
}
