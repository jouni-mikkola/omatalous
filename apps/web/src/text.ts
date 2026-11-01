import { type MessageCode, type MessageParams, messageIn } from "@banking/core";
import { createElement, Fragment, type ReactNode } from "react";
import { count, language } from "./format.ts";

/** A text with a count: the code for one and the code for many, both with the hole `{count}` (the count in the language's grouping). */
export const tn = (n: number, one: MessageCode, many: MessageCode, params: Record<string, string | number> = {}): string => messageIn(language(), n === 1 ? one : many, { ...params, count: count(n) } as never);

/** The name of a figure of core's FIGURES in the member's language (the ones a page names in a label). */
export const figureName = (key: "due" | "ownTransfers" | "free" | "netWorth"): string => messageIn(language(), `figure.${key}`);

/** The text of a catalogue code in the member's language (packages/core/src/messages*.ts). */
export const t = <C extends MessageCode>(code: C, ...params: MessageParams<C>): string => messageIn(language(), code, ...params);

/**
 * A text with marked parts and nodes in it: `<b>…</b>` in the catalogue text becomes <strong>, `<em>…</em>` <em> and `<code>…</code>`
 * <code>, and a hole named in `nodes` takes the node (a link, a button). The other holes are filled from `params`.
 */
export function rich<C extends MessageCode>(code: C, params: Record<string, string | number> = {}, nodes: Record<string, ReactNode> = {}): ReactNode {
  const marks = Object.fromEntries(Object.keys(nodes).map((k) => [k, `\u0001${k}\u0001`]));
  const text = messageIn(language(), code, ...([{ ...params, ...marks }] as never));
  const TAGS = { b: "strong", em: "em", code: "code" } as const;
  return text.split(/(<(?:b|em|code)>.*?<\/(?:b|em|code)>)/).map((piece, i) => {
    const marked = /^<(b|em|code)>(.*)<\/\1>$/.exec(piece);
    const inner = (marked ? marked[2]! : piece).split("\u0001").map((part, j) => (j % 2 ? createElement(Fragment, { key: j }, nodes[part]) : part));
    return marked ? createElement(TAGS[marked[1] as keyof typeof TAGS], { key: i }, ...inner) : createElement(Fragment, { key: i }, ...inner);
  });
}

/** A table of texts made once at load whose reads follow the member's language: each key holds the function that asks the catalogue. */
export function labelTable<K extends string>(codes: Record<K, () => string>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(codes) as K[]) Object.defineProperty(out, key, { enumerable: true, get: codes[key] });
  return out;
}
