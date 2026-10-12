import { lazy, Suspense, useState, type ClipboardEvent } from "react";
import { api } from "@reader/api";
import { Textarea } from "@reader/ui/components/textarea";
import { Tabs, TabsList, TabsTrigger } from "@reader/ui/components/tabs";
import {
  placeNoteImages,
  pastedNoteImages,
  useDocumentNote,
} from "./document-note";

const MessageMarkdown = lazy(() =>
  import("./chat/MessageMarkdown").then((module) => ({
    default: module.MessageMarkdown,
  })),
);

const statusLabel = {
  loading: "",
  idle: "",
  saving: "保存中…",
  saved: "已保存",
} as const;

/** The document's single Markdown note, shown in the reading pane. */
export function DocumentNotePage({ documentId }: { documentId: string }) {
  const note = useDocumentNote(documentId);
  const [view, setView] = useState<"source" | "preview">("source");
  const [uploading, setUploading] = useState(false);
  const [pasteError, setPasteError] = useState(false);
  const paste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = pastedNoteImages(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    const field = event.currentTarget;
    const start = field.selectionStart ?? note.body.length;
    const end = field.selectionEnd ?? start;
    const base = note.body;
    setUploading(true);
    setPasteError(false);
    try {
      const saved = [];
      for (const file of files)
        saved.push(await api.saveNoteImage(documentId, file));
      const next = placeNoteImages(
        base,
        start,
        end,
        saved.map((item) => item.id),
      );
      note.setBody(next.text);
      requestAnimationFrame(() => {
        field.focus();
        field.setSelectionRange(next.caret, next.caret);
      });
    } catch {
      setPasteError(true);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="document-note-page">
      <div className="document-note-switch">
        <span className="document-note-status">
          {uploading
            ? "正在放入图片…"
            : pasteError
              ? "图片未能放入"
              : statusLabel[note.status]}
        </span>
        <Tabs
          value={view}
          onValueChange={(value) => {
            if (value === "source" || value === "preview") setView(value);
          }}
        >
          <TabsList aria-label="笔记显示">
            <TabsTrigger value="source">源代码</TabsTrigger>
            <TabsTrigger value="preview">预览</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {view === "source" ? (
        <Textarea
          aria-label="论文笔记"
          placeholder={
            "用 Markdown 写这篇论文的笔记，也可以直接粘贴图片…\n\n例如：\n## 问题\n- 作者把 agent 定义成…"
          }
          disabled={note.status === "loading" || uploading}
          value={note.body}
          onChange={(event) => {
            setPasteError(false);
            note.setBody(event.target.value);
          }}
          onPaste={(event) => void paste(event)}
          onBlur={() => note.flush()}
        />
      ) : (
        <div className="document-note-preview" aria-label="笔记预览">
          {note.body.trim() ? (
            <Suspense fallback={null}>
              <MessageMarkdown
                content={note.body}
                animated={false}
                images
                documentId={documentId}
              />
            </Suspense>
          ) : (
            <p className="text-sm text-muted-foreground">还没有笔记</p>
          )}
        </div>
      )}
    </div>
  );
}
