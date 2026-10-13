// A --steps module for `pnpm shots`: opens the category of the first row of Tapahtumat for editing and stops: no category is chosen, nothing is saved.
// The list of the browser's own drop-down is closed again (it hangs the picture); the select that took its place stays open.
// Try it: pnpm shots transactions --demo --fake-bank --steps tools/shots-examples/steps-open-row-edit.mjs --name row-edit
export default async (page) => {
  await page.getByRole("button", { name: /^Kategoria: / }).first().click();
  const select = page.getByRole("combobox", { name: /^Kategoria: / }).first();
  await select.waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
};
