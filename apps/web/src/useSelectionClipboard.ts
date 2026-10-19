import { useEffect, useRef } from "react";
import type { Annotation, ReaderSelection } from "@reader/core";
import { copyText } from "./chat/clipboard";

/** Only explicit opt-in permits reader events to overwrite the clipboard. */
export function useSelectionClipboard(enabled: boolean | undefined) {
  const lastSelection = useRef<string | null>(null);
  useEffect(() => {
    lastSelection.current = null;
  }, [enabled]);
  return {
    selection(next: ReaderSelection | null) {
      if (enabled !== true) return;
      const key = next ? JSON.stringify([next.text, next.location]) : null;
      if (next?.text && key !== lastSelection.current)
        void copyText(next.text, "已复制");
      lastSelection.current = key;
    },
    annotation(next: Annotation | undefined) {
      if (enabled === true && next?.quote) void copyText(next.quote, "已复制");
    },
  };
}
