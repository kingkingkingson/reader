import type { Annotation, Document } from "@reader/core";
import { api, publicationURL } from "@reader/api";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { toast } from "sonner";
import { downloadBlob, fileTitle } from "./download";
import { annotatedPDF } from "./readers/pdf-export";

/** Saves a copy of the PDF with Reader's annotations written into it. */
export async function exportAnnotatedPDF(
  doc: Document,
  kinds?: Annotation["kind"][],
) {
  const [annotations, messages] = await Promise.all([
    api.annotations(doc.id),
    api.messages(doc.id),
  ]);
  const marks = annotations.filter(
    (a) =>
      a.kind !== "bookmark" &&
      a.location.type === "pdf" &&
      (!kinds || kinds.includes(a.kind)),
  );
  if (!marks.length) throw new Error("这份 PDF 还没有可导出的批注");
  // Loaded on demand so the library does not carry the PDF engine.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc ||= workerURL;
  const result = await annotatedPDF(
    pdfjs.getDocument,
    {
      url: publicationURL(doc.id, "original.pdf"),
      cMapUrl: "/pdf-assets/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      wasmUrl: "/pdf-assets/wasm/",
    },
    marks,
    {
      answers: Object.fromEntries(messages.map((m) => [m.id, m.content])),
    },
  );
  if (!result.exported)
    throw new Error(
      "没有可写入原文的批注：译文批注不写入原文，其他批注可能无法定位",
    );
  downloadBlob(
    new Blob([result.bytes as Uint8Array<ArrayBuffer>], {
      type: "application/pdf",
    }),
    `${fileTitle(doc.title)}-批注.pdf`,
  );
  return result;
}

/** Runs the export with progress and result toasts. */
export function exportAnnotatedPDFWithToast(
  doc: Document,
  kinds?: Annotation["kind"][],
) {
  const id = toast.loading("正在导出带批注的 PDF…");
  return exportAnnotatedPDF(doc, kinds).then(
    ({ exported, skipped }) =>
      toast.success(`已导出 ${exported} 条批注`, {
        id,
        description: skipped
          ? `${skipped} 条为译文批注或无法定位，未写入`
          : undefined,
      }),
    (error: Error) => toast.error(error.message, { id }),
  );
}
