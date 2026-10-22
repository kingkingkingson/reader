import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

// Exercise the real main-process close/flush handlers; only OS boundaries are fake.
let app: EventEmitter & {
  quit: () => void;
  relaunch: ReturnType<typeof vi.fn>;
};
let window: EventEmitter & {
  close: () => void;
  webContents: EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    mainFrame: { url: string };
  };
};
let ipc: EventEmitter;
let handlers: Map<string, (...args: any[]) => any>;
let migrate: ReturnType<typeof vi.fn>;
let stop: ReturnType<typeof vi.fn>;
let showMessageBox: ReturnType<typeof vi.fn>;
let showOpenDialog: ReturnType<typeof vi.fn>;
const event = () => ({
  sender: window.webContents,
  senderFrame: window.webContents.mainFrame,
});
const move = () => handlers.get("reader:move-library")!(event());

beforeEach(async () => {
  vi.resetModules();
  handlers = new Map();
  ipc = Object.assign(new EventEmitter(), {
    handle: (name: string, fn: (...args: any[]) => any) =>
      handlers.set(name, fn),
  });
  app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    getPath: () => "/userdata",
    whenReady: async () => {},
    requestSingleInstanceLock: () => true,
    setAsDefaultProtocolClient: vi.fn(),
    relaunch: vi.fn(),
    quit: () => {
      app.emit("before-quit", { preventDefault() {} });
    },
  });
  showOpenDialog = vi
    .fn()
    .mockResolvedValue({ canceled: false, filePaths: ["/destination"] });
  showMessageBox = vi.fn().mockResolvedValue({ response: 0 });
  vi.doMock("electron", () => ({
    app,
    ipcMain: ipc,
    dialog: { showOpenDialog, showMessageBox, showErrorBox: vi.fn() },
    session: {
      defaultSession: {
        setProxy: async () => {},
        setPermissionRequestHandler() {},
      },
    },
    nativeTheme: {},
    shell: {},
    BrowserWindow: class extends EventEmitter {
      destroyed = false;
      webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: "http://127.0.0.1:1234/" },
        send: vi.fn(),
        setWindowOpenHandler() {},
      });
      constructor() {
        super();
        window = this;
      }
      isDestroyed() {
        return this.destroyed;
      }
      async loadURL() {}
      close() {
        let prevented = false;
        this.emit("close", {
          preventDefault() {
            prevented = true;
          },
        });
        if (!prevented) {
          this.destroyed = true;
          app.emit("window-all-closed");
        }
      }
    },
  }));
  vi.doMock("node:child_process", () => ({
    spawn: () => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      });
      queueMicrotask(() =>
        child.stdout.write('{"url":"http://127.0.0.1:1234"}\n'),
      );
      return child;
    },
  }));
  vi.doMock("node:fs/promises", () => ({
    readFile: vi.fn(),
    realpath: async (path: string) => path,
    lstat: async () => {
      throw Object.assign(new Error("absent"), { code: "ENOENT" });
    },
  }));
  stop = vi.fn().mockResolvedValue(undefined);
  migrate = vi.fn(
    async (
      _userData,
      _source,
      _target,
      _binary,
      shutdown: () => Promise<void>,
    ) => {
      await shutdown();
    },
  );
  vi.doMock("./library-location", () => ({
    libraryDirectory: async () => "/old/library",
    migrateLibrary: migrate,
    stopLibraryServer: stop,
  }));
  vi.doMock("./agent-path", () => ({ agentPath: async () => "/bin" }));
  vi.doMock("./proxy-settings", () => ({
    ProxySettingsService: {
      open: async () => ({
        activeEnvironment: {},
        activeSettings: {},
        stop() {},
      }),
    },
    electronProxyConfiguration: () => ({}),
  }));
  vi.doMock("./update-service", () => ({
    startUpdateService: async () => ({ stop() {} }),
  }));
  vi.doMock("./diagnostic-service", () => ({
    startDiagnosticService: () => ({
      directory: "/logs",
      logs: { secrets: [], sessionId: "test", record: vi.fn() },
      record: vi.fn(),
      setSettings() {},
      failure: vi.fn(),
    }),
  }));
  vi.doMock("./clipboard", () => ({ writeClipboardText: vi.fn() }));
  vi.doMock("./endnote-discovery", () => ({ discoverEndNote: vi.fn() }));
  vi.doMock("./command-line", () => ({
    commandLineStatus: vi.fn(),
    setCommandLine: vi.fn(),
  }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
  vi.stubGlobal(
    "process",
    Object.assign(Object.create(process), {
      resourcesPath: "/resources",
      on: vi.fn(),
    }),
  );
  await import("./index");
  await vi.waitFor(() =>
    expect(handlers.has("reader:check-updates")).toBe(true),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("waits for flushed reading data, then copies once despite repeated quit events", async () => {
  let complete!: () => void;
  migrate.mockImplementation(async (_u, _s, _d, _b, shutdown) => {
    await shutdown();
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
  });
  const result = move();
  await vi.waitFor(() =>
    expect(window.webContents.send).toHaveBeenCalledWith("reader:flush"),
  );
  expect(migrate).not.toHaveBeenCalled();
  ipc.emit("reader:flushed", event(), null);
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  app.quit();
  ipc.emit("reader:flushed", event(), null);
  expect(migrate).toHaveBeenCalledOnce();
  expect(app.relaunch).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  complete();
  expect(await result).toBe(true);
  expect(migrate).toHaveBeenCalledWith(
    "/userdata",
    "/old/library",
    "/destination/Reader Library",
    expect.any(String),
    expect.any(Function),
  );
  expect(app.relaunch).toHaveBeenCalledOnce();
});

it("cancels migration after a save failure and allows returning to reading", async () => {
  const result = move();
  await vi.waitFor(() =>
    expect(window.webContents.send).toHaveBeenCalledWith("reader:flush"),
  );
  ipc.emit("reader:flushed", event(), "save failed");
  expect(await result).toBe(false);
  expect(migrate).not.toHaveBeenCalled();
  expect(app.relaunch).not.toHaveBeenCalled();
  expect(showMessageBox).toHaveBeenCalledWith(
    window,
    expect.objectContaining({ message: "阅读数据尚未保存" }),
  );
  showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
  expect(await move()).toBe(false);
  expect(showOpenDialog).toHaveBeenCalledTimes(2);
});

it("reopens the old library after shutdown or copy fails", async () => {
  stop.mockRejectedValueOnce(new Error("shutdown failed"));
  const result = move();
  await vi.waitFor(() =>
    expect(window.webContents.send).toHaveBeenCalledWith("reader:flush"),
  );
  ipc.emit("reader:flushed", event(), null);
  expect(await result).toBe(false);
  expect(showMessageBox).toHaveBeenCalledWith(
    window,
    expect.objectContaining({
      message: "书库迁移失败",
      detail: expect.stringContaining("原书库已保留"),
    }),
  );
  expect(handlers.get("reader:library-location")!(event())).toBe(
    "/old/library",
  );
  expect(app.relaunch).toHaveBeenCalledOnce();
});

it("does not close the reader when the native confirmation is cancelled", async () => {
  showMessageBox.mockResolvedValueOnce({ response: 1 });
  expect(await move()).toBe(false);
  expect(window.webContents.send).not.toHaveBeenCalledWith("reader:flush");
  expect(migrate).not.toHaveBeenCalled();
});

it.each(["/destination?question", "/parent?question/destination"])(
  "rejects an unsafe library path before confirming or closing: %s",
  async (selected) => {
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [selected],
    });
    // A missing path guard must fail the test without waiting for a flush.
    showMessageBox.mockResolvedValueOnce({ response: 1 });
    await expect(move()).rejects.toThrow("书库路径不能包含 ?");
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(window.webContents.send).not.toHaveBeenCalledWith("reader:flush");
    expect(stop).not.toHaveBeenCalled();
    expect(migrate).not.toHaveBeenCalled();
    expect(app.relaunch).not.toHaveBeenCalled();
    expect(handlers.get("reader:library-location")!(event())).toBe(
      "/old/library",
    );

    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await move()).toBe(false);
    expect(showOpenDialog).toHaveBeenCalledTimes(2);
  },
);
