import registry from "../../contributors.json";
import type { TranslationKey } from "../i18n";

export const contributionKeys = {
  creator: "about.contribution.creator",
  maintenance: "about.contribution.maintenance",
  macos: "about.contribution.macos",
  dsm: "about.contribution.dsm",
  webkit: "about.contribution.webkit",
  translations: "about.contribution.translations",
  testing: "about.contribution.testing",
  documentation: "about.contribution.documentation",
  code: "about.contribution.code",
  port: "about.contribution.port",
} as const satisfies Record<string, TranslationKey>;

export type ContributionRole = keyof typeof contributionKeys;
export interface Contributor {
  id: string;
  name: string;
  username: string;
  contributions: readonly ContributionRole[];
}
export interface CommunityFork {
  id: string;
  contributorId: string;
  owner: string;
  repository: string;
  platform: "windows" | "macos" | "linux";
}
export interface CommunityRegistry {
  contributors: readonly Contributor[];
  forks: readonly CommunityFork[];
}

// Swiph3l: Credits are bundled so opening About works offline and never fetches
// avatars or ranks contributions by GitHub commit counts.
export const community = registry as CommunityRegistry;
