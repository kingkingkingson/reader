import { toast } from "sonner";
export async function copyText(text: string, successMessage?: string) {
  try {
    if (window.readerDesktop?.writeClipboardText)
      await window.readerDesktop.writeClipboardText(text);
    else await navigator.clipboard.writeText(text);
    if (successMessage)
      toast.success(successMessage, { id: "reader-clipboard" });
    return true;
  } catch {
    toast.error("复制失败，请选择文字后复制。", { id: "reader-clipboard" });
    return false;
  }
}
export async function copyImage(url: string, text: string) {
  try {
    // Pass the blob as a promise so Safari keeps the click's user activation.
    const image = fetch(url).then((response) => {
      if (!response.ok) throw new Error(response.statusText);
      return response.blob();
    });
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": image,
        ...(text && { "text/plain": new Blob([text], { type: "text/plain" }) }),
      }),
    ]);
    toast.success("已复制图片", { id: "reader-clipboard" });
  } catch {
    toast.error("复制图片失败", { id: "reader-clipboard" });
  }
}
