import {
  clipboard,
  ClipboardItem,
  nativeImage,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

function assertAppSender(
  event: IpcMainInvokeEvent,
  contents: WebContents | undefined,
  appURL: string,
) {
  if (
    !contents ||
    event.sender !== contents ||
    !event.senderFrame ||
    event.senderFrame !== contents.mainFrame ||
    new URL(event.senderFrame.url).origin !== new URL(appURL).origin
  )
    throw new Error("Invalid sender");
}

export function writeClipboardText(
  event: IpcMainInvokeEvent,
  text: unknown,
  contents: WebContents | undefined,
  appURL: string,
) {
  assertAppSender(event, contents, appURL);
  if (typeof text !== "string") throw new Error("Invalid clipboard text");
  return clipboard.writeText(text);
}

// The renderer's async clipboard API is blocked by the permission handler,
// so figure copies go through here with the PNG bytes and an optional caption.
export function writeClipboardImage(
  event: IpcMainInvokeEvent,
  data: unknown,
  text: unknown,
  contents: WebContents | undefined,
  appURL: string,
) {
  assertAppSender(event, contents, appURL);
  if (!(data instanceof Uint8Array) || typeof text !== "string")
    throw new Error("Invalid clipboard image");
  const png = Buffer.from(data);
  if (nativeImage.createFromBuffer(png).isEmpty())
    throw new Error("Invalid clipboard image");
  return clipboard.write([
    new ClipboardItem({
      "image/png": new Blob([png], { type: "image/png" }),
      ...(text && { "text/plain": text }),
    }),
  ]);
}
