import { useEffect, useState } from "react";
import { LoaderCircle, SquareTerminal } from "lucide-react";
import type { CommandLineStatus } from "@reader/core";
import { Button } from "@reader/ui/components/button";

/** Puts the bundled `reader` command on PATH for terminals and coding agents. */
export function CommandLineSettings({ open }: { open: boolean }) {
  const desktop = window.readerDesktop;
  const [status, setStatus] = useState<CommandLineStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!open || !desktop?.commandLine) return;
    let active = true;
    desktop.commandLine().then(
      (next) => active && setStatus(next),
      (error: Error) => active && setNotice(error.message),
    );
    return () => {
      active = false;
    };
  }, [open, desktop]);
  if (!desktop?.commandLine || !desktop.setCommandLine) return null;
  const change = async (installed: boolean) => {
    setBusy(true);
    setNotice("");
    try {
      const next = await desktop.setCommandLine!(installed);
      setStatus(next);
      if (installed && desktop.platform === "win32")
        setNotice("已加入 PATH，新打开的终端可以运行 reader。");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-7 border-t pt-5">
      <h3 className="mb-3 text-sm font-medium">命令行工具</h3>
      <p className="mb-4 text-xs leading-5 text-muted-foreground">
        在终端运行 <code>reader</code>，让 Claude Code、Codex
        等工具检索、阅读和导入书库中的文档。使用时 Reader 需要保持打开。
      </p>
      {status && !status.supported ? (
        <p className="text-xs leading-5 text-muted-foreground">
          开发版不安装命令行工具，可直接运行{" "}
          <code className="break-all">{status.location}</code>。
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 [-webkit-app-region:no-drag]">
          <Button
            variant="outline"
            disabled={!status || busy || status.conflict}
            onClick={() => void change(!status?.installed)}
          >
            {busy ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : (
              <SquareTerminal />
            )}
            {status?.installed ? "卸载 reader 命令" : "安装 reader 命令"}
          </Button>
          {status && (
            <span className="min-w-0 break-all text-xs text-muted-foreground">
              {status.conflict
                ? `${status.location} 已被其他程序占用`
                : status.installed
                  ? `已安装：${status.location}`
                  : desktop.platform === "darwin"
                    ? "将安装到 /usr/local/bin，可能需要输入密码"
                    : "将加入当前用户的 PATH"}
            </span>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </section>
  );
}
