import {
  app,
  dialog,
  Menu,
  MenuItem,
  shell,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { version } from "../package.json";
import { join, dirname } from "node:path";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { platform, release, arch, totalmem } from "node:os";
import { DiagnosticLogs, diagnosticSettings } from "./diagnostics";
import {
  diagnosticError,
  validateDiagnosticEvent,
} from "../../../packages/reader-core/src/diagnostics";

declare const READER_BUILD_COMMIT: string;

export function startDiagnosticService(
  getWindow: () => BrowserWindow | undefined,
  getLibrary: () => string | undefined = () =>
    join(app.getPath("userData"), "library"),
) {
  const directory = join(app.getPath("userData"), "logs");
  const logs = new DiagnosticLogs(directory);
  let settings: Record<string, unknown> = {};
  let exporting: Promise<boolean> | undefined;
  let failurePromise: Promise<void> | undefined;
  const record = (event: string, error?: unknown) =>
    logs.record("desktop", {
      level: error ? "error" : "info",
      event,
      ...(error ? diagnosticError(error) : {}),
    });
  const exportBundle = () =>
    (exporting ||= (async () => {
      const window = getWindow();
      const options = {
        title: "导出诊断包",
        defaultPath: `Reader-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`,
        filters: [{ name: "诊断包", extensions: ["zip"] }],
      };
      const selected =
        window && !window.isDestroyed()
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options);
      if (selected.canceled || !selected.filePath) return false;
      record("diagnostics.export_start");
      // Build beside the destination, then atomically replace only the file the
      // user selected in the native overwrite-confirming save dialog.
      let temporary: string | undefined;
      try {
        temporary = await mkdtemp(
          join(dirname(selected.filePath), ".reader-diagnostics-"),
        );
        const output = join(temporary, "bundle.zip");
        const result = await logs.export(
          output,
          getLibrary(),
          {
            mode: "desktop",
            appVersion: version,
            buildCommit:
              typeof READER_BUILD_COMMIT === "string"
                ? READER_BUILD_COMMIT
                : "unknown",
            packaged: app.isPackaged,
            platform: platform(),
            osRelease: release(),
            architecture: arch(),
            memoryBytes: totalmem(),
            electron: process.versions.electron,
            node: process.versions.node,
            chrome: process.versions.chrome,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          settings,
        );
        await rename(output, selected.filePath);
        record("diagnostics.export_finish");
        shell.showItemInFolder(selected.filePath);
        if (result.missing || logs.droppedWrites)
          await dialog.showMessageBox({
            type: "warning",
            message: "诊断包已导出，部分日志不可用",
            detail: "缺失记录已写入 manifest.json，可将此诊断包发送给开发者。",
          });
        return true;
      } catch (error) {
        record("diagnostics.export_failed", error);
        await dialog.showMessageBox({
          type: "error",
          message: "无法导出诊断包",
          detail: "请检查保存位置和可用磁盘空间后重试。",
        });
        throw new Error("无法导出诊断包");
      } finally {
        if (temporary) await rm(temporary, { recursive: true, force: true });
      }
    })().finally(() => {
      exporting = undefined;
    }));
  const menu = Menu.getApplicationMenu();
  if (menu) {
    const help = menu.items.find((item) => item.role === "help");
    if (help?.submenu) {
      help.label = "帮助";
      help.submenu.append(
        new MenuItem({
          label: "导出诊断包…",
          click: () => void exportBundle().catch(() => {}),
        }),
      );
    } else
      menu.append(
        new MenuItem({
          label: "帮助",
          submenu: [
            {
              label: "导出诊断包…",
              click: () => void exportBundle().catch(() => {}),
            },
          ],
        }),
      );
    Menu.setApplicationMenu(menu);
  } else
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [{ role: "appMenu" as const }]
          : []),
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
        {
          role: "help",
          label: "帮助",
          submenu: [
            {
              label: "导出诊断包…",
              click: () => void exportBundle().catch(() => {}),
            },
          ],
        },
      ]),
    );
  process.on("uncaughtExceptionMonitor", (error) =>
    record("desktop.uncaught", error),
  );
  app.on("child-process-gone", (_event, details) =>
    logs.record("desktop", {
      level: "error",
      event: "child.exited",
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    }),
  );
  // Existing update code uses console warnings. Do not capture arbitrary browser console output.
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      logs.record("desktop", {
        level,
        event: `console.${level}`,
        detail: values
          .map((v) => (v instanceof Error ? v.name : String(v)))
          .join(" ")
          .slice(0, 16000),
      });
      original(...values);
    };
  }
  record("desktop.start");
  const validSender = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    try {
      const window = getWindow();
      return (
        !!window &&
        !window.isDestroyed() &&
        !!event.senderFrame &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame
      );
    } catch {
      return false;
    } // A frame can be disposed between IPC delivery and this check.
  };
  return {
    logs,
    directory,
    export: exportBundle,
    record,
    setSettings(value: unknown) {
      settings = diagnosticSettings(value);
    },
    receive(event: IpcMainEvent, value: unknown) {
      if (!validSender(event)) return;
      const input = validateDiagnosticEvent(value);
      if (input) logs.record("renderer", input);
    },
    receiveSettings(event: IpcMainEvent, value: unknown) {
      if (!validSender(event)) return;
      settings = diagnosticSettings(value);
    },
    invoke(event: IpcMainInvokeEvent) {
      if (!validSender(event)) throw new Error("Invalid sender");
      return exportBundle();
    },
    failure(message: string, detail: string) {
      return (failurePromise ||= (async () => {
        for (;;) {
          const selected = await dialog.showMessageBox({
            type: "error",
            message,
            detail,
            buttons: ["导出诊断包", "退出"],
            defaultId: 0,
            cancelId: 1,
          });
          if (selected.response === 1) return;
          await exportBundle().catch(() => {});
        }
      })().finally(() => {
        failurePromise = undefined;
      }));
    },
  };
}
