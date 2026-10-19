import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const execFile = Object.assign(() => {}, { [promisify.custom]: execute });
  return { execFile };
});
import { childProxyEnvironment } from "./proxy";

beforeEach(() => {
  execute.mockReset();
});
afterEach(() => vi.restoreAllMocks());

it("reads Windows settings with hidden, bounded PowerShell and passes them to the child", async () => {
  execute.mockResolvedValue({
    stdout: '\uFEFF{"proxy":"127.0.0.1:7890","bypass":null}',
    stderr: "",
  });
  const result = await childProxyEnvironment(
    { SystemRoot: "D:\\Windows", Http_Proxy: "http://old:80" },
    "win32",
  );
  expect(result.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
  expect(result.Http_Proxy).toBeUndefined();
  const [file, args, options] = execute.mock.calls[0];
  expect(file).toBe(
    "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  expect(options).toMatchObject({ windowsHide: true, timeout: 10000 });
  expect(args).toContain("-NoProfile");
  expect(args).toContain("-NonInteractive");
  const source = Buffer.from(args[args.length - 1], "base64").toString(
    "utf16le",
  );
  expect(source).toContain("WinHttpGetIEProxyConfigForCurrentUser");
  expect(source).toContain("GlobalFree");
});

it("does not launch a proxy reader on unsupported platforms", async () => {
  expect(
    await childProxyEnvironment({ HTTP_PROXY: "http://existing:80" }, "linux"),
  ).toEqual({ HTTP_PROXY: "http://existing:80" });
  expect(execute).not.toHaveBeenCalled();
});

it.each(["win32", "darwin"] as const)(
  "keeps startup usable when %s proxy reading fails",
  async (platform) => {
    execute.mockRejectedValue(new Error("private native command output"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parent = {
      PATH: "/bin",
      HTTPS_PROXY: "http://inherited:7890",
      NO_PROXY: "localhost,127.0.0.1",
    };
    const result = await childProxyEnvironment(parent, platform);
    expect(result).toEqual(parent);
    expect(result).not.toBe(parent);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "无法应用系统代理，Reader 将沿用启动环境。",
    );
  },
);

it.each([
  "not JSON",
  '{"autoDetect":true}',
  '{"autoConfigUrl":"https://example.org/proxy.pac"}',
])(
  "falls back without throwing for unusable Windows output: %s",
  async (stdout) => {
    execute.mockResolvedValue({ stdout, stderr: "" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const parent = { HTTPS_PROXY: "http://inherited:7890" };
    expect(await childProxyEnvironment(parent, "win32")).toEqual(parent);
  },
);

it("tolerates unsupported bypass rules and applies the proxy", async () => {
  execute.mockResolvedValue({
    stdout: '{"proxy":"localhost:7890","bypass":"foo*bar"}',
    stderr: "",
  });
  const parent = { HTTPS_PROXY: "http://inherited:7890" };
  const result = await childProxyEnvironment(parent, "win32");
  expect(result.HTTP_PROXY).toBe("http://localhost:7890");
  expect(result.HTTPS_PROXY).toBe("http://localhost:7890");
  expect(result.NO_PROXY).toBe("localhost,127.0.0.1,::1");
});
