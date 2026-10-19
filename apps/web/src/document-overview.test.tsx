// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import type { Document, DocumentOverview } from "@reader/core";
import { DocumentOverviewDialog } from "./DocumentOverview";
vi.mock("@reader/api", () => ({
  api: {
    documentOverview: vi.fn(),
    generateOverview: vi.fn(),
    cancelOverview: vi.fn(),
  },
}));
const doc = { id: "doc", title: "Test paper", type: "pdf" } as Document;
const overview: DocumentOverview = {
  documentId: "doc",
  status: "complete",
  stale: false,
  compilerVersion: "v1",
  corpusRevision: "rev1",
  updatedAt: "",
  compiledPassages: 10,
  totalPassages: 10,
  sections: [],
  coverage: {
    status: "ready",
    totalUnits: 2,
    searchableUnits: 2,
    missingRanges: [],
    warnings: [],
  },
  content: {
    summary: "文档概要",
    findings: [{ text: "结果为37", blockIds: ["b1"] }],
    limitations: [],
    terms: ["cobalt"],
  },
  sources: [
    { blockId: "b1", label: "Experiment", location: { type: "pdf", page: 2 } },
  ],
};
let root: Root, host: HTMLDivElement;
const navigate = vi.fn(async () => {}),
  close = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  )!;
it("revalidates source revision before navigating to original evidence", async () => {
  vi.mocked(api.documentOverview).mockResolvedValue(overview);
  await act(async () =>
    root.render(
      <DocumentOverviewDialog
        document={doc}
        onClose={close}
        onNavigate={navigate}
      />,
    ),
  );
  expect(document.body.textContent).toContain("结果为37");
  vi.mocked(api.documentOverview).mockResolvedValue({
    ...overview,
    status: "stale",
    stale: true,
  });
  await act(async () => button("第 2 页").click());
  expect(navigate).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("原文已更新");
});
it("never starts a paid generation merely by viewing an overview", async () => {
  vi.mocked(api.documentOverview).mockResolvedValue({
    ...overview,
    status: "missing",
    content: undefined,
    sources: [],
  });
  await act(async () =>
    root.render(<DocumentOverviewDialog document={doc} onClose={close} />),
  );
  expect(api.generateOverview).not.toHaveBeenCalled();
  vi.mocked(api.generateOverview).mockResolvedValue({
    ...overview,
    status: "queued",
  });
  vi.mocked(api.documentOverview).mockResolvedValue({
    ...overview,
    status: "queued",
  });
  await act(async () => button("生成概要").click());
  expect(api.generateOverview).toHaveBeenCalledWith("doc", false);
  expect(document.body.textContent).toContain("等待生成概要");
});

it.each(["complete", "partial"] as const)(
  "regenerates a published %s overview",
  async (status) => {
    vi.mocked(api.documentOverview).mockResolvedValue({ ...overview, status });
    await act(async () =>
      root.render(<DocumentOverviewDialog document={doc} onClose={close} />),
    );
    vi.mocked(api.generateOverview).mockResolvedValue({
      ...overview,
      status: "queued",
    });
    vi.mocked(api.documentOverview).mockResolvedValue({
      ...overview,
      status: "queued",
    });
    await act(async () => button("重新生成").click());
    expect(api.generateOverview).toHaveBeenCalledWith("doc", true);
    expect(document.body.textContent).toContain("文档概要");
  },
);
