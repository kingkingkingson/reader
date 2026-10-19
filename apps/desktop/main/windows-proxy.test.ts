import { describe, expect, it, vi } from "vitest";
vi.mock("node:os", () => ({ hostname: () => "Reader-PC.office" }));
import { windowsProxySettings } from "./windows-proxy";
import { systemProxyEnvironment } from "./proxy";

const convert = (settings: unknown, env: NodeJS.ProcessEnv = {}) =>
  systemProxyEnvironment(env, windowsProxySettings(settings));

// Clash Verge Rev's Windows DEFAULT_BYPASS, including every private /16.
const clashBypass = [
  "localhost",
  "127.*",
  "192.168.*",
  "10.*",
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*`),
  "*.local",
  "<local>",
].join(";");

describe("Windows system proxy", () => {
  it("uses one manual address for HTTP and HTTPS", () => {
    const env = convert({ proxy: "127.0.0.1:7890", autoDetect: true });
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.HTTPS_PROXY).toBe(env.HTTP_PROXY);
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,::1");
  });
  it("supports protocol-specific proxies and bypass hosts", () => {
    const env = convert({
      proxy: "http=localhost:7890;https=[::1]:7891;ftp=unused:21",
      bypass: "localhost;*.example.org;10.0.0.1",
    });
    expect(env.HTTP_PROXY).toBe("http://localhost:7890");
    expect(env.HTTPS_PROXY).toBe("http://[::1]:7891");
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,::1,.example.org,10.0.0.1");
  });
  it("handles no configuration and ignores stale bypass rules", () => {
    const env = convert(
      { proxy: null, bypass: "<local>", autoDetect: false },
      {
        Http_Proxy: "http://stale:80",
        All_Proxy: "http://stale:80",
        NO_PROXY: "*",
      },
    );
    expect(env).toEqual({
      NO_PROXY: "localhost,127.0.0.1,::1",
      no_proxy: "localhost,127.0.0.1,::1",
    });
    expect(convert({})).toEqual(env);
  });
  it("does not invent a proxy for an unconfigured protocol", () => {
    const env = convert({ proxy: "https=proxy.example:8080" });
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBe("http://proxy.example:8080");
  });
  it("accepts an HTTP URL with the default port", () => {
    expect(convert({ proxy: "http://proxy.example" }).HTTPS_PROXY).toBe(
      "http://proxy.example",
    );
  });
  it("preserves Clash's default bypass ranges without bypassing every host", () => {
    const parent = { HTTPS_PROXY: "http://old:80", NO_PROXY: "*" };
    const env = convert(
      { proxy: "127.0.0.1:7890", bypass: clashBypass, autoDetect: true },
      parent,
    );
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.no_proxy).toBe(env.NO_PROXY);
    const bypass = env.NO_PROXY!.split(",");
    expect(bypass).toEqual([
      "localhost",
      "127.0.0.1",
      "::1",
      "127.0.0.0/8",
      "127.0.0.0-127.255.255.255",
      "192.168.0.0/16",
      "192.168.0.0-192.168.255.255",
      "10.0.0.0/8",
      "10.0.0.0-10.255.255.255",
      ...Array.from({ length: 16 }, (_, i) => [
        `172.${16 + i}.0.0/16`,
        `172.${16 + i}.0.0-172.${16 + i}.255.255`,
      ]).flat(),
      ".local",
      "reader-pc.office",
      "reader-pc",
    ]);
    expect(bypass).not.toContain("*");
    expect(parent).toEqual({ HTTPS_PROXY: "http://old:80", NO_PROXY: "*" });
  });
  it.each([
    ["10.*", "10.0.0.0/8", "10.0.0.0-10.255.255.255"],
    ["10.*.*.*", "10.0.0.0/8", "10.0.0.0-10.255.255.255"],
    ["192.168.*.*", "192.168.0.0/16", "192.168.0.0-192.168.255.255"],
    ["192.168.7.*", "192.168.7.0/24", "192.168.7.0-192.168.7.255"],
  ])("converts trailing IPv4 wildcards: %s", (rule, cidr, range) => {
    expect(convert({ proxy: "localhost:7890", bypass: rule }).NO_PROXY).toBe(
      `localhost,127.0.0.1,::1,${cidr},${range}`,
    );
  });

  it("tolerates unsupported bypass rules without failing the proxy", () => {
    const env = convert({
      proxy: "127.0.0.1:7890",
      bypass: "example.com;foo*bar;172.*.1.*;valid.org;999.*.*.1",
    });
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    // Unsupported rules (foo*bar, 172.*.1.*, 999.*.*.1) are skipped
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,::1,example.com,valid.org");
  });

  it("preserves <local> expansion behavior", () => {
    const env = convert({
      proxy: "localhost:7890",
      bypass: "<local>;*.example.org",
    });
    const bypass = env.NO_PROXY!.split(",");
    expect(bypass).toContain("localhost");
    expect(bypass).toContain("reader-pc.office");
    expect(bypass).toContain("reader-pc");
    expect(bypass).toContain(".example.org");
  });
  it("accepts <local> case-insensitively and deduplicates local hosts", () => {
    expect(
      convert({
        proxy: "localhost:7890",
        bypass: "localhost;<LOCAL>;<local>",
      }).NO_PROXY,
    ).toBe("localhost,127.0.0.1,::1,reader-pc.office,reader-pc");
  });
  it.each([
    null,
    [],
    { proxy: 123 },
    { autoConfigUrl: "https://example.org/proxy.pac" },
    { autoDetect: true },
    { proxy: "socks=localhost:7890" },
    { proxy: "https=http://proxy.example/path" },
    { proxy: "https=user:password@proxy.example" },
    { proxy: "https=proxy.example:99999" },
  ])("rejects unreadable or unsupported settings: %j", (raw) => {
    expect(() => convert(raw)).toThrow();
  });
});
