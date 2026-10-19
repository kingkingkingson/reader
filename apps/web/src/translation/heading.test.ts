import { expect, it } from "vitest";
import { translationHeadingLevel } from "./heading";

it("keeps document titles above numbered section ranks", () => {
  expect(
    translationHeadingLevel({ label: "doc_title", text: "WISE-Fix" }),
  ).toBe(1);
  expect(
    translationHeadingLevel({
      label: "paragraph_title",
      text: "1 Introduction",
    }),
  ).toBe(2);
  expect(
    translationHeadingLevel({ label: "paragraph_title", text: "1引言" }),
  ).toBe(2);
  expect(
    translationHeadingLevel({
      label: "paragraph_title",
      text: "1.1 Background",
    }),
  ).toBe(3);
  expect(
    translationHeadingLevel({ label: "paragraph_title", text: "1.1.1 Detail" }),
  ).toBe(4);
  expect(
    translationHeadingLevel({ label: "paragraph_title", text: "A.1 Appendix" }),
  ).toBe(3);
  expect(
    translationHeadingLevel({ label: "paragraph_title", text: "第 2 章" }),
  ).toBe(2);
  expect(
    translationHeadingLevel({ label: "paragraph_title", text: "Abstract" }),
  ).toBe(2);
  expect(
    translationHeadingLevel({
      label: "paragraph_title",
      text: "1.1 Details",
      level: 2,
    }),
  ).toBe(2);
  expect(
    translationHeadingLevel({ label: "text", text: "1 Introduction" }),
  ).toBeUndefined();
  expect(
    translationHeadingLevel({ label: "figure_title", text: "Figure 1" }),
  ).toBeUndefined();
});
