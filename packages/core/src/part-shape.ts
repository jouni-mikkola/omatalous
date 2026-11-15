/**
 * What a part of an account is, asked of the part alone (the part itself is in account-use.ts). Kept apart from the
 * work of splitting accounts and debts, which the web entry would otherwise load whole to ask these two questions.
 */
import type { Part } from "./types.ts";

/** Whether a part is the whole of an account whose split nobody has said. */
export const isUntold = (part: Part | undefined): boolean => part?.split === "unknown";

/** A part below the whole: some of the account is another user's. */
export const belowWhole = (part: Part | undefined): part is Part => part !== undefined && part.to - part.from < part.of;
