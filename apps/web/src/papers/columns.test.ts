import { expect, it } from "vitest";
import { columnOrder, moveColumn, visibleColumns } from "./columns";

it("keeps existing visible order and normalizes saved hidden columns", () => {
  const prefs = { columns: ["year", "authors"] as const };
  const order = columnOrder({ columns: [...prefs.columns] });
  expect(order.slice(0, 3)).toEqual(["title", "year", "authors"]);
  expect(new Set(order).size).toBe(order.length);
  expect(
    visibleColumns({
      columns: ["year", "authors"],
      columnOrder: ["authors", "title", "year", "authors"],
    }),
  ).toEqual(["authors", "title", "year"]);
  expect(visibleColumns({ columns: [] })).toEqual(["title"]);
});

it("moves before or after a target without mutating or losing hidden positions", () => {
  const order = columnOrder({ columns: ["authors", "year", "tags"] });
  const moved = moveColumn(order, "tags", "title", "before");
  expect(moved.slice(0, 4)).toEqual(["tags", "title", "authors", "year"]);
  expect(order.slice(0, 4)).toEqual(["title", "authors", "year", "tags"]);
  expect(
    visibleColumns({ columns: ["authors", "year"], columnOrder: moved }),
  ).toEqual(["title", "authors", "year"]);
  expect(
    visibleColumns({
      columns: ["authors", "year", "tags"],
      columnOrder: moved,
    }),
  ).toEqual(["tags", "title", "authors", "year"]);
  expect(moveColumn(moved, "title", "year", "after").slice(0, 4)).toEqual([
    "tags",
    "authors",
    "year",
    "title",
  ]);
  expect(moveColumn(order, "tags", "tags", "before")).toBe(order);
});
