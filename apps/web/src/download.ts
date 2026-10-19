/** Save a file through the browser download flow (a save dialog in Electron). */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadText(text: string, name: string, mime: string) {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), name);
}
/** A file name from a document title, without characters file systems reject. */
export function fileTitle(title: string) {
  return title.replace(/[/\\:*?"<>|]/g, "-").slice(0, 80);
}
