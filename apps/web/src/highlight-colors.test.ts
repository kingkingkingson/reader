import { expect, it } from "vitest";
import { colorLabel, highlightPalette } from "./annotations";

it("names colors from the user's palette and keeps retired names", () => {
  const palette = [{ value: "#112233", label: "重点" }];
  expect(colorLabel("#112233", palette)).toBe("重点");
  expect(colorLabel("#a985e0", palette)).toBe("紫色");
  expect(highlightPalette({ highlightColors: [] })).toHaveLength(4);
  expect(highlightPalette({ highlightColors: palette })).toBe(palette);
});
