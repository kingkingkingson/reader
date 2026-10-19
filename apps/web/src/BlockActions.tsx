import type { ReactNode } from "react";
import { Copy, Expand, Sparkles } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import type { PDFBlock, PDFBlockAction } from "@reader/core";
export function BlockActions({
  block,
  onAction,
}: {
  block: PDFBlock;
  onAction: (block: PDFBlock, action: PDFBlockAction) => void;
}) {
  const action = (name: PDFBlockAction, label: string, icon: ReactNode) => (
    <Button
      data-block-action={name}
      size="icon-xs"
      variant="secondary"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onAction(block, name);
      }}
    >
      {icon}
    </Button>
  );
  return (
    <div className="block-actions">
      {block.image && action("preview", "放大查看原图", <Expand />)}
      {action("copy", block.image ? "复制图片" : "复制此段", <Copy />)}
      {action(
        "explain",
        block.image ? "AI 解释此图" : "询问 AI 此段",
        <Sparkles />,
      )}
    </div>
  );
}
