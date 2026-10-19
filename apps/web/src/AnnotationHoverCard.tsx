import { useEffect, useRef, useState } from "react";
import type { Annotation, ReaderAnnotationTarget } from "@reader/core";
import { Pencil } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
} from "@reader/ui/components/popover";

export function AnnotationHoverCard({
  target,
  annotations,
  onEdit,
}: {
  target: ReaderAnnotationTarget | null;
  annotations: Annotation[];
  onEdit: (annotation: Annotation) => void;
}) {
  const [shown, setShown] = useState<ReaderAnnotationTarget | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inside = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  const close = () => {
    cancel();
    inside.current = false;
    setShown(null);
  };
  const leave = () => {
    cancel();
    timer.current = setTimeout(() => setShown(null), 250);
  };
  useEffect(() => {
    cancel();
    if (target) {
      timer.current = setTimeout(() => setShown(target), 150);
    } else if (!inside.current) leave();
    return cancel;
  }, [target]);
  useEffect(() => {
    const interrupt = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-annotation-preview]")
      )
        return;
      close();
    };
    window.addEventListener("scroll", interrupt, true);
    window.addEventListener("resize", interrupt);
    return () => {
      cancel();
      window.removeEventListener("scroll", interrupt, true);
      window.removeEventListener("resize", interrupt);
    };
  }, []);
  const notes = shown
    ? annotations.filter((a) => shown.ids.includes(a.id) && a.note.trim())
    : [];
  return (
    <Popover
      open={notes.length > 0}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {shown && notes.length > 0 && (
        <PopoverContent
          anchor={{
            getBoundingClientRect: () =>
              new DOMRect(
                shown.anchor.x,
                shown.anchor.top,
                1,
                Math.max(1, shown.anchor.bottom - shown.anchor.top),
              ),
          }}
          side="right"
          align="start"
          sideOffset={12}
          initialFocus={false}
          finalFocus={false}
          className="max-h-[min(24rem,70vh)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto"
          data-annotation-preview=""
          onPointerEnter={() => {
            inside.current = true;
            cancel();
          }}
          onPointerLeave={() => {
            inside.current = false;
            leave();
          }}
          onFocusCapture={() => {
            inside.current = true;
            cancel();
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              inside.current = false;
              leave();
            }
          }}
        >
          <PopoverTitle className="sr-only">批注预览</PopoverTitle>
          {notes.map((annotation) => (
            <div
              key={annotation.id}
              className="border-b pb-2 last:border-0 last:pb-0"
            >
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {annotation.note}
              </p>
              <div className="mt-1 flex justify-end">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="编辑批注"
                  onClick={() => {
                    close();
                    onEdit(annotation);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </PopoverContent>
      )}
    </Popover>
  );
}
