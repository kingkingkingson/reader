import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commandLineStatus, setCommandLine } from "./command-line";

// Runs the real PowerShell installer against HKCU\Environment on a Windows
// runner. The original user PATH is restored afterwards.
const run = promisify(execFile);
const key = "HKCU\\Environment";
const probe = "%USERPROFILE%\\reader-cli-probe";

type Value = { type: string; data: string } | null;
async function readPath(): Promise<Value> {
  try {
    const { stdout } = await run("reg", ["query", key, "/v", "Path"]);
    const match = /^\s+Path\s+(REG_\w+)\s+(.*)$/im.exec(stdout);
    return match ? { type: match[1], data: match[2].trimEnd() } : null;
  } catch {
    return null;
  }
}
async function writePath(value: Value) {
  if (value === null)
    await run("reg", ["delete", key, "/v", "Path", "/f"]).catch(() => {});
  else
    await run("reg", [
      "add",
      key,
      "/v",
      "Path",
      "/t",
      value.type,
      "/d",
      value.data,
      "/f",
    ]);
}

describe.runIf(process.platform === "win32")(
  "Windows user PATH installer",
  () => {
    let original: Value = null;
    let directory = "";
    beforeAll(async () => {
      original = await readPath();
      directory = await mkdtemp(join(tmpdir(), "reader-cli-"));
      // An unexpanded entry must survive the installer untouched.
      await writePath({
        type: "REG_EXPAND_SZ",
        data: [original?.data, probe].filter(Boolean).join(";"),
      });
    });
    afterAll(async () => {
      await writePath(original);
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    it("adds and removes the bundled bin directory", async () => {
      const bin = join(directory, "resources", "bin");
      const host = {
        platform: "win32" as const,
        packaged: true,
        binary: join(bin, "reader.exe"),
        env: process.env,
      };
      expect(await commandLineStatus(host)).toEqual({
        supported: true,
        installed: false,
        location: bin,
      });

      // Variables from the launching shell must not turn a status read into a
      // write that replaces the user PATH.
      const before = await readPath();
      await commandLineStatus({
        ...host,
        env: { ...process.env, READER_PATH_WRITE: "1", READER_PATH_VALUE: "" },
      });
      expect(await readPath()).toEqual(before);

      expect((await setCommandLine(host, true)).installed).toBe(true);
      expect((await commandLineStatus(host)).installed).toBe(true);
      const installed = await readPath();
      expect(installed?.type).toBe("REG_EXPAND_SZ");
      const entries = installed!.data.split(";");
      expect(entries).toContain(probe);
      expect(entries.at(-1)).toBe(bin);

      // Installing twice keeps a single entry.
      await setCommandLine(host, true);
      expect(
        (await readPath())!.data.split(";").filter((e) => e === bin),
      ).toHaveLength(1);

      expect((await setCommandLine(host, false)).installed).toBe(false);
      expect((await commandLineStatus(host)).installed).toBe(false);
      const removed = (await readPath())!.data.split(";");
      expect(removed).not.toContain(bin);
      expect(removed).toContain(probe);
    }, 300000);
  },
);
