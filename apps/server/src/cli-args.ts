/** The value after a `--name` flag, or undefined when the flag is absent or last. */
export function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
