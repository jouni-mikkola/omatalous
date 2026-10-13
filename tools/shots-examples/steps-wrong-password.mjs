// A --steps module for `pnpm shots`: types a made-up user and a wrong password into the sign-in form and sends it, so the
// error under the form is in the picture. It belongs to tools/shots-examples/state-sign-in.mjs; the app is the test app the tool started.
// Try it: pnpm shots overview --answers tools/shots-examples/state-sign-in.mjs --steps tools/shots-examples/steps-wrong-password.mjs --name wrong-password
export default async (page) => {
  await page.getByLabel("Käyttäjätunnus").fill("matti");
  await page.getByLabel("Salasana").fill("vaara-salasana-0000");
  await page.getByRole("button", { name: "Kirjaudu", exact: true }).click();
  await page.locator(".error").waitFor();
};
