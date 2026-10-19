import { expect, it } from "vitest";
import { isPromptText, promptDisplay, promptRole } from "./prompt-block";

it("recognizes a prompt template and bolds its labels", () => {
  expect(promptRole("Prompt 1: Weakness-Specific Verifier Synthesis")).toBe(
    "title",
  );
  expect(promptRole("INPUT: w, schema")).toBe("field");
  expect(promptRole("CONSTRAINTS: Use only P.")).toBe("field");
  expect(promptRole("提示词 1：验证器合成")).toBe("title");
  expect(promptRole("输入：w 以及模式。")).toBe("field");
  expect(promptRole("The template summarizes this interface.")).toBeUndefined();
  expect(
    isPromptText("Prompt 1: Title\nINPUT: w\nTASK: Generate obligations."),
  ).toBe(true);
  expect(isPromptText("Precondition identifies elements.")).toBe(false);

  expect(
    promptDisplay(
      "INPUT: w, schema.",
      "INPUT: w, schema.",
      "输入：w 以及模式。",
      0,
    ),
  ).toBe("**输入：**w 以及模式。");
  expect(
    promptDisplay(
      "INPUT: w, schema. Separate bindings.",
      "Separate bindings.",
      "分离绑定。",
      1,
    ),
  ).toBe("分离绑定。");
  expect(
    promptDisplay(
      "Prompt 1: Title",
      "Prompt 1: Title",
      "提示词 1：验证器合成",
      0,
    ),
  ).toBe("**提示词 1：验证器合成**");
  expect(
    promptDisplay(
      "Prompt 1: Title\nTASK: Generate.",
      "TASK: Generate.",
      "任务：生成义务。",
      1,
    ),
  ).toBe("**任务：**生成义务。");
});
