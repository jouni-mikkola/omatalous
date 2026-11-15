import project from "../../../project.json";

/** Who made Omatalous and where it lives: read by the footer of every page (components/AboutFoot.tsx) and by nothing else. */
export const ABOUT = {
  /** The attribution the licence's additional term (LICENSE, section 7(b)) keeps in every copy: the app's name, then the author's. */
  appName: project.name,
  authorName: project.author,
  authorUrl: project.authorUrl,
  sourceUrl: `https://github.com/${project.owner}/${project.repo}`,
  /** The guide to what to do when the app shows a notice or a wrong figure. */
  guidesUrl: `https://github.com/${project.owner}/${project.repo}/blob/main/docs/TROUBLESHOOTING.md`,
  licence: "AGPL-3.0",
  /** Where to help with the development costs. Empty: the footer shows no support link. */
  supportUrl: project.supportUrl,
};
