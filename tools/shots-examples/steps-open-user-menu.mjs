// A --steps module for `pnpm shots`: opens the user menu in the header (it only opens: nothing is chosen).
// Try it: pnpm shots overview --demo --fake-bank --steps tools/shots-examples/steps-open-user-menu.mjs --name user-menu --only .user-menu
export default async (page) => {
  await page.getByLabel("Käyttäjävalikko").click();
  await page.getByRole("link", { name: "Vaihda salasana" }).waitFor();
};
