import { useEffect, useRef, useState } from "react";
import { api } from "@reader/api";
import type { GuidePreferences } from "@reader/core";
import { toast } from "sonner";
import { GuideDialog, OnboardingDialog } from "./GuideDialog";
import { guideLaunch } from "./releases";
import { guideTopics, type GuideAction } from "./topics";

/**
 * Shows onboarding on the first launch of an empty library, and the guide
 * whenever it is opened.
 */
export function GuideHost({
  ready,
  version,
  hasDocuments,
  open,
  onOpenChange,
  onAction,
}: {
  /** The library has loaded. */
  ready: boolean;
  version: string;
  hasDocuments: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: GuideAction) => void;
}) {
  const [onboarding, setOnboarding] = useState(false);
  const [topic, setTopic] = useState(guideTopics[0].id);
  const preferences = useRef<GuidePreferences>({});
  const launched = useRef(false);
  const save = (patch: GuidePreferences) => {
    preferences.current = { ...preferences.current, ...patch };
    void api
      .saveGuidePreferences(preferences.current)
      .catch((e) => toast.error((e as Error).message));
  };
  useEffect(() => {
    if (!ready || launched.current) return;
    launched.current = true;
    void api
      .guidePreferences()
      .then((saved) => {
        preferences.current = saved;
        const launch = guideLaunch(saved, version, hasDocuments);
        if (launch.kind === "onboarding") setOnboarding(true);
        else if (launch.save) save(launch.save);
      })
      // Without saved state, showing nothing is safer than repeating the guide.
      .catch(() => {});
  }, [ready]);
  const finishOnboarding = () => {
    setOnboarding(false);
    save({ onboarded: true, seenVersion: version });
  };
  return (
    <>
      <OnboardingDialog open={onboarding} onFinish={finishOnboarding} />
      <GuideDialog
        open={open}
        onOpenChange={onOpenChange}
        topic={topic}
        onTopicChange={setTopic}
        onAction={(action) => {
          onOpenChange(false);
          onAction(action);
        }}
      />
    </>
  );
}
