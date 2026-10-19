/** Snapshot once at drag start; the browser moves the image without React renders. */
export function setColumnDragImage(
  source: HTMLElement,
  transfer: DataTransfer,
  clientX: number,
  clientY: number,
) {
  const origin = source.getBoundingClientRect();
  const table = source.matches("th") ? source.closest("table") : null;
  const cells = table
    ? [
        ...table.querySelectorAll<HTMLElement>(
          "th[data-column], td[data-column]",
        ),
      ].filter((cell) => cell.dataset.column === source.dataset.column)
    : [source];
  const bottom = Math.min(
    window.innerHeight,
    source.closest(".paper-list-pane")?.getBoundingClientRect().bottom ??
      window.innerHeight,
  );
  // Rows are in display order; stop measuring once below the visible pane.
  const visible: { cell: HTMLElement; rect: DOMRect }[] = [];
  let height = origin.height;
  for (const cell of cells) {
    const rect = cell === source ? origin : cell.getBoundingClientRect();
    if (cell !== source && rect.top >= bottom) break;
    if (cell === source || rect.bottom > origin.top) {
      visible.push({ cell, rect });
      if (table)
        height = Math.max(height, Math.min(bottom, rect.bottom) - origin.top);
    }
  }
  const preview = document.createElement("div");
  preview.className = `paper-column-drag-preview${table ? " paper-table" : ""}`;
  preview.setAttribute("aria-hidden", "true");
  preview.inert = true;
  Object.assign(preview.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${origin.width}px`,
    height: `${height}px`,
  });
  for (const { cell, rect } of visible) {
    const clone = cell.cloneNode(true) as HTMLElement;
    // A snapshot must not introduce duplicate label/input IDs into the live page.
    for (const element of [
      clone,
      ...clone.querySelectorAll<HTMLElement>("[id], [for]"),
    ]) {
      element.removeAttribute("id");
      element.removeAttribute("for");
    }
    clone.removeAttribute("data-column-dragging");
    clone.removeAttribute("data-column-drop");
    Object.assign(clone.style, {
      width: "100%",
      height: `${rect.height}px`,
      margin: "0",
      transform: "none",
    });
    if (table) {
      const part = document.createElement("table");
      part.className = table.className;
      Object.assign(part.style, {
        position: "absolute",
        top: `${rect.top - origin.top}px`,
        width: "100%",
        margin: "0",
        tableLayout: "fixed",
      });
      const group = document.createElement(
        cell.tagName === "TH" ? "thead" : "tbody",
      );
      const row = document.createElement("tr");
      row.className = cell.parentElement?.className || "";
      row.append(clone);
      group.append(row);
      part.append(group);
      preview.append(part);
    } else preview.append(clone);
  }
  document.body.append(preview);
  transfer.setDragImage(preview, clientX - origin.left, clientY - origin.top);
  // Snapshot capture happens after dragstart, before the next frame is painted.
  const frame = requestAnimationFrame(() => preview.remove());
  for (const { cell } of visible) cell.classList.add("paper-column-source");
  return () => {
    cancelAnimationFrame(frame);
    preview.remove();
    for (const { cell } of visible)
      cell.classList.remove("paper-column-source");
  };
}
