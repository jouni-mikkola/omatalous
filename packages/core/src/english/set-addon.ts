/** The English table of set-addon; the Finnish one it must match is in ../messages-set-addon.ts. */
import type { FI_SET_ADDON } from "../messages-set-addon.ts";

export const EN_SET_ADDON: Record<keyof typeof FI_SET_ADDON, string> = {
  "set.addon.title": "Add-on",
  "set.addon.intro": "An add-on brings a feature that is not part of the shared code. You get the code from the add-on's maker. Only an add-on whose signature matches is installed.",
  "set.addon.code": "Enter the add-on code",
  "set.addon.password": "Your password",
  "set.addon.save": "Save code",
  "set.addon.saving": "Saving…",
  "set.addon.remove": "Remove add-on",
  "set.addon.removing": "Removing…",
  "set.addon.remove_needs_password": "Type your password to remove the add-on.",
  "set.addon.state_none": "Not connected.",
  "set.addon.state_connected": "Connected, version {version}.",
  "set.addon.state_connected_named": "Connected: {label}, version {version}.",
  "set.addon.state_pending": "Version {version} is downloaded. It is taken into use when the server next starts.",
  "set.addon.state_waiting": "Waiting for a version that fits this version of the app.",
  "set.addon.state_checking": "Checking…",
  "set.addon.state_refused": "Refused: {why}.",
  "set.addon.why_signature": "the signature does not match",
  "set.addon.why_fetch": "the release could not be fetched",
  "set.addon.why_code": "the code does not open the releases",
  "set.addon.why_content": "the package content is not valid",
  "set.addon.why_migration": "the add-on's database change failed, so the server started without it",
};
