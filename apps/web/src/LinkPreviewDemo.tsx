import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { defaultTheme, type LinkPreview, type ReaderTheme } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { LinkPreviewPanel } from "./LinkPreviewPanel";
import { PDFLinkPreview } from "./readers/pdf-link-preview";

pdfjs.GlobalWorkerOptions.workerSrc = workerURL;

/** Development-only manual acceptance page, using the real PDF preview renderer. */
export default function LinkPreviewDemo() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<PDFLinkPreview | null>(null);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File>();
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const theme = useRef<ReaderTheme>(defaultTheme);
  theme.current = { ...defaultTheme, mode: dark ? "dark" : "light" };
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    engine.current?.invalidate();
  }, [dark]);
  useEffect(() => {
    let disposed = false;
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    let current: PDFLinkPreview | undefined;
    setReady(false);
    setPreview(null);
    setPage(1);
    setMessage("");
    void (async () => {
      const source = file
        ? { data: new Uint8Array(await file.arrayBuffer()) }
        : { url: "/samples/reading-notes.pdf" };
      if (disposed) return;
      task = pdfjs.getDocument({
        ...source,
        standardFontDataUrl: "/pdf-assets/standard_fonts/",
        cMapUrl: "/pdf-assets/cmaps/",
        cMapPacked: true,
        wasmUrl: "/pdf-assets/wasm/",
      });
      const pdf = await task.promise;
      if (disposed) return;
      current = new PDFLinkPreview(
        host.current!,
        () => pdf,
        setPreview,
        () => {},
        () => theme.current,
      );
      engine.current = current;
      setPages(pdf.numPages);
      setReady(true);
    })().catch((error) => {
      if (!disposed) setMessage(String(error));
    });
    return () => {
      disposed = true;
      current?.destroy();
      engine.current = null;
      void task?.destroy();
    };
  }, [file]);
  return (
    <div
      ref={host}
      className="app flex-col items-start gap-6 overflow-auto p-8"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-medium">链接预览</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDark((old) => !old)}
        >
          {dark ? "浅色" : "深色"}
        </Button>
        <label className="text-sm">
          选择 PDF{" "}
          <input
            className="ml-2 max-w-64"
            type="file"
            accept=".pdf"
            onChange={(event) => setFile(event.target.files?.[0])}
          />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        悬停下方链接，点击图钉固定预览。拖动标题栏移动窗口，拖动右下角调整大小；用底部加减按钮或
        ⌘/Ctrl + 滚轮缩放，拖动内容查看细节。
      </p>
      <label className="text-sm">
        页码{" "}
        <input
          className="mx-2 w-20 rounded border px-2 py-1"
          type="number"
          min={1}
          max={pages}
          value={page}
          onChange={(event) =>
            setPage(
              Math.min(pages, Math.max(1, Number(event.target.value) || 1)),
            )
          }
        />{" "}
        / {pages}
      </label>
      <div className="flex gap-8">
        {[false, true].map((right) => (
          <a
            key={String(right)}
            className="text-primary underline"
            href={`#page=${page}`}
            onPointerEnter={(event) => {
              if (ready)
                void engine.current?.previewLocation(
                  { type: "pdf", page, x: right ? 0.6 : 0, y: 0.1 },
                  event.currentTarget,
                );
            }}
            onPointerLeave={() => engine.current?.hide()}
            onFocus={(event) => {
              if (ready)
                void engine.current?.previewLocation(
                  { type: "pdf", page, x: right ? 0.6 : 0, y: 0.1 },
                  event.currentTarget,
                );
            }}
            onBlur={() => engine.current?.hide()}
            onClick={(event) => {
              event.preventDefault();
              if (ready)
                void engine.current?.previewLocation(
                  { type: "pdf", page, x: right ? 0.6 : 0, y: 0.1 },
                  event.currentTarget,
                );
            }}
          >
            {right ? "右栏预览" : "整宽预览"}
          </a>
        ))}
      </div>
      <p className="text-sm text-muted-foreground" role="status">
        {message || (ready ? (file?.name ?? "内置示例 PDF") : "正在加载 PDF…")}
      </p>
      <LinkPreviewPanel
        key={file?.name ?? "sample"}
        preview={preview}
        onDismiss={() => setPreview(null)}
        onNavigate={(target) =>
          setMessage(
            `跳转目标：第 ${target.type === "pdf" ? target.page : ""} 页`,
          )
        }
        renderKey={String(dark)}
      />
    </div>
  );
}
