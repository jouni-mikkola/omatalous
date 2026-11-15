/** The language of the signed-in member. Own row only; the sign-in answer carries it back (`User.language`). */
import { isLanguage, type Language } from "@banking/core";
import { Hono } from "hono";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { body } from "./shared.ts";

/** The language of a request body, or a UserError with a catalogue message. */
function parseLanguage(raw: unknown): Language {
  const { language } = strictObject(raw, ["language"] as const);
  if (!isLanguage(language)) throw UserError.of("check.language");
  return language;
}

export function languageRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.put("/language", async (c) => {
    const language = parseLanguage(await body(c));
    // a display choice: no data version moves, since no cached figure holds a sentence of it
    await s.users.setLanguage(c.get("user").id, language);
    return c.json({ language });
  });

  return app;
}
