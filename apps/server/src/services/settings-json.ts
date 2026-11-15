/** Helpers for the settings that hold sealed JSON (the shared bank app, the add-on code). */
import { UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";

/** A setting that holds JSON, or null when there is none or it does not parse. */
export async function readJson<T>(s: Services, key: string): Promise<T | null> {
  const raw = await s.settings.get(key);
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** The box that seals this copy's secrets, or the sentence an admin reads when APP_SECRET is missing. */
export async function sealedBox(s: Services) {
  const box = await s.secretBox();
  if (!box) throw new UserError("Palvelimen salausavain puuttuu. Ylläpitäjä löytää syyn palvelimen lokista.");
  return box;
}
