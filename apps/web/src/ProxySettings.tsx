import { useEffect, useRef, useState } from "react";
import type {
  ProxySettings as Configuration,
  ProxySettingsState,
  ProxyCheckResult,
} from "@reader/core";
import { LoaderCircle, CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@reader/ui/components/select";

const labels = { system: "跟随系统", manual: "手动 HTTP 代理", direct: "直连" };

export function ProxySettings({ open }: { open: boolean }) {
  const desktop = window.readerDesktop;
  const [state, setState] = useState<ProxySettingsState>();
  const [mode, setMode] = useState<Configuration["mode"]>("system");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("7890");
  const [result, setResult] = useState<ProxyCheckResult>();
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<
    "load" | "save" | "check" | "restart" | null
  >(null);
  const pending = operation !== null;
  const revision = useRef(0);
  const applyState = (next: ProxySettingsState) => {
    setState(next);
    setMode(next.settings.mode);
    if (next.settings.mode === "manual") {
      setHost(next.settings.host);
      setPort(String(next.settings.port));
    }
  };
  useEffect(() => {
    if (!open || !desktop?.proxySettings) return;
    const current = ++revision.current;
    setOperation("load");
    setState(undefined);
    setError("");
    setResult(undefined);
    void desktop
      .proxySettings()
      .then((next) => {
        if (current === revision.current) applyState(next);
      })
      .catch((cause: Error) => {
        if (current === revision.current) setError(cause.message);
      })
      .finally(() => {
        if (current === revision.current) setOperation(null);
      });
    return () => {
      revision.current++;
    };
  }, [open, desktop]);
  if (
    !desktop?.proxySettings ||
    !desktop.saveProxySettings ||
    !desktop.checkProxy
  )
    return null;
  const draft: Configuration =
    mode === "manual"
      ? { mode, host: host.trim(), port: Number(port) }
      : { mode };
  const changed =
    !!state && JSON.stringify(draft) !== JSON.stringify(state.settings);
  const edited = () => {
    revision.current++;
    setResult(undefined);
    setError("");
  };
  const perform = async (action: "save" | "check" | "restart") => {
    const current = revision.current;
    setOperation(action);
    setError("");
    try {
      if (mode === "manual" && !/^\d+$/.test(port.trim()))
        throw new Error("代理端口应为 1–65535 的整数。");
      if (action === "save") {
        const next = await desktop.saveProxySettings!(draft);
        if (current === revision.current) {
          applyState(next);
        }
      } else if (action === "check") {
        setResult(undefined);
        const next = await desktop.checkProxy!(draft);
        if (current === revision.current) {
          setResult(next);
        }
      } else await desktop.restart?.();
    } catch (cause) {
      if (current === revision.current) setError((cause as Error).message);
    } finally {
      if (current === revision.current) setOperation(null);
    }
  };
  return (
    <section className="space-y-5">
      <div>
        <h3 id="proxy-mode-label" className="mb-3 text-sm font-medium">
          代理
        </h3>
        <Select
          value={mode}
          disabled={pending || !state}
          onValueChange={(value) => {
            if (
              value === "manual" ||
              value === "system" ||
              value === "direct"
            ) {
              edited();
              setMode(value);
            }
          }}
        >
          <SelectTrigger aria-labelledby="proxy-mode-label" className="w-48">
            <SelectValue>{labels[mode]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(labels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === "manual" && (
          <div className="mt-3 flex gap-3">
            <label className="min-w-0 flex-1 text-xs text-muted-foreground">
              地址
              <Input
                aria-label="代理地址"
                className="mt-1"
                value={host}
                placeholder="127.0.0.1"
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
                onChange={(event) => {
                  edited();
                  setHost(event.target.value);
                }}
              />
            </label>
            <label className="w-28 shrink-0 text-xs text-muted-foreground">
              端口
              <Input
                aria-label="代理端口"
                className="mt-1"
                value={port}
                placeholder="7890"
                inputMode="numeric"
                autoComplete="off"
                disabled={pending}
                onChange={(event) => {
                  edited();
                  setPort(event.target.value);
                }}
              />
            </label>
          </div>
        )}
        {mode === "manual" && (
          <p className="mt-2 text-xs text-muted-foreground">
            填写 Clash 的 HTTP 或 Mixed 端口。
          </p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="outline"
            disabled={pending || !changed}
            onClick={() => void perform("save")}
          >
            {operation === "save" && <LoaderCircle className="animate-spin" />}
            保存代理设置
          </Button>
          {(state?.restartRequired || mode === "system") && (
            <Button
              variant="outline"
              disabled={pending || changed || !desktop.restart}
              onClick={() => void perform("restart")}
            >
              重启 Reader
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {state?.restartRequired
            ? "代理配置已变化，重启 Reader 后生效。"
            : mode === "system"
              ? "切换系统代理后，请重启 Reader 再检测。"
              : "修改后需保存并重启 Reader。"}
        </p>
        {state?.warning && (
          <p className="mt-2 text-xs text-muted-foreground">{state.warning}</p>
        )}
      </div>
      <div>
        <h3 className="mb-3 text-sm font-medium">连接检测</h3>
        <p className="text-xs text-muted-foreground">chatgpt.com/robots.txt</p>
        <Button
          className="mt-3"
          variant="outline"
          disabled={pending || !state}
          onClick={() => void perform("check")}
        >
          {operation === "check" && <LoaderCircle className="animate-spin" />}
          检测连接
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          {mode === "system" &&
          state?.settings.mode === "system" &&
          !state.restartRequired
            ? "检测当前已生效的系统代理配置。"
            : "检测上方配置；修改后保存并重启生效。"}
        </p>
        {result && (
          <div
            className="mt-3 flex items-start gap-2 text-sm"
            role="status"
            aria-live="polite"
          >
            {result.connected && result.status && result.status < 400 ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0" />
            ) : (
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            )}
            <div>
              <p>
                {result.connected
                  ? `已收到响应 · HTTP ${result.status}`
                  : result.message || "连接失败。"}
                {` · ${result.elapsedMs} ms · ${{ proxy: "经代理", direct: "直连", unknown: "路由未知" }[result.route]}`}
              </p>
              {result.connected && result.status && result.status >= 400 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  网络可达，目标网站拒绝或未能处理请求；此结果不代表 ChatGPT
                  登录或模型调用可用。
                </p>
              )}
              {result.warning && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {result.warning}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
