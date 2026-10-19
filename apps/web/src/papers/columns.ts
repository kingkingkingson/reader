import type { PaperColumn, PaperLibraryPreferences } from "@reader/core";
import { columnLabels, defaultColumns } from "./model";

export type TableColumn = "title" | PaperColumn;
export const tableColumnLabel = (column: TableColumn) =>
  column === "title" ? "标题" : columnLabels[column];

/** Keep hidden columns in the same order so showing them restores their place. */
export function columnOrder(prefs: PaperLibraryPreferences): TableColumn[] {
  const all: TableColumn[] = [
    "title",
    ...(Object.keys(columnLabels) as PaperColumn[]),
  ];
  return [
    ...new Set([
      ...(prefs.columnOrder || ["title", ...(prefs.columns || defaultColumns)]),
      ...all,
    ]),
  ].filter((c): c is TableColumn => all.includes(c as TableColumn));
}

export function visibleColumns(prefs: PaperLibraryPreferences): TableColumn[] {
  const shown = new Set<TableColumn>([
    "title",
    ...(prefs.columns || defaultColumns),
  ]);
  return columnOrder(prefs).filter((column) => shown.has(column));
}

export function moveColumn(
  order: TableColumn[],
  from: TableColumn,
  to: TableColumn,
  side: "before" | "after",
) {
  if (from === to || !order.includes(from) || !order.includes(to)) return order;
  const next = order.filter((column) => column !== from);
  next.splice(next.indexOf(to) + (side === "after" ? 1 : 0), 0, from);
  return next;
}
