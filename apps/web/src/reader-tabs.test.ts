import { beforeEach, expect, it } from "vitest";
import type { Document } from "@reader/core";
import { forgetLibraryDocuments, useReaderStore } from "./store";

const doc = (id: string, title = id) => ({ id, title }) as Document;

beforeEach(() => {
  useReaderStore.setState({ documents: [], tabs: [], active: null });
});

it("keeps each opened paper as a tab and returns to the library without closing them", () => {
  const { open } = useReaderStore.getState();
  open(doc("a", "Alpha"));
  open(doc("b", "Beta"));
  open(doc("a", "Alpha"));
  expect(useReaderStore.getState().tabs.map((tab) => tab.id)).toEqual([
    "a",
    "b",
  ]);
  expect(useReaderStore.getState().active?.id).toBe("a");
  open(null);
  expect(useReaderStore.getState().active).toBeNull();
  expect(useReaderStore.getState().tabs.map((tab) => tab.id)).toEqual([
    "a",
    "b",
  ]);
});

it("activates the neighbor when the current tab closes", () => {
  const { open, closeTab } = useReaderStore.getState();
  open(doc("a"));
  open(doc("b"));
  open(doc("c"));
  closeTab("b");
  expect(useReaderStore.getState().active?.id).toBe("c");
  closeTab("c");
  expect(useReaderStore.getState().tabs.map((tab) => tab.id)).toEqual(["a"]);
  expect(useReaderStore.getState().active?.id).toBe("a");
  closeTab("a");
  expect(useReaderStore.getState().active).toBeNull();
});

it("drops a trashed paper from the tabs and keeps another one open", () => {
  const { open } = useReaderStore.getState();
  open(doc("a"));
  open(doc("b"));
  useReaderStore.setState({ documents: [doc("a"), doc("b")] });
  forgetLibraryDocuments(["b"]);
  expect(useReaderStore.getState().tabs.map((tab) => tab.id)).toEqual(["a"]);
  expect(useReaderStore.getState().active?.id).toBe("a");
  expect(useReaderStore.getState().documents.map((item) => item.id)).toEqual([
    "a",
  ]);
});
