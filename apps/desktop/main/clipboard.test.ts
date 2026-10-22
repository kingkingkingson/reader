import { afterEach, expect, it, vi } from "vitest";
import {
  clipboard,
  nativeImage,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { writeClipboardImage, writeClipboardText } from "./clipboard";
vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn(), write: vi.fn() },
  ClipboardItem: class {
    constructor(readonly items: Record<string, unknown>) {}
  },
  nativeImage: {
    createFromBuffer: vi.fn((data: Buffer) => ({
      isEmpty: () => data.length === 0,
    })),
  },
}));
afterEach(() => vi.clearAllMocks());
function sender(url = "http://127.0.0.1:1234/") {
  const frame = { url };
  const contents = { mainFrame: frame } as WebContents;
  const event = { sender: contents, senderFrame: frame } as IpcMainInvokeEvent;
  return { contents, event };
}
it("writes exact text from the app main frame", () => {
  const { contents, event } = sender();
  writeClipboardText(
    event,
    "回答\n**原文**",
    contents,
    "http://127.0.0.1:1234",
  );
  expect(clipboard.writeText).toHaveBeenCalledWith("回答\n**原文**");
});
it.each([
  "other-window",
  "child-frame",
  "external-origin",
  "missing-window",
  "non-text",
])("rejects %s clipboard requests", (scenario) => {
  const { contents, event } = sender(
    scenario === "external-origin" ? "https://example.com" : undefined,
  );
  const request = {
    ...event,
    sender: scenario === "other-window" ? ({} as WebContents) : event.sender,
    senderFrame:
      scenario === "child-frame"
        ? ({ url: "http://127.0.0.1:1234/" } as NonNullable<
            IpcMainInvokeEvent["senderFrame"]
          >)
        : event.senderFrame,
  };
  expect(() =>
    writeClipboardText(
      request,
      scenario === "non-text" ? {} : "text",
      scenario === "missing-window" ? undefined : contents,
      "http://127.0.0.1:1234",
    ),
  ).toThrow();
  expect(clipboard.writeText).not.toHaveBeenCalled();
});
it("writes a figure image with its caption from the app main frame", () => {
  const { contents, event } = sender();
  writeClipboardImage(
    event,
    new Uint8Array([137, 80, 78, 71]),
    "图 1",
    contents,
    "http://127.0.0.1:1234",
  );
  expect(nativeImage.createFromBuffer).toHaveBeenCalledWith(
    Buffer.from([137, 80, 78, 71]),
  );
  const [[item]] = vi.mocked(clipboard.write).mock.calls[0];
  expect(item).toMatchObject({
    items: { "image/png": expect.any(Blob), "text/plain": "图 1" },
  });
});
it.each([
  ["external origin", "https://example.com", new Uint8Array([1]), ""],
  ["non-binary data", undefined, "png", ""],
  ["undecodable data", undefined, new Uint8Array(), ""],
  ["non-text caption", undefined, new Uint8Array([1]), {}],
])("rejects image requests with %s", (_, url, data, text) => {
  const { contents, event } = sender(url);
  expect(() =>
    writeClipboardImage(event, data, text, contents, "http://127.0.0.1:1234"),
  ).toThrow();
  expect(clipboard.write).not.toHaveBeenCalled();
});
