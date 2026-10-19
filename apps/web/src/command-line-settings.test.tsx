// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CommandLineStatus } from "@reader/core";
import { CommandLineSettings } from "./CommandLineSettings";

let root: Root;
let host: HTMLDivElement;
const status = (value: Partial<CommandLineStatus>): CommandLineStatus => ({
  supported: true,
  installed: false,
  location: "/usr/local/bin/reader",
  ...value,
});
function desktop(initial: CommandLineStatus, platform = "darwin") {
  const api = {
    platform,
    commandLine: vi.fn(async () => initial),
    setCommandLine: vi.fn(async (installed: boolean) => ({
      ...initial,
      installed,
    })),
  };
  vi.stubGlobal("readerDesktop", api);
  return api;
}
const render = (open = true) =>
  act(async () => {
    root.render(<CommandLineSettings open={open} />);
  });
const button = () => host.querySelector("button")!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("is hidden outside the desktop app", async () => {
  await render();
  expect(host.innerHTML).toBe("");
});

it("installs and uninstalls the command", async () => {
  const api = desktop(status({}));
  await render();
  expect(host.textContent).toContain("可能需要输入密码");
  await act(async () => button().click());
  expect(api.setCommandLine).toHaveBeenCalledWith(true);
  expect(host.textContent).toContain("已安装：/usr/local/bin/reader");
  expect(button().textContent).toContain("卸载 reader 命令");
  await act(async () => button().click());
  expect(api.setCommandLine).toHaveBeenLastCalledWith(false);
  expect(button().textContent).toContain("安装 reader 命令");
});

it("waits until the settings open", async () => {
  const api = desktop(status({}));
  await render(false);
  expect(api.commandLine).not.toHaveBeenCalled();
  expect(button().disabled).toBe(true);
});

it("does not touch another program's reader", async () => {
  desktop(status({ conflict: true }));
  await render();
  expect(button().disabled).toBe(true);
  expect(host.textContent).toContain("已被其他程序占用");
});

it("shows the binary in development builds and errors in place", async () => {
  desktop(
    status({ supported: false, location: "/repo/apps/desktop/bin/reader" }),
  );
  await render();
  expect(host.querySelector("button")).toBeNull();
  expect(host.textContent).toContain("/repo/apps/desktop/bin/reader");

  const api = desktop(status({}), "win32");
  api.setCommandLine.mockRejectedValueOnce(new Error("已取消"));
  await render();
  await act(async () => button().click());
  expect(host.querySelector('[role="status"]')?.textContent).toBe("已取消");
});

it("tells Windows users to open a new terminal", async () => {
  desktop(status({ location: "C:\\Reader\\resources\\bin" }), "win32");
  await render();
  expect(host.textContent).toContain("将加入当前用户的 PATH");
  await act(async () => button().click());
  expect(host.textContent).toContain("新打开的终端");
});
