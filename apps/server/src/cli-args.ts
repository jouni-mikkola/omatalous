/** The value after a `--name` flag, or undefined when the flag is absent or last. */
export function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** The words a command takes after its own name. */
export interface Takes {
  /** How many plain words: a username, an id. None when left out. */
  plain?: number;
  /** Flags that stand alone, like `--admin`. */
  flags?: string[];
  /** Flags that take the next word, like `--days 5`. */
  values?: string[];
  /** Those of `values` that may be the last word, and then count as absent, as `option` reads them. */
  mayEnd?: string[];
}

/**
 * The plain words of a command in their order, and in `stray` a sentence that names the first word the command does
 * not take. A command acts only when every word fits: one that skips a word it does not know deletes a user on
 * `user delete anna --help` and makes a member on `user create anna --admn`.
 * A value never starts with `--`, so a flag is not taken for the value of the flag before it.
 */
export function readWords(words: string[], takes: Takes): { plain: string[]; stray?: string } {
  const plain: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const valued = takes.values?.includes(word) ?? false;
    if (valued || takes.flags?.includes(word)) {
      if (seen.has(word)) return { plain, stray: `${word} is given twice.` };
      seen.add(word);
      if (!valued) continue;
      const value = words[i + 1];
      if (value === undefined) {
        if (takes.mayEnd?.includes(word)) continue;
        return { plain, stray: `${word} needs a value after it.` };
      }
      if (value.startsWith("--")) return { plain, stray: `${word} needs a value after it, not ${value}.` };
      i++;
    } else if (word.startsWith("--")) {
      return { plain, stray: `Unknown option: ${word}` };
    } else if (plain.length >= (takes.plain ?? 0)) {
      return { plain, stray: `Unexpected word: ${word}` };
    } else {
      plain.push(word);
    }
  }
  return { plain };
}
