import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import { exportDiagnostics } from "./diagnostics";

/** Self-contained so it works inside the last-resort error boundary. */
export function DiagnosticExport() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <div className="space-y-2 [-webkit-app-region:no-drag]">
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setNotice("");
          try {
            if (await exportDiagnostics())
              setNotice("诊断包已导出，可发送给开发者。");
          } catch {
            setNotice("导出失败，请重试或使用“帮助 → 导出诊断包”。");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Download />
        )}
        导出全部日志
      </Button>
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
