/**
 * The categories a goal could be set for. The goals themselves are gone from the pages (design D3); the list stays so
 * an export that still holds them imports.
 */

/** The categories a goal can be set for: food, restaurants and transport first (public transport, and the car with fuel and parking). */
export const GOAL_CATEGORIES = ["groceries", "restaurants", "transport", "car"] as const;
