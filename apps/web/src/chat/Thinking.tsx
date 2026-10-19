import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@reader/ui/components/collapsible";

export function Thinking({
  text,
  active,
  incomplete = false,
}: {
  text: string;
  active: boolean;
  incomplete?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="chat-thinking">
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" />}
        className="chat-thinking-toggle"
      >
        <ChevronRight
          size={14}
          className={open ? "rotate-90" : ""}
          aria-hidden="true"
        />
        {active ? "正在思考…" : incomplete ? "思考过程（未完成）" : "思考过程"}
      </CollapsibleTrigger>
      <CollapsibleContent className="chat-thinking-content">
        {text}
      </CollapsibleContent>
    </Collapsible>
  );
}
