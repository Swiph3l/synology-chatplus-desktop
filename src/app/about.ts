import type { Theme } from "./settings";
export type ProjectLink = "github" | "issues" | "star" | "support";
export interface AboutInfo {
  project: {
    project_name: string;
    project_description: string;
    maintainer: string;
    license: string;
    github_repository_url: string;
    github_issues_url: string;
    github_star_url: string;
    support_url: string | null;
  };
  build: {
    semantic_version: string;
    display_version: string;
    build_date_utc: string;
    git_commit_full: string | null;
    git_commit_short: string | null;
    git_branch: string | null;
    git_tag: string | null;
    build_channel: string;
    is_dirty: boolean | null;
    rust_version: string | null;
  };
  runtime: {
    os: string;
    architecture: string;
    tauri_version: string;
    webview_version: string;
  };
  theme: Theme;
  server_configured: boolean;
  connection_state: string;
}
export function hasSupport(url: string | null): boolean {
  return Boolean(url?.trim());
}
export function available(value: string | null): string {
  return value || "Unavailable";
}
export function yesNo(value: boolean | null): string {
  return value === null ? "Unavailable" : value ? "Yes" : "No";
}
