import { useEffect, useRef, useState } from "react";
import { Check, FileSearch, Pause, RotateCcw, Languages } from "lucide-react";
import type { EPUBLocation, LibraryMode, Processing } from "@reader/core";
import { api } from "@reader/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@reader/ui/components/alert-dialog";
import { Button } from "@reader/ui/components/button";
import { toast } from "sonner";
import type { PageRange } from "./chapters";

type Action = "start" | "pause" | "resume" | "chapter";

/**
 * Papers translate the whole document with start, pause and resume. Books
 * translate the current chapter on request; the server caps each request.
 */
export function AssistanceControls({
  documentId,
  processing,
  library = "papers",
  chapter,
  epubChapter,
}: {
  documentId: string;
  processing?: Processing;
  library?: LibraryMode;
  /** The chapter at the reading position, read when the button is pressed. */
  chapter?: () => PageRange | undefined;
  epubChapter?: () => EPUBLocation | undefined;
}) {
  const [saved, setSaved] = useState<Processing>();
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const serial = useRef(0);
  const job =
    saved &&
    (!processing ||
      Date.parse(saved.updatedAt) > Date.parse(processing.updatedAt))
      ? saved
      : processing;
  useEffect(() => {
    let alive = true;
    setSaved(undefined);
    setBusy(false);
    setConfirmAll(false);
    void api
      .assistance(documentId)
      .then((p) => {
        if (alive) setSaved(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
      serial.current++;
    };
  }, [documentId]);
  const complete = job?.status === "complete";
  const paperParsing =
    library === "papers" &&
    !epubChapter &&
    job?.phase === "learning" &&
    !job.retranslating &&
    !complete;
  const parsingPending = paperParsing && job.status !== "failed";
  const [action, label]: [Action, string] =
    job?.enabled && job.status === "failed"
      ? ["resume", "重试翻译"]
      : job?.enabled && !complete
        ? ["pause", "暂停翻译"]
        : !job?.enabled
          ? epubChapter &&
            (!job?.startedAt || job.translating?.status === "complete")
            ? ["chapter", "翻译本章"]
            : job?.startedAt && !job.manualTranslation
              ? ["resume", "继续翻译"]
              : ["start", "翻译"]
          : library === "books"
            ? ["chapter", "翻译本章"]
            : ["start", "翻译完成"];
  const finished = complete && action !== "chapter";
  const actionLabel = paperParsing
    ? job.status === "failed"
      ? "重试解析"
      : job.status === "running"
        ? "解析中"
        : "等待解析"
    : job?.retranslating
      ? action === "pause"
        ? "暂停重译"
        : "继续重译"
      : label;
  const run = async () => {
    if (action !== "chapter") return api.setAssistance(documentId, action);
    if (epubChapter) {
      const location = epubChapter();
      if (!location?.href) throw new Error("正文仍在加载，请稍后再试");
      await api.translateEPUBChapter(documentId, location);
      return api.assistance(documentId);
    }
    const range = chapter?.();
    if (!range) return undefined;
    const result = await api.translateRange(
      documentId,
      range.fromPage,
      range.toPage,
    );
    if (result.parsing) toast("正在解析本章，完成后开始翻译");
    return api.assistance(documentId);
  };
  return (
    <div className="assistance-controls">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || !job || finished || parsingPending}
        title={
          action === "chapter"
            ? "翻译当前完整章节，复用已完成译文"
            : job?.enabled
              ? job.detail
              : epubChapter
                ? "继续已请求章节的翻译"
                : "使用当前 AI 连接翻译全文与公式"
        }
        onClick={async () => {
          const operation = ++serial.current;
          setBusy(true);
          try {
            const next = await run();
            if (next && operation === serial.current) setSaved(next);
          } catch (e) {
            if (operation === serial.current) toast.error((e as Error).message);
          } finally {
            if (operation === serial.current) setBusy(false);
          }
        }}
      >
        {parsingPending ? (
          <FileSearch />
        ) : finished ? (
          <Check />
        ) : action === "pause" ? (
          <Pause />
        ) : action === "resume" && job?.status === "failed" ? (
          <RotateCcw />
        ) : (
          <Languages />
        )}
        {actionLabel}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={
          busy || !job || (!job.enabled && !job.translating && !job.startedAt)
        }
        onClick={() => setConfirmAll(true)}
      >
        重新翻译全文
      </Button>
      <AlertDialog
        open={confirmAll}
        onOpenChange={(open) => {
          if (!busy) setConfirmAll(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新翻译全文？</AlertDialogTitle>
            <AlertDialogDescription>
              现有译文会被清除，并按当前模型和术语重新翻译。手动改过的段落也会被覆盖。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                const operation = ++serial.current;
                setBusy(true);
                void api
                  .translate(documentId, "", true)
                  .then(() => api.assistance(documentId))
                  .then((next) => {
                    if (operation === serial.current) {
                      setSaved(next);
                      setConfirmAll(false);
                    }
                  })
                  .catch((e: Error) => {
                    if (operation === serial.current) toast.error(e.message);
                  })
                  .finally(() => {
                    if (operation === serial.current) setBusy(false);
                  });
              }}
            >
              重新翻译
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>    </div>
  );
}
