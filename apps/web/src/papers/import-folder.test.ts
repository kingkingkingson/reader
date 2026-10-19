import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import type { Document } from "@reader/core";
import { useReaderStore } from "../store";
import { currentPaperFolder, fileImportedPapers } from "./actions";
import { paper } from "./fixtures";
import { usePaperUI } from "./state";

vi.mock("@reader/api", () => ({
  api: {
    update: vi.fn(async () => ({})),
    documents: vi.fn(async () => []),
  },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const doc = paper({ id: "new", library: "papers", folders: ["elsewhere"] });

beforeEach(() => {
  vi.clearAllMocks();
  useReaderStore.setState({
    documents: [doc],
    active: null,
    libraryPreferences: {},
  });
  usePaperUI.setState({ view: "folder:paper/under-review/fse27" });
});

it("files an import into the open category and leaves other views alone", async () => {
  expect(currentPaperFolder()).toBe("paper/under-review/fse27");
  await expect(fileImportedPapers([doc])).resolves.toBe("fse27");
  expect(api.update).toHaveBeenCalledWith("new", {
    folders: ["elsewhere", "paper/under-review/fse27"],
  });

  usePaperUI.setState({ view: "all" });
  expect(currentPaperFolder()).toBe("");
  await expect(fileImportedPapers([doc], "")).resolves.toBe("");
  expect(api.update).toHaveBeenCalledTimes(1);

  usePaperUI.setState({ view: "folder:paper/under-review/fse27" });
  useReaderStore.setState({ active: { id: "open" } as Document });
  expect(currentPaperFolder()).toBe("");
});
