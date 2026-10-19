import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { basename, dirname, join, win32 } from "node:path";
import { promisify } from "node:util";
import type { CommandLineStatus } from "../../../packages/reader-core/src/command-line";

// Puts the bundled `reader` command on the user's PATH. macOS links it from
// /usr/local/bin, which login shells include by default, like VS Code's `code`.
// Windows adds the bundled bin directory to the user PATH. Both point into the
// installed app, so updates replace the command together with the app.

const run = promisify(execFile);
export const macLink = "/usr/local/bin/reader";

export const readerBundleId = "io.github.cynicalight.reader";

/**
 * Whether a link target is the command of some copy of Reader.app, so a new
 * install may replace it. An existing bundle must carry Reader's bundle ID; a
 * bundle since moved or deleted is recognised by its Reader.app name only.
 */
export async function isReaderLink(target: string) {
  const bundle = /^(.*\.app)\/Contents\/Resources\/bin\/reader$/.exec(
    target,
  )?.[1];
  if (!bundle) return false;
  let plist: string;
  try {
    plist = await readFile(join(bundle, "Contents", "Info.plist"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    try {
      await lstat(bundle);
      return false;
    } catch {
      return /^Reader(?: \d+)?\.app$/.test(basename(bundle));
    }
  }
  // electron-builder writes XML; anything else is not treated as Reader's.
  const id = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/.exec(
    plist,
  )?.[1];
  return id === readerBundleId;
}

export async function macStatus(
  link: string,
  target: string,
): Promise<CommandLineStatus> {
  const status = { supported: true, installed: false, location: link };
  try {
    const info = await lstat(link);
    if (!info.isSymbolicLink()) return { ...status, conflict: true };
    const current = await readlink(link);
    if (current === target) return { ...status, installed: true };
    return (await isReaderLink(current))
      ? status
      : { ...status, conflict: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return status;
    throw error;
  }
}

function conflictError(location: string) {
  return new Error(`${location} 已被其他程序占用，Reader 没有改动它`);
}
function permissionDenied(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
}

// Runs one shell command as administrator through the system password dialog.
// Paths travel as arguments, never inside the script text.
async function asAdministrator(command: string, ...args: string[]) {
  const quoted = args
    .map((_, i) => `" & quoted form of (item ${i + 1} of argv) & "`)
    .join(" ");
  try {
    await run("/usr/bin/osascript", [
      "-e",
      "on run argv",
      "-e",
      `do shell script "${command} ${quoted}" with administrator privileges`,
      "-e",
      "end run",
      ...args,
    ]);
  } catch (error) {
    if (/-128|User canceled/i.test(String((error as Error).message)))
      throw new Error("已取消");
    throw error;
  }
}

export async function macInstall(link: string, target: string) {
  const status = await macStatus(link, target);
  if (status.conflict) throw conflictError(link);
  if (status.installed) return status;
  try {
    await mkdir(dirname(link), { recursive: true });
    await rm(link, { force: true });
    await symlink(target, link);
  } catch (error) {
    if (!permissionDenied(error) || link !== macLink) throw error;
    await asAdministrator(
      "mkdir -p /usr/local/bin && ln -sfn",
      target,
      macLink,
    );
  }
  return macStatus(link, target);
}

export async function macUninstall(link: string, target: string) {
  const status = await macStatus(link, target);
  if (status.conflict) throw conflictError(link);
  try {
    await rm(link, { force: true });
  } catch (error) {
    if (!permissionDenied(error) || link !== macLink) throw error;
    await asAdministrator("rm -f", macLink);
  }
  return macStatus(link, target);
}

function sameDirectory(a: string, b: string) {
  const normal = (path: string) =>
    path.trim().replace(/^"|"$/g, "").replace(/\\+$/, "").toLowerCase();
  return normal(a) === normal(b);
}
/** The user PATH with `directory` added once at the end, keeping the rest verbatim. */
export function pathWith(raw: string, directory: string) {
  const entries = raw.split(";").filter((entry) => entry.trim());
  if (entries.some((entry) => sameDirectory(entry, directory))) return raw;
  return [...entries, directory].join(";");
}
export function pathWithout(raw: string, directory: string) {
  return raw
    .split(";")
    .filter((entry) => entry.trim() && !sameDirectory(entry, directory))
    .join(";");
}

// Reads or writes HKCU\Environment\Path without expanding %VARIABLES%; a write
// also tells running programs (Explorer, new terminals) that it changed. The
// mode is part of the script, never taken from the inherited environment.
function windowsScript(write: boolean) {
  const action = write
    ? String.raw`$key.SetValue('Path', $env:READER_PATH_VALUE, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    Add-Type -Namespace ReaderCli -Name Native -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'
    $result = [UIntPtr]::Zero
    [void][ReaderCli.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)`
    : String.raw`@{ path = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } | ConvertTo-Json -Compress`;
  return String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
  ${action}
} finally {
  $key.Close()
}
`;
}

/** The PowerShell environment: inherited READER_PATH_* variables never reach it. */
export function windowsEnvironment(env: NodeJS.ProcessEnv, write?: string) {
  const clean = Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^READER_PATH_/i.test(key)),
  );
  return write === undefined ? clean : { ...clean, READER_PATH_VALUE: write };
}

async function windowsUserPath(
  env: NodeJS.ProcessEnv,
  write?: string,
): Promise<string> {
  const systemRoot =
    Object.entries(env).find(
      ([key]) => key.toLowerCase() === "systemroot",
    )?.[1] || "C:\\Windows";
  const { stdout } = await run(
    win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(windowsScript(write !== undefined), "utf16le").toString(
        "base64",
      ),
    ],
    // A cold PowerShell start can take well over 15 s on slow or scanned machines.
    { env: windowsEnvironment(env, write), windowsHide: true, timeout: 60000 },
  );
  if (write !== undefined) return write;
  const value = JSON.parse(stdout.replace(/^\uFEFF/, "")) as { path?: unknown };
  return typeof value.path === "string" ? value.path : "";
}

export interface CommandLineHost {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** The bundled `reader` executable. */
  binary: string;
  env: NodeJS.ProcessEnv;
}

export async function commandLineStatus(
  host: CommandLineHost,
): Promise<CommandLineStatus> {
  // A development build would link the worktree's binary; run it directly instead.
  if (
    !host.packaged ||
    (host.platform !== "darwin" && host.platform !== "win32")
  )
    return { supported: false, installed: false, location: host.binary };
  if (host.platform === "darwin") return macStatus(macLink, host.binary);
  const directory = win32.dirname(host.binary);
  const raw = await windowsUserPath(host.env);
  return {
    supported: true,
    installed: pathWith(raw, directory) === raw,
    location: directory,
  };
}

export async function setCommandLine(
  host: CommandLineHost,
  installed: boolean,
): Promise<CommandLineStatus> {
  const status = await commandLineStatus(host);
  if (!status.supported) throw new Error("开发版不安装命令行工具");
  if (host.platform === "darwin")
    return installed
      ? macInstall(macLink, host.binary)
      : macUninstall(macLink, host.binary);
  const raw = await windowsUserPath(host.env);
  const next = installed
    ? pathWith(raw, status.location)
    : pathWithout(raw, status.location);
  if (next !== raw) await windowsUserPath(host.env, next);
  return { ...status, installed };
}
