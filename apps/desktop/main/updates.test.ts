import { describe, expect, it, vi } from "vitest";
import {
  checkDue,
  DailyUpdateChecker,
  day,
  installerChecksum,
  newerRelease,
  retryDelay,
  selectRelease,
} from "./updates";
function release(version = "0.2.0") {
  // GitHub's public /releases/latest JSON contains a tag, not REST assets.
  return { tag_name: `v${version}` };
}
function checksums(...files: string[]) {
  return files.map((name) => `${"a".repeat(64)}  ${name}`).join("\n");
}
const manifest = checksums(
  "Reader-0.2.0-mac-arm64.dmg",
  "Reader-0.2.0-win-x64.exe",
);
describe("release boundaries", () => {
  it("compares versions numerically and never downgrades", () => {
    expect(newerRelease("v0.10.0", "0.9.0")).toBe(true);
    expect(newerRelease("v0.2.0", "0.2.0-beta.1")).toBe(true);
    expect(newerRelease("v0.2.0", "0.2.0")).toBe(false);
    expect(newerRelease("v0.2.0", "1.0.0")).toBe(false);
    expect(() => newerRelease("garbage", "0.1.0")).toThrow();
  });
  it.each([
    null,
    {},
    { tag_name: 2 },
    release("0.2.0-beta.1"),
    release("../0.2.0"),
    release("00.2.0"),
    { ...release(), prerelease: true },
    { ...release(), draft: true },
  ])("rejects invalid or non-stable release metadata: %j", (value) => {
    expect(() =>
      selectRelease(value, "0.1.0", "darwin", "arm64", manifest),
    ).toThrow();
  });
  it("selects only the running platform's official installer", () => {
    const mac = selectRelease(release(), "0.1.0", "darwin", "arm64", manifest);
    const windows = selectRelease(release(), "0.1.0", "win32", "x64", manifest);
    expect(mac.status === "available" && mac.update.installer).toBe(
      "Reader-0.2.0-mac-arm64.dmg",
    );
    expect(windows.status === "available" && windows.update).toEqual({
      version: "0.2.0",
      installer: "Reader-0.2.0-win-x64.exe",
      downloadURL:
        "https://github.com/cynicalight/reader/releases/download/v0.2.0/Reader-0.2.0-win-x64.exe",
      checksumURL:
        "https://github.com/cynicalight/reader/releases/download/v0.2.0/SHA256SUMS.txt",
    });
    expect(
      selectRelease(release(), "0.1.0", "darwin", "x64", manifest).status,
    ).toBe("pending");
    expect(() =>
      selectRelease(release(), "0.1.0", "win32", "arm64", manifest),
    ).toThrow();
    expect(() =>
      selectRelease(release(), "0.1.0", "linux", "x64", manifest),
    ).toThrow();
  });
  it("offers a Mac archive only when listed and never mixes architectures", () => {
    const withArchive =
      manifest +
      "\n" +
      checksums(
        "Reader-0.2.0-mac-arm64.zip",
        "Reader-0.2.0-mac-intel-x64.dmg",
        "Reader-0.2.0-mac-intel-x64.zip",
      );
    const mac = selectRelease(
      release(),
      "0.1.0",
      "darwin",
      "arm64",
      withArchive,
    );
    expect(mac.status === "available" && mac.update.archive).toEqual({
      installer: "Reader-0.2.0-mac-arm64.zip",
      downloadURL:
        "https://github.com/cynicalight/reader/releases/download/v0.2.0/Reader-0.2.0-mac-arm64.zip",
    });
    const intel = selectRelease(
      release(),
      "0.1.0",
      "darwin",
      "x64",
      withArchive,
    );
    expect(intel.status === "available" && intel.update).toMatchObject({
      installer: "Reader-0.2.0-mac-intel-x64.dmg",
      archive: { installer: "Reader-0.2.0-mac-intel-x64.zip" },
    });
    const windows = selectRelease(
      release(),
      "0.1.0",
      "win32",
      "x64",
      withArchive,
    );
    expect(
      windows.status === "available" && windows.update.archive,
    ).toBeUndefined();
    const old = selectRelease(release(), "0.1.0", "darwin", "arm64", manifest);
    expect(old.status === "available" && old.update.archive).toBeUndefined();
  });
  it("waits for the manifest and matching version's installer", () => {
    for (const text of [
      "",
      checksums("Reader-0.1.0-mac-arm64.dmg"),
      checksums("https://example.com/payload.dmg"),
    ])
      expect(
        selectRelease(release(), "0.1.0", "darwin", "arm64", text),
      ).toEqual({ status: "pending" });
  });
  it.each([
    "<html>proxy error</html>",
    "invalid  Reader-0.2.0-mac-arm64.dmg",
    manifest + "\n" + manifest,
    " ".repeat(65537),
  ])("rejects malformed, duplicate or oversized manifests", (text) => {
    expect(() =>
      selectRelease(release(), "0.1.0", "darwin", "arm64", text),
    ).toThrow();
  });
  it("accepts the release script's trailing newline and CRLF", () => {
    expect(
      selectRelease(
        release(),
        "0.1.0",
        "darwin",
        "arm64",
        manifest.replaceAll("\n", "\r\n") + "\r\n",
      ).status,
    ).toBe("available");
  });
  it("requires exactly one matching SHA256", () => {
    const hash = "a".repeat(64);
    const line = `${hash}  Reader.dmg`;
    expect(installerChecksum(line, "Reader.dmg")).toBe(hash);
    expect(() => installerChecksum(line, "Other.dmg")).toThrow();
    expect(() => installerChecksum(`${line}\n${line}`, "Reader.dmg")).toThrow();
  });
});
describe("daily scheduling", () => {
  it("persists the daily interval across restarts and handles clock rollback", () => {
    expect(checkDue({}, day)).toBe(true);
    expect(checkDue({ lastChecked: day }, day + 1)).toBe(false);
    expect(checkDue({ lastChecked: day }, day * 2)).toBe(true);
    expect(checkDue({ lastAttempt: day }, day + retryDelay - 1)).toBe(false);
    expect(checkDue({ lastChecked: day * 3 }, day)).toBe(true);
  });
  it("coalesces simultaneous checks and persists successful completion", async () => {
    const state = {};
    const save = vi.fn().mockResolvedValue(undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(release()))
      .mockResolvedValueOnce(new Response(manifest));
    const checker = new DailyUpdateChecker({
      version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      state,
      save,
      fetch,
      now: () => day,
    });
    const results = await Promise.all([checker.check(), checker.check()]);
    expect(results[0].status).toBe("available");
    expect(results[1]).toEqual(results[0]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://github.com/cynicalight/reader/releases/latest",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        redirect: "follow",
        credentials: "omit",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://github.com/cynicalight/reader/releases/download/v0.2.0/SHA256SUMS.txt",
      expect.objectContaining({ redirect: "follow", credentials: "omit" }),
    );
    expect(state).toEqual({ lastAttempt: day, lastChecked: day });
    expect(checker.isDue()).toBe(false);
  });
  it("does not mark failed or incomplete checks successful", async () => {
    const state = {};
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const checker = new DailyUpdateChecker({
      version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      state,
      save: async () => {},
      fetch,
      now: () => day,
    });
    await expect(checker.check()).rejects.toThrow("503");
    expect(state).toEqual({ lastAttempt: day });
    fetch
      .mockResolvedValueOnce(Response.json(release()))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    expect((await checker.check()).status).toBe("pending");
    expect(state).toEqual({ lastAttempt: day });
  });
});

describe("public release discovery", () => {
  it.each(["0.2.0", "1.0.0"])(
    "does not fetch a manifest or downgrade version %s",
    async (version) => {
      const fetch = vi.fn().mockResolvedValue(Response.json(release()));
      const checker = new DailyUpdateChecker({
        version,
        platform: "darwin",
        arch: "arm64",
        state: {},
        save: async () => {},
        fetch,
      });
      expect(await checker.check()).toEqual({ status: "current" });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("does not use invalid tags to construct a manifest URL", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json(release("../../evil")));
    const checker = new DailyUpdateChecker({
      version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      state: {},
      save: async () => {},
      fetch,
    });
    await expect(checker.check()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("treats a repository without a release as current", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const checker = new DailyUpdateChecker({
      version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      state: {},
      save: async () => {},
      fetch,
    });
    expect(await checker.check()).toEqual({ status: "current" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    new Response("", { status: 503 }),
    new Response("<html>proxy details</html>"),
  ])(
    "does not record success when the manifest cannot be read",
    async (response) => {
      const state = {};
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(Response.json(release()))
        .mockResolvedValueOnce(response);
      const checker = new DailyUpdateChecker({
        version: "0.1.0",
        platform: "darwin",
        arch: "arm64",
        state,
        now: () => day,
        save: async () => {},
        fetch,
      });
      await expect(checker.check()).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(state).toEqual({ lastAttempt: day });
    },
  );
});

describe("update check failures", () => {
  it.each([
    [
      403,
      { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "86520" },
      "",
      /限流.*2 分钟/,
    ],
    [403, { "retry-after": "120" }, "", /限流.*2 分钟/],
    [
      403,
      {
        "retry-after": "invalid",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "86520",
      },
      "",
      /限流.*2 分钟/,
    ],
    [
      403,
      { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "86399" },
      "",
      /限流.*稍后/,
    ],
    [
      429,
      { "retry-after": "Thu, 02 Jan 1970 00:02:00 GMT" },
      "",
      /限流.*2 分钟/,
    ],
    [
      403,
      {},
      JSON.stringify({ message: "You have exceeded a secondary rate limit." }),
      /限流/,
    ],
    [
      429,
      { "retry-after": "invalid", "x-ratelimit-reset": "Infinity" },
      "<html>private proxy details</html>",
      /限流.*稍后/,
    ],
    [403, { "x-ratelimit-remaining": "12" }, "Forbidden", /拒绝访问/],
    [503, {}, "<html>upstream error</html>", /服务暂时不可用/],
  ] as const)(
    "explains HTTP %s using response metadata",
    async (status, headers, body, expected) => {
      const state = {};
      const checker = new DailyUpdateChecker({
        version: "0.1.0",
        platform: "darwin",
        arch: "arm64",
        state,
        save: async () => {},
        now: () => day,
        fetch: async () => new Response(body, { status, headers }),
      });
      const error = await checker.check().catch((error: Error) => error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(expected);
      expect((error as Error).message).toContain(String(status));
      expect((error as Error).message).not.toMatch(
        /<html>|Infinity|NaN|private proxy/,
      );
      expect(state).toEqual({ lastAttempt: day });
    },
  );
});
