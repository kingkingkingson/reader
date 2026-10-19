import bundledReleaseNotes from "../../../../docs/release-notes.json";
import type { GuidePreferences } from "@reader/core";

export interface ReleaseItem {
  title: string;
  body?: string;
  /** A guide topic that demonstrates this change. */
  topic?: string;
}

/**
 * Notes keyed by the desktop package version. Versions without notes still
 * show the update confirmation and GitHub feedback actions.
 */
export const releaseNotes: Record<string, ReleaseItem[]> = bundledReleaseNotes;

export type GuideLaunch =
  | { kind: "onboarding" }
  | { kind: "release"; items: ReleaseItem[] }
  | { kind: "none"; save?: GuidePreferences };

/**
 * Decides what to show at startup. Libraries created before the guide existed
 * count as onboarded, so existing users see release notes instead.
 */
export function guideLaunch(
  preferences: GuidePreferences,
  version: string,
  hasDocuments: boolean,
): GuideLaunch {
  if (!preferences.onboarded && !hasDocuments) return { kind: "onboarding" };
  if (preferences.seenVersion === version)
    return preferences.onboarded
      ? { kind: "none" }
      : { kind: "none", save: { ...preferences, onboarded: true } };
  return { kind: "release", items: releaseNotes[version] ?? [] };
}
