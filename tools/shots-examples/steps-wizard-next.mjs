// A --steps module for `pnpm shots`: leaves step 1 of the wizard (no bank app yet) for step 2, the summary.
// Try it: pnpm shots overview --answers tools/shots-examples/state-wizard.mjs --steps tools/shots-examples/steps-wizard-next.mjs --name wizard-2
export default async (page) => {
  await page.getByRole("button", { name: "Ohita vaihe" }).click();
  await page.getByText("Salausavain").waitFor();
};
