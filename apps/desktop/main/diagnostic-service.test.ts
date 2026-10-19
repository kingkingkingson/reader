import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  directory: "",
  save: vi.fn(),
  message: vi.fn(),
  menu: vi.fn(),
  reveal: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    getPath: () => mocks.directory,
    getVersion: () => "0.5.1",
    isPackaged: false,
    on: vi.fn(),
  },
  dialog: { showSaveDialog: mocks.save, showMessageBox: mocks.message },
  shell: { showItemInFolder: mocks.reveal },
  Menu: {
    getApplicationMenu: () => null,
    buildFromTemplate: (value: unknown) => value,
    setApplicationMenu: mocks.menu,
  },
}));
import { startDiagnosticService } from "./diagnostic-service";

it("keeps native export usable after failure and rejects events from other frames", async () => {
  mocks.directory = mkdtempSync(join(tmpdir(), "reader-native-diagnostics-"));
  const originalWarn = console.warn,
    originalError = console.error;
  const originalListeners = process.listeners("uncaughtExceptionMonitor");
  const mainFrame = {};
  const webContents = { mainFrame };
  const window = {
    webContents,
    isDestroyed: () => false,
  } as unknown as Electron.BrowserWindow;
  const service = startDiagnosticService(() => window);
  try {
    expect(JSON.stringify(mocks.menu.mock.calls)).toContain("导出诊断包");
    const recorded = vi.spyOn(service.logs, "record");
    const input = { level: "info", event: "api.finish", status: 200 };
    service.receive(
      { sender: {}, senderFrame: mainFrame } as Electron.IpcMainEvent,
      input,
    );
    service.receive(
      { sender: webContents, senderFrame: {} } as Electron.IpcMainEvent,
      input,
    );
    expect(recorded).not.toHaveBeenCalled();
    service.receive(
      { sender: webContents, senderFrame: mainFrame } as Electron.IpcMainEvent,
      input,
    );
    expect(recorded).toHaveBeenCalledWith("renderer", input);
    expect(() =>
      service.invoke({
        sender: {},
        senderFrame: mainFrame,
      } as Electron.IpcMainInvokeEvent),
    ).toThrow("Invalid sender");
    const output = join(mocks.directory, "report.zip");
    mocks.save.mockResolvedValue({ canceled: false, filePath: output });
    mocks.message
      .mockResolvedValueOnce({ response: 0 })
      .mockResolvedValueOnce({ response: 1 });
    const exporter = vi
      .spyOn(service.logs, "export")
      .mockImplementation(async (path) => {
        writeFileSync(path, "test ZIP");
        return { files: 1, missing: 0, filename: "test.zip" };
      });
    const failure = service.failure("服务已停止", "可导出后退出");
    const simultaneous = service.failure("界面已停止", "另一条故障");
    expect(simultaneous).toBe(failure);
    await failure;
    expect(exporter).toHaveBeenCalledOnce();
    expect(mocks.reveal).toHaveBeenCalledWith(output);
    expect(mocks.message.mock.calls[0][0].buttons).toEqual([
      "导出诊断包",
      "退出",
    ]);
    mocks.save.mockResolvedValue({ canceled: true });
    expect(await service.export()).toBe(false);
    mocks.save.mockResolvedValue({
      canceled: false,
      filePath: join(mocks.directory, "missing", "report.zip"),
    });
    mocks.message.mockResolvedValue({ response: 0 });
    await expect(service.export()).rejects.toThrow("无法导出诊断包");
    expect(mocks.message).toHaveBeenCalledWith(
      expect.objectContaining({ message: "无法导出诊断包" }),
    );
    const before = recorded.mock.calls.length;
    Object.defineProperty(webContents, "mainFrame", {
      get: () => {
        throw new Error("Frame disposed");
      },
    });
    expect(() =>
      service.receive(
        {
          sender: webContents,
          senderFrame: mainFrame,
        } as Electron.IpcMainEvent,
        input,
      ),
    ).not.toThrow();
    expect(recorded.mock.calls.length).toBe(before);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    for (const listener of process.listeners("uncaughtExceptionMonitor"))
      if (!originalListeners.includes(listener))
        process.removeListener("uncaughtExceptionMonitor", listener);
    rmSync(mocks.directory, { recursive: true, force: true });
  }
});
