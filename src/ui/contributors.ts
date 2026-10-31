import type { CommunityLink } from "../app/about";
import {
  community,
  contributionKeys,
  type CommunityRegistry,
} from "../app/contributors";
import { t, type TranslationKey } from "../i18n";

export function mountContributors(
  container: HTMLElement,
  registry: CommunityRegistry = community,
) {
  const document = container.ownerDocument;
  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (
    label: TranslationKey,
    link: CommunityLink,
    className = "secondary",
  ) => {
    const node = element("button", className, t(label));
    node.type = "button";
    node.dataset.link = link;
    return node;
  };

  const section = element("section", "community-section");
  section.setAttribute("aria-label", t("about.contributorsTitle"));
  const heading = element("header", "community-heading");
  heading.append(
    element("h3", "", t("about.contributorsTitle")),
    button(
      "about.communityAllContributors",
      "community:contributors",
      "text-button",
    ),
  );
  section.append(
    heading,
    element("p", "community-intro", t("about.contributorsIntro")),
  );

  const people = element("ul", "contributor-list");
  for (const person of registry.contributors) {
    const card = element("li", "contributor-card");
    card.dataset.contributor = person.id;
    const identity = element("div", "contributor-identity");
    const monogram = element(
      "span",
      "contributor-monogram",
      person.username.slice(0, 2).toUpperCase(),
    );
    monogram.setAttribute("aria-hidden", "true");
    const name = element("div", "contributor-name");
    name.append(
      element("h4", "", person.name),
      element("span", "contributor-username", `@${person.username}`),
    );
    identity.append(monogram, name);
    const contributions = element("ul", "contributor-roles");
    for (const role of person.contributions) {
      contributions.append(element("li", "", t(contributionKeys[role])));
    }
    const profile = button(
      "about.communityProfile",
      `community:person:${person.id}`,
      "secondary contributor-profile",
    );
    profile.setAttribute(
      "aria-label",
      `${t("about.communityProfile")}: ${person.name}`,
    );
    card.append(identity, contributions, profile);
    people.append(card);
  }
  section.append(people);

  if (registry.forks.length) {
    const variants = element("section", "community-variants");
    variants.setAttribute("aria-label", t("about.communityPorts"));
    variants.append(
      element("h4", "", t("about.communityPorts")),
      element("p", "community-intro", t("about.communityPortsIntro")),
    );
    const list = element("div", "community-variant-list");
    for (const fork of registry.forks) {
      const person = registry.contributors.find(
        (contributor) => contributor.id === fork.contributorId,
      );
      const link = button(
        "about.communityPorts",
        `community:fork:${fork.id}`,
        "secondary community-variant",
      );
      link.replaceChildren(
        element(
          "span",
          "community-variant-name",
          t("about.communityVariant", {
            platform:
              fork.platform === "windows"
                ? "Windows"
                : fork.platform === "macos"
                  ? "macOS"
                  : "Linux",
            name: person?.name ?? fork.owner,
          }),
        ),
        element(
          "span",
          "community-variant-repository",
          `${fork.owner}/${fork.repository}`,
        ),
      );
      list.append(link);
    }
    variants.append(list);
    section.append(variants);
  }

  const invitation = element("section", "community-invitation");
  invitation.setAttribute("aria-label", t("about.communityContribute"));
  invitation.append(
    element("h4", "", t("about.communityContribute")),
    element("p", "community-intro", t("about.communityContributeHelp")),
  );
  const actions = element("div", "actions");
  actions.append(
    button("about.communityContributionGuide", "community:contribute", ""),
    button("about.communityFork", "community:fork"),
    button("about.communityBrowseForks", "community:forks"),
  );
  invitation.append(actions);
  section.append(invitation);
  container.replaceChildren(section);
}
