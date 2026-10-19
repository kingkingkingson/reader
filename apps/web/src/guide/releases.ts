import bundledReleaseNotes from "../../../../docs/release-notes.json";
import type { GuidePreferences } from "@reader/core";

export interface ReleaseItem {
  title: string;
  body?: string;
  /** A guide topic that demonstrates this change. */
  topic?: string;
}

/**
 * Notes keyed by the desktop package version. The app does not open them on
 * startup; the preview can still show a version's notes.
 */
export const releaseNotes: Record<string, ReleaseItem[]> = bundledReleaseNotes;

export type GuideLaunch =
  { kind: "onboarding" } | { kind: "none"; save?: GuidePreferences };

/**
 * Decides what to show at startup. A new empty library gets onboarding.
 * Later launches, including the first launch of an existing library and each
 * update, stay on the library and only record the current version.
 */
export function guideLaunch(
  preferences: GuidePreferences,
  version: string,
  hasDocuments: boolean,
): GuideLaunch {
  if (!preferences.onboarded && !hasDocuments) return { kind: "onboarding" };
  if (preferences.onboarded && preferences.seenVersion === version)
    return { kind: "none" };
  return {
    kind: "none",
    save: { ...preferences, onboarded: true, seenVersion: version },
  };
}
