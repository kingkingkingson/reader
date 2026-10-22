import { useEffect, useState } from "react";
import { FolderOpen, LoaderCircle } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@reader/ui/components/dialog";

export function LibraryLocationSettings({ open }: { open: boolean }) {
  const desktop = window.readerDesktop;
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !desktop?.libraryLocation) return;
    let active = true;
    desktop.libraryLocation().then(
      (value) => {
        if (active) setDirectory(value);
      },
      (error) => {
        if (active) setError(error.message);
      },
    );
    return () => {
      active = false;
    };
  }, [open, desktop]);
  if (!desktop?.libraryLocation || !desktop.moveLibrary) return null;
  const move = async () => {
    setBusy(true);
    setError("");
    try {
      await desktop.moveLibrary!();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h3 className="mb-3 text-sm font-medium">书库位置</h3>
      <p className="mb-3 break-all text-xs leading-5 text-muted-foreground">
        {directory || "正在读取位置"}
      </p>
      <p className="mb-4 text-xs leading-5 text-muted-foreground">
        PDF、图书、笔记、批注和阅读记录一起保存。选择新位置后，将在该目录下新建
        Reader Library
        文件夹，复制整个书库并重启。原目录保留，已有文件不会被覆盖。
      </p>
      <Button
        variant="outline"
        disabled={!directory || busy}
        onClick={() => void move()}
        className="transition-transform active:scale-[0.98] motion-reduce:transform-none"
      >
        <FolderOpen />
        更改位置
      </Button>
      {error && (
        <p
          role="alert"
          className="mt-3 text-xs text-destructive animate-in fade-in-0 motion-reduce:animate-none"
        >
          {error}
        </p>
      )}
      <Dialog open={busy} onOpenChange={(_, details) => details.cancel()}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>正在更改书库位置</DialogTitle>
          <DialogDescription>
            请完成目录选择和确认。迁移过程中请保持 Reader
            打开，完成后会自动重启。
          </DialogDescription>
          <LoaderCircle
            aria-label="处理中"
            className="size-5 animate-spin motion-reduce:animate-none"
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
