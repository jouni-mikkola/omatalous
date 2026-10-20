// A --steps module for `pnpm shots`: opens the dialog of the update key on the technical page, nothing typed or sent.
// STEPS_HEIGHT=600 in the environment shows it in a window that is low.
export default async (page) => {
  if (process.env.STEPS_HEIGHT) await page.setViewportSize({ width: page.viewportSize().width, height: Number(process.env.STEPS_HEIGHT) });
  await page.getByRole("button", { name: "Päivitä", exact: true }).click();
  await page.getByRole("dialog").waitFor();
};
