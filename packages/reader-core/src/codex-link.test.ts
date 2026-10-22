import { expect, it } from "vitest";
import { codexThreadURL } from "./codex-link";

it("opens only an exact local thread id", () => {
  expect(codexThreadURL("01900000-0000-7000-8000-000000000002")).toBe(
    "codex://threads/01900000-0000-7000-8000-000000000002",
  );
  for (const id of [
    null,
    {},
    "",
    "new",
    "../new",
    "https://example.com",
    "01900000-0000-7000-8000-000000000002?prompt=run",
    "01900000-0000-7000-8000-000000000002\n",
  ]) {
    expect(() => codexThreadURL(id)).toThrow();
  }
});
