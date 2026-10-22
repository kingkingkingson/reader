import { useRef, useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { api } from "@reader/api";
import { Button } from "@reader/ui/components/button";
import { toast } from "sonner";
import { codexThreadURL } from "../../../../packages/reader-core/src/codex-link";

export function CodexHandoffButton({
  documentId,
  sessionId,
  disabled,
}: {
  documentId: string;
  sessionId?: string;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const continueReading = async () => {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(true);
    try {
      const result = sessionId
        ? await api.codexHandoff(documentId, sessionId)
        : await api.codexHandoff(documentId);
      const url = codexThreadURL(result.threadId);
      try {
        if (window.readerDesktop?.openCodexThread) {
          await window.readerDesktop.openCodexThread(result.threadId);
        } else {
          window.location.assign(url);
        }
        toast.success("已准备独立阅读对话，后续消息不会同步回 Reader");
      } catch {
        toast.error("接续对话已保存，请确认已安装 Codex App 后重试打开");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "无法准备 Codex 接续对话",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title="在 Codex 中继续（独立副本）"
      aria-label="在 Codex 中继续"
      disabled={disabled || busy}
      onClick={() => void continueReading()}
    >
      {busy ? (
        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
      ) : (
        <ExternalLink />
      )}
    </Button>
  );
}
