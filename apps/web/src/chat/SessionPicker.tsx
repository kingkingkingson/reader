import { useEffect, useState } from "react";
import { Plus, Pencil, LoaderCircle } from "lucide-react";
import { api } from "@reader/api";
import type { DocumentChatSession } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@reader/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@reader/ui/components/dialog";
import { Input } from "@reader/ui/components/input";
import { toast } from "sonner";

const statusLabels = {
  running: "运行中",
  completed: "已完成",
  failed: "未完成",
  cancelled: "已停止",
  interrupted: "已中断",
};
export function SessionPicker({
  documentId,
  sessions,
  current,
  provider,
  running = false,
  onChange,
  onRefresh,
}: {
  documentId: string;
  sessions: DocumentChatSession[];
  current?: DocumentChatSession;
  provider: string;
  running?: boolean;
  onChange: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const status = running ? "running" : current?.latestRun?.status;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setRenaming(false);
    setSaving(false);
  }, [current?.id]);
  const create = async () => {
    setSaving(true);
    try {
      const session = await api.createChatSession(
        documentId,
        provider || "api",
      );
      await onRefresh();
      onChange(session.id);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const update = async (title: string) => {
    if (!current) return;
    setSaving(true);
    try {
      await api.updateChatSession(documentId, current.id, { title });
      await onRefresh();
      setRenaming(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b px-3 py-2">
      <div className="flex min-w-0 items-center gap-1">
        <Select
          value={current?.id ?? null}
          onValueChange={(id) => {
            if (id) onChange(id);
          }}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1" aria-label="选择会话">
            <SelectValue className="truncate">
              {current?.title ?? "加载会话…"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sessions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="max-w-44 truncate">{s.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {s.latestRun ? statusLabels[s.latestRun.status] : ""}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="重命名会话"
          disabled={!current || saving}
          onClick={() => {
            setName(current?.title ?? "");
            setRenaming(true);
          }}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="新建会话"
          disabled={saving}
          onClick={() => void create()}
        >
          <Plus />
        </Button>
      </div>
      {status && (
        <span
          className="flex items-center justify-end gap-1 text-xs text-muted-foreground"
          role="status"
        >
          {status === "running" && (
            <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
          )}
          {statusLabels[status]}
        </span>
      )}
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void update(name);
            }}
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              aria-label="会话名称"
              autoFocus
            />
            <Button type="submit" disabled={saving || !name.trim()}>
              保存
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
