/**
 * The category catalogue in the member's language. Core keeps the Finnish labels and groups (the groups are keys); the
 * display text comes from the message catalogue, and a category with no entry keeps its Finnish label.
 */
import { CATEGORIES, categoryLabel, type Category, type CategoryKind, groupLabel, KIND_LABEL, type Language, messageFromWire } from "@banking/core";

type NamedCategory = Category & { groupName: string };

export function categoriesIn(lang: Language): NamedCategory[] {
  return CATEGORIES.map((c) => ({
    ...c,
    label: categoryLabel(c, lang),
    groupName: groupLabel(c.group, lang),
  }));
}

export function kindLabelsIn(lang: Language): Record<CategoryKind, string> {
  const named = {} as Record<CategoryKind, string>;
  for (const kind of Object.keys(KIND_LABEL) as CategoryKind[]) named[kind] = messageFromWire(`ckind.${kind}`, undefined, lang) ?? KIND_LABEL[kind];
  return named;
}
