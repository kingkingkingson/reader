import { expect, it } from "vitest";
import { clampDetailWidth, resizeBoundary } from "./resize";

it("moves only the two columns on either side of a boundary", () => {
  const widths = { title: 400, authors: 160, year: 64 };
  expect(resizeBoundary(widths, "authors", "year", -30)).toEqual({
    authors: 130,
    year: 94,
  });
  // Store both sides, including the title, so table minimum width cannot absorb the drag.
  expect(resizeBoundary(widths, "title", "authors", 50)).toEqual({
    title: 450,
    authors: 110,
  });
});

it("stops at the minimum width of either column", () => {
  const widths = { title: 200, authors: 160, year: 64 };
  expect(resizeBoundary(widths, "authors", "year", 100)).toEqual({
    authors: 176,
    year: 48,
  });
  expect(resizeBoundary(widths, "title", "authors", -500)).toEqual({
    title: 160,
    authors: 200,
  });
});

it("keeps the detail panel within its range", () => {
  expect(clampDetailWidth(100)).toBe(280);
  expect(clampDetailWidth(455.6)).toBe(456);
  expect(clampDetailWidth(2000)).toBe(720);
});

it("resizes a reordered boundary with the title on the right", () => {
  expect(
    resizeBoundary({ authors: 160, title: 200 }, "authors", "title", 30),
  ).toEqual({ authors: 190, title: 170 });
  expect(
    resizeBoundary({ authors: 160, title: 200 }, "authors", "title", 90),
  ).toEqual({ authors: 200, title: 160 });
});

it("resizes the last column without taking space from the menu", () => {
  expect(resizeBoundary({ title: 400 }, "title", undefined, 80)).toEqual({
    title: 480,
  });
  expect(resizeBoundary({ title: 400 }, "title", undefined, -800)).toEqual({
    title: 160,
  });
});

it("keeps the flexible title width when resizing the final metadata column", () => {
  expect(
    resizeBoundary({ title: 400, authors: 160 }, "authors", undefined, 40),
  ).toEqual({ title: 400, authors: 200 });
});
