import { beginColumnReorder } from "./column-reorder";
import { setColumnDragImage } from "./column-drag-image";
import {
  useState,
  useEffect,
  useRef,
  type DragEvent,
  type ReactNode,
} from "react";
import { Columns3, GripVertical } from "lucide-react";
import type { PaperColumn, PaperLibraryPreferences } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Checkbox } from "@reader/ui/components/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@reader/ui/components/popover";
import { savePaperPreferences } from "./actions";
import {
  columnOrder,
  moveColumn,
  tableColumnLabel,
  visibleColumns,
  type TableColumn,
} from "./columns";

/** A shared drag operation for the table header and column visibility popover. */
export function usePaperColumns(prefs: PaperLibraryPreferences) {
  const order = columnOrder(prefs);
  const visible = visibleColumns(prefs);
  const [dragging, setDragging] = useState<TableColumn | null>(null);
  const preview = useRef<{
    drag: ReturnType<typeof beginColumnReorder>;
    vertical: boolean;
  } | null>(null);
  const dragImage = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      dragImage.current?.();
      preview.current?.drag.cleanup();
    },
    [],
  );
  const finish = () => {
    dragImage.current?.();
    dragImage.current = undefined;
    setDragging(null);
    preview.current?.drag.cleanup();
    preview.current = null;
  };
  const move = (
    from: TableColumn,
    to: TableColumn,
    side: "before" | "after",
  ) => {
    void savePaperPreferences((current) => {
      const next = moveColumn(columnOrder(current), from, to, side);
      const shown = new Set(visibleColumns(current));
      return {
        ...current,
        columnOrder: next,
        columns: next.filter(
          (c): c is PaperColumn => c !== "title" && shown.has(c),
        ),
      };
    });
  };
  const target = (vertical = false) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragging || preview.current?.vertical !== vertical) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      preview.current.drag.update(vertical ? event.clientY : event.clientX);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!dragging || preview.current?.vertical !== vertical) return;
      event.preventDefault();
      event.stopPropagation();
      preview.current.drag.update(vertical ? event.clientY : event.clientX);
      const destination = preview.current.drag.destination;
      if (destination) move(dragging, destination.column, destination.side);
      finish();
    },
  });
  const handle = (
    column: TableColumn,
    vertical = false,
    content?: ReactNode,
    onClick?: () => void,
  ) => (
    <Button
      variant="ghost"
      size={vertical ? "icon-xs" : "xs"}
      className={
        vertical ? "paper-column-grip" : "paper-table-sort cursor-grab"
      }
      aria-label={`移动${tableColumnLabel(column)}列`}
      title={
        vertical
          ? "拖动排序；Tab 聚焦手柄后按 ↑ / ↓ 移动"
          : "拖动排序；Tab 聚焦列名后按 ← / → 移动"
      }
      draggable
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.setData("application/x-reader-paper-column", column);
        event.dataTransfer.effectAllowed = "move";
        const surface =
          event.currentTarget.closest<HTMLElement>("[data-column]");
        finish();
        if (surface) {
          dragImage.current = setColumnDragImage(
            surface,
            event.dataTransfer,
            event.clientX,
            event.clientY,
          );
          preview.current = {
            drag: beginColumnReorder(surface, order, vertical),
            vertical,
          };
        }
        setDragging(column);
      }}
      onDragEnd={finish}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || dragging) event.stopPropagation();
        const backward = event.key === (vertical ? "ArrowUp" : "ArrowLeft");
        const forward = event.key === (vertical ? "ArrowDown" : "ArrowRight");
        if (event.key === "Escape") {
          finish();
          return;
        }
        if (!backward && !forward) return;
        event.preventDefault();
        const items = vertical ? order : visible;
        const to = items[items.indexOf(column) + (backward ? -1 : 1)];
        if (to) move(column, to, backward ? "before" : "after");
      }}
    >
      {vertical ? (
        <GripVertical className="size-3" />
      ) : (
        (content ?? tableColumnLabel(column))
      )}
    </Button>
  );
  return { order, visible, target, handle, cancel: finish };
}

export function PaperColumns({
  controls,
}: {
  controls: ReturnType<typeof usePaperColumns>;
}) {
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) controls.cancel();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="显示的列"
            title="显示的列"
          />
        }
      >
        <Columns3 />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="paper-columns-popover w-52"
        aria-label="显示与排列列"
        {...controls.target(true)}
      >
        {controls.order.map((column) => (
          <div
            key={column}
            data-column={column}
            className="paper-column-option"
          >
            {controls.handle(column, true)}
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
              <Checkbox
                aria-label={`显示${tableColumnLabel(column)}列`}
                checked={controls.visible.includes(column)}
                onCheckedChange={(checked) => {
                  void savePaperPreferences((current) => {
                    const shown = new Set(visibleColumns(current));
                    if (checked) shown.add(column);
                    else shown.delete(column);
                    return {
                      ...current,
                      columnOrder: columnOrder(current),
                      ...(column === "title" ? { showTitle: !!checked } : {}),
                      columns: columnOrder(current).filter(
                        (c): c is PaperColumn => c !== "title" && shown.has(c),
                      ),
                    };
                  });
                }}
              />
              <span className="truncate">{tableColumnLabel(column)}</span>
            </label>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
