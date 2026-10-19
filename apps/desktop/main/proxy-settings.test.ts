import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  readFile,
  rm,
  mkdir,
  writeFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { execute, resolveSystem } = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveSystem: vi.fn(),
}));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(() => {}, { [promisify.custom]: execute }) };
});
vi.mock("./proxy", async (original) => ({
  ...(await original<typeof import("./proxy")>()),
  resolveSystemProxyEnvironment: resolveSystem,
}));
import {
  ProxySettingsService,
  validateProxySettings,
  resolveProxyEnvironment,
  electronProxyConfiguration,
} from "./proxy-settings";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "reader-proxy-"));
  execute.mockReset();
  resolveSystem.mockReset();
  resolveSystem.mockImplementation(async (env) => ({ env: { ...env } }));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it.each(["win32", "darwin"] as const)(
  "persists manual proxy on %s and applies it only after reopening",
  async (platform) => {
    const inherited = {
      PATH: "/bin",
      HTTP_PROXY: "http://old:80",
      All_Proxy: "socks5://old:80",
      NO_PROXY: "*",
    };
    const service = await ProxySettingsService.open(
      directory,
      inherited,
      platform,
    );
    const settings = { mode: "manual", host: " [::1] ", port: 7890 };
    const next = await service.save(settings);
    expect(next.settings).toEqual({ mode: "manual", host: "::1", port: 7890 });
    expect(next.restartRequired).toBe(true);
    expect(service.activeEnvironment).toEqual(inherited);
    const reopened = await ProxySettingsService.open(
      directory,
      inherited,
      platform,
    );
    expect((await reopened.state()).restartRequired).toBe(false);
    expect(reopened.activeEnvironment).toEqual({
      PATH: "/bin",
      HTTP_PROXY: "http://[::1]:7890",
      http_proxy: "http://[::1]:7890",
      HTTPS_PROXY: "http://[::1]:7890",
      https_proxy: "http://[::1]:7890",
      NO_PROXY: "localhost,127.0.0.1,::1",
      no_proxy: "localhost,127.0.0.1,::1",
    });
    expect(await readdir(directory)).toEqual(["proxy-settings.json"]);
    expect(
      JSON.parse(
        await readFile(join(directory, "proxy-settings.json"), "utf8"),
      ),
    ).toEqual(next.settings);
  },
);

it("retains the previous state when validation or atomic replacement fails", async () => {
  const service = await ProxySettingsService.open(directory, {}, "linux");
  await expect(
    service.save({ mode: "manual", host: "http://secret@host", port: 0 }),
  ).rejects.toThrow();
  expect(await readdir(directory)).toEqual([]);
  await mkdir(join(directory, "proxy-settings.json"));
  await expect(service.save({ mode: "direct" })).rejects.toThrow();
  expect((await service.state()).settings).toEqual({ mode: "system" });
  expect(await readdir(directory)).toEqual(["proxy-settings.json"]);
});

it("serializes saves and allows saving the active setting to cancel a pending restart", async () => {
  const service = await ProxySettingsService.open(directory, {}, "linux");
  await Promise.all([
    service.save({ mode: "direct" }),
    service.save({ mode: "system" }),
  ]);
  expect((await service.state()).restartRequired).toBe(false);
  expect(
    JSON.parse(await readFile(join(directory, "proxy-settings.json"), "utf8")),
  ).toEqual({ mode: "system" });
});

it("waits for pending saves when another settings session reads state", async () => {
  const service = await ProxySettingsService.open(directory, {}, "linux");
  const saving = service.save({
    mode: "manual",
    host: "127.0.0.1",
    port: 7897,
  });
  const reading = service.state();
  const [saved, reopened] = await Promise.all([saving, reading]);
  expect(reopened).toEqual(saved);
  expect(reopened.settings).toEqual({
    mode: "manual",
    host: "127.0.0.1",
    port: 7897,
  });
  expect(reopened.restartRequired).toBe(true);
});

it("tests the active system environment even after OS settings change", async () => {
  const original = {
    HTTPS_PROXY: "http://127.0.0.1:7890",
    NO_PROXY: "localhost",
  };
  resolveSystem.mockResolvedValueOnce({ env: original });
  const service = await ProxySettingsService.open(directory, {}, "darwin");
  resolveSystem.mockResolvedValue({
    env: { HTTPS_PROXY: "http://127.0.0.1:7897" },
  });
  execute.mockResolvedValue({
    stdout:
      '{"connected":false,"route":"proxy","elapsedMs":4,"message":"连接失败"}',
  });
  await service.check({ mode: "system" }, "/probe");
  expect(resolveSystem).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0][2].env).toEqual(original);
  expect(service.activeEnvironment).toEqual(original);
});

it("falls back from corrupt config and reports system-reading failure inside settings", async () => {
  await writeFile(join(directory, "proxy-settings.json"), "{broken");
  let service = await ProxySettingsService.open(directory, {}, "win32");
  expect((await service.state()).warning).toContain("无法读取");
  await service.save({ mode: "system" });
  resolveSystem.mockResolvedValue({ env: {}, warning: "无法读取系统代理" });
  service = await ProxySettingsService.open(directory, {}, "win32");
  expect((await service.state()).warning).toBe("无法读取系统代理");
});

it.each(["win32", "darwin"] as const)(
  "probes the unsaved draft in a hidden bounded child on %s",
  async (platform) => {
    const service = await ProxySettingsService.open(
      directory,
      { PATH: "/bin", NO_PROXY: "*" },
      platform,
    );
    execute.mockResolvedValue({
      stdout: JSON.stringify({
        connected: true,
        route: "proxy",
        status: 403,
        elapsedMs: 20,
      }),
    });
    const result = await service.check(
      { mode: "manual", host: "127.0.0.1", port: 7890 },
      "/bin/reader-server",
    );
    expect(result).toMatchObject({
      connected: true,
      route: "proxy",
      status: 403,
    });
    expect(execute).toHaveBeenCalledWith(
      "/bin/reader-server",
      ["--probe-network"],
      expect.objectContaining({
        cwd: directory,
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 16384,
        env: expect.objectContaining({
          HTTPS_PROXY: "http://127.0.0.1:7890",
          NO_PROXY: "localhost,127.0.0.1,::1",
        }),
      }),
    );
    expect((await service.state()).settings).toEqual({ mode: "system" });
    expect(await readdir(directory)).toEqual([]);
  },
);

it("bounds concurrent checks, aborts on quit, and sanitizes native failures", async () => {
  const service = await ProxySettingsService.open(directory, {}, "linux");
  execute.mockImplementation(
    (_binary, _args, { signal }) =>
      new Promise((_accept, reject) =>
        signal.addEventListener("abort", () =>
          reject(new Error("private native output")),
        ),
      ),
  );
  const check = service.check({ mode: "direct" }, "/bin/reader-server");
  await expect(
    service.check({ mode: "direct" }, "/bin/reader-server"),
  ).rejects.toThrow("正在检测");
  // Let resolution reach the subprocess before aborting it.
  await vi.waitFor(() => expect(execute).toHaveBeenCalled());
  service.stop();
  expect(await check).toMatchObject({
    connected: false,
    route: "unknown",
    message: "无法完成连接检测，请重试或重新打开 Reader。",
  });
  execute.mockResolvedValue({
    stdout: '{"connected":true,"route":"proxy","elapsedMs":0}',
  });
  expect(
    (await service.check({ mode: "direct" }, "/bin/reader-server")).connected,
  ).toBe(false);
});

it("keeps failure routing and elapsed time reported by the Go probe", async () => {
  const service = await ProxySettingsService.open(directory, {}, "linux");
  execute.mockResolvedValue({
    stdout:
      '{"connected":false,"route":"proxy","elapsedMs":12001,"message":"连接超时"}',
  });
  expect(
    await service.check(
      { mode: "manual", host: "127.0.0.1", port: 7890 },
      "/probe",
    ),
  ).toMatchObject({
    connected: false,
    route: "proxy",
    elapsedMs: 12001,
    message: "连接超时",
  });
});

it("direct mode clears inherited proxies and Electron keeps loopback direct", async () => {
  const inherited = {
    PATH: "/bin",
    HTTPS_PROXY: "http://old:80",
    ALL_PROXY: "http://old:80",
    http_proxy: "http://old:80",
    NO_PROXY: "*",
  };
  const { env } = await resolveProxyEnvironment(
    { mode: "direct" },
    inherited,
    "win32",
  );
  expect(env).toEqual({
    PATH: "/bin",
    NO_PROXY: "localhost,127.0.0.1,::1",
    no_proxy: "localhost,127.0.0.1,::1",
  });
  expect(resolveSystem).not.toHaveBeenCalled();
  expect(
    electronProxyConfiguration({ mode: "manual", host: "::1", port: 7890 }),
  ).toEqual({
    mode: "fixed_servers",
    proxyRules: "http=http://[::1]:7890;https=http://[::1]:7890",
    proxyBypassRules: "localhost;127.0.0.1;[::1]",
  });
});

it.each([
  "http://host",
  "user:secret@host",
  "host:7890",
  "host/path",
  "host name",
  "999.1.1.1",
  "",
  "-bad.example",
])("rejects invalid manual host %s", (host) => {
  expect(() =>
    validateProxySettings({ mode: "manual", host, port: 7890 }),
  ).toThrow();
});
it.each([0, 65536, 1.5, NaN, "7890"])(
  "rejects invalid manual port %s",
  (port) => {
    expect(() =>
      validateProxySettings({ mode: "manual", host: "localhost", port }),
    ).toThrow();
  },
);
