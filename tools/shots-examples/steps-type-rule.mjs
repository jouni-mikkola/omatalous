// A --steps module for `pnpm shots`: types a made-up search word into the rule form of Säännöt and stops: the rule is not saved.
// Try it: pnpm shots "categories?tab=merchants" --demo --fake-bank --steps tools/shots-examples/steps-type-rule.mjs --name rule-typed --only Säännöt
export default async (page) => {
  await page.getByLabel("Hakusana").fill("Esimerkki Oy");
  await page.getByLabel("Hakusana").scrollIntoViewIfNeeded();
};
