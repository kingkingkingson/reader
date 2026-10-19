import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isIP } from "node:net";
import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ProxySettings,
  ProxySettingsState,
  ProxyCheckResult,
} from "../../../packages/reader-core/src/proxy-settings";
import { resolveSystemProxyEnvironment, systemProxyEnvironment } from "./proxy";

const execute = promisify(execFile);

export function validateProxySettings(value: unknown): ProxySettings {
  if (!value || typeof value !== "object") throw new Error("代理设置无效。");
  const config = value as Record<string, unknown>;
  if (config.mode === "system" || config.mode === "direct")
    return { mode: config.mode };
  if (config.mode !== "manual") throw new Error("请选择有效的代理模式。");
  if (typeof config.host !== "string") throw new Error("请输入代理地址。");
  const host = config.host
    .trim()
    .replace(/^\[([^\]]+)\]$/, "$1")
    .toLowerCase();
  const domain =
    host.length <= 253 &&
    host
      .split(".")
      .every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label));
  if (!host || (!isIP(host) && (!domain || /^[\d.]+$/.test(host))))
    throw new Error("代理地址应为 IP 或主机名，不含协议、端口或路径。");
  if (
    typeof config.port !== "number" ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535
  )
    throw new Error("代理端口应为 1–65535 的整数。");
  return { mode: "manual", host, port: config.port };
}

export async function resolveProxyEnvironment(
  settings: ProxySettings,
  inherited: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
) {
  if (settings.mode === "system")
    return resolveSystemProxyEnvironment(inherited, platform);
  return {
    env: systemProxyEnvironment(
      inherited,
      settings.mode === "direct"
        ? {}
        : {
            HTTPEnable: 1,
            HTTPProxy: settings.host,
            HTTPPort: settings.port,
            HTTPSEnable: 1,
            HTTPSProxy: settings.host,
            HTTPSPort: settings.port,
          },
    ),
  };
}

export function electronProxyConfiguration(settings: ProxySettings) {
  if (settings.mode === "system") return { mode: "system" as const };
  if (settings.mode === "direct") return { mode: "direct" as const };
  const host = settings.host.includes(":")
    ? `[${settings.host}]`
    : settings.host;
  const address = `http://${host}:${settings.port}`;
  return {
    mode: "fixed_servers" as const,
    proxyRules: `http=${address};https=${address}`,
    proxyBypassRules: "localhost;127.0.0.1;[::1]",
  };
}

/** Desktop-owned config is read before Go starts, outside the document library. */
export class ProxySettingsService {
  private saved: ProxySettings;
  private saving: Promise<unknown> = Promise.resolve();
  private checking = false;
  private probeController?: AbortController;
  private constructor(
    private readonly directory: string,
    private readonly inherited: NodeJS.ProcessEnv,
    private readonly platform: NodeJS.Platform,
    readonly activeSettings: ProxySettings,
    readonly activeEnvironment: NodeJS.ProcessEnv,
    private readonly warning?: string,
  ) {
    this.saved = activeSettings;
  }

  static async open(
    directory: string,
    inherited: NodeJS.ProcessEnv,
    platform: NodeJS.Platform = process.platform,
  ) {
    let settings: ProxySettings = { mode: "system" };
    let warning: string | undefined;
    try {
      settings = validateProxySettings(
        JSON.parse(
          await readFile(join(directory, "proxy-settings.json"), "utf8"),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        warning = "保存的代理设置无法读取，本次使用系统代理。";
    }
    const resolved = await resolveProxyEnvironment(
      settings,
      inherited,
      platform,
    );
    return new ProxySettingsService(
      directory,
      { ...inherited },
      platform,
      settings,
      resolved.env,
      warning ?? resolved.warning,
    );
  }

  private snapshot(): ProxySettingsState {
    return {
      settings: { ...this.saved },
      restartRequired:
        JSON.stringify(this.saved) !== JSON.stringify(this.activeSettings),
      warning: this.warning,
    };
  }

  async state(): Promise<ProxySettingsState> {
    // Reopening settings must observe a pending save, even when the old
    // renderer has unmounted and discarded its save response.
    await this.saving.catch(() => {});
    return this.snapshot();
  }

  async save(value: unknown): Promise<ProxySettingsState> {
    const settings = validateProxySettings(value);
    const operation = this.saving
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const temporary = join(
          this.directory,
          `proxy-settings.${randomUUID()}.tmp`,
        );
        try {
          await writeFile(temporary, JSON.stringify(settings) + "\n", {
            mode: 0o600,
            flag: "wx",
          });
          await rename(temporary, join(this.directory, "proxy-settings.json"));
          this.saved = settings;
        } finally {
          await rm(temporary, { force: true });
        }
        return this.snapshot();
      });
    this.saving = operation;
    return operation;
  }

  async check(value: unknown, binary: string): Promise<ProxyCheckResult> {
    const settings = validateProxySettings(value);
    if (this.checking) throw new Error("正在检测连接，请稍候。");
    this.checking = true;
    const controller = new AbortController();
    const started = Date.now();
    this.probeController = controller;
    let warning: string | undefined;
    try {
      const resolved =
        settings.mode === "system" && this.activeSettings.mode === "system"
          ? { env: this.activeEnvironment, warning: this.warning }
          : await resolveProxyEnvironment(
              settings,
              this.inherited,
              this.platform,
            );
      warning = resolved.warning;
      // A fresh Go process uses the draft env without changing ongoing API/CLI
      // requests or opening a database. Hide Windows console and bound its life.
      const { stdout } = await execute(binary, ["--probe-network"], {
        env: resolved.env,
        cwd: this.directory,
        timeout: 15000,
        maxBuffer: 16 * 1024,
        windowsHide: true,
        signal: controller.signal,
      });
      const result = JSON.parse(stdout) as ProxyCheckResult;
      if (
        typeof result.connected !== "boolean" ||
        !["direct", "proxy", "unknown"].includes(result.route) ||
        !Number.isFinite(result.elapsedMs) ||
        result.elapsedMs < 0 ||
        (result.connected &&
          (!Number.isInteger(result.status) ||
            result.status! < 100 ||
            result.status! > 599))
      )
        throw new Error();
      return {
        ...result,
        warning,
      };
    } catch {
      return {
        connected: false,
        route: "unknown",
        elapsedMs: Date.now() - started,
        message: "无法完成连接检测，请重试或重新打开 Reader。",
        warning,
      };
    } finally {
      this.checking = false;
      this.probeController = undefined;
    }
  }

  stop() {
    this.probeController?.abort();
  }
}
