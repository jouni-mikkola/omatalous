/** The English table of factor; the Finnish one it must match is in ../messages-factor.ts. */
import type { FI_FACTOR } from "../messages-factor.ts";

export const EN_FACTOR: Record<keyof typeof FI_FACTOR, string> = {
  "remote.second_factor_needed": "Remote access needs a second factor from every admin. Turn on two-step sign-in under Settings > Security. Missing: {names}.",
  "remote.admin_needs_factor": "The address is public, so an admin must have a second factor. Turn remote access off first, or ask the member to turn on two-step sign-in.",
  "factor.keep_while_public": "The address is public, so an admin must keep a second factor. Turn remote access off first.",
};
