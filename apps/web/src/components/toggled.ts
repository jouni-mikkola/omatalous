// Decision: the rows of a table that open to their lines are a set of ids the caller keeps

/** The open rows after a click on the row `id`: it closes when it was open and opens when it was not. */
export function toggled(open: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(open);
  if (!next.delete(id)) next.add(id);
  return next;
}
