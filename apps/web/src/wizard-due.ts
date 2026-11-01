import type { Meta } from "./types.ts";

/** Whether the first-run wizard is what shows before the pages: an admin of an install whose setup is not finished and who has not closed it in this browser. Kept apart from the wizard so that the shell can ask without loading it. */
export const wizardDue = (o: { role: string; meta: Pick<Meta, "setupDone">; closed: boolean }): boolean => o.role === "admin" && !o.meta.setupDone && !o.closed;

const closedKey = (userId: number | string) => `wizard-closed:${userId}`;

/** Whether this user pressed "Tee myöhemmin" in this browser. The setup stays reachable in Asetukset > Pankit ja tilit. */
export function readWizardClosed(userId: number | string): boolean {
  try {
    return localStorage.getItem(closedKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeWizardClosed(userId: number | string): void {
  try {
    localStorage.setItem(closedKey(userId), "1");
  } catch {
    // private mode: the wizard shows again after a reload
  }
}
