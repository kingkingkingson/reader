import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
const execute = promisify(execFile);

export async function libraryDirectory(userData: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(join(userData, "library-location.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return join(userData, "library");
    throw error;
  }
  let directory: unknown;
  try {
    directory = JSON.parse(text)?.directory;
  } catch {}
  if (typeof directory !== "string" || !isAbsolute(directory))
    throw new Error("保存的书库位置无效，请检查 library-location.json。");
  try {
    if (!(await stat(join(directory, "reader.sqlite"))).isFile())
      throw new Error();
  } catch {
    throw new Error("无法访问已设置的书库，请连接存储设备并确认目录仍然存在。");
  }
  return directory;
}

/** Stdin EOF works on Windows too, unlike SIGTERM's forced termination there. */
export function stopLibraryServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return child.exitCode === 0
      ? Promise.resolve()
      : Promise.reject(new Error("本地服务未正常停止"));
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.removeListener("close", closed);
      child.removeListener("error", failed);
      child.stdin?.removeListener("error", failed);
      if (error) reject(error);
      else resolve();
    };
    const closed = (code: number | null) =>
      finish(code === 0 ? undefined : new Error("本地服务未正常停止"));
    const failed = (error: Error) => finish(error);
    const timer = setTimeout(
      () => finish(new Error("本地服务停止超时，未迁移书库")),
      30_000,
    );
    child.once("close", closed);
    child.once("error", failed);
    child.stdin?.once("error", failed);
    if (!child.stdin) finish(new Error("无法停止本地服务"));
    else child.stdin.end();
  });
}

export async function migrateLibrary(
  userData: string,
  source: string,
  destination: string,
  binary: string,
  stop: () => Promise<void>,
): Promise<void> {
  await stop();
  try {
    await execute(
      binary,
      ["--data", source, "--migrate-library", destination],
      {
        windowsHide: true,
        maxBuffer: 64 * 1024,
      },
    );
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(failure.stderr?.trim() || failure.message);
  }
  const temporary = join(userData, `library-location.${randomUUID()}.tmp`);
  try {
    await writeFile(
      temporary,
      JSON.stringify({ directory: destination }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await rename(temporary, join(userData, "library-location.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}
