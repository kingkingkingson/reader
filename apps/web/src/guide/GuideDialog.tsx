import { ShortcutPanel } from "../shortcuts/ShortcutPanel";
import { useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Star,
  MessageSquare,
  Keyboard,
} from "lucide-react";
import { Button } from "@reader/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@reader/ui/components/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@reader/ui/components/tabs";
import { SceneCanvas } from "./SceneCanvas";
import { scenes } from "./scenes";
import {
  guideTopics,
  onboardingPages,
  type GuideAction,
  type GuidePage,
  type GuideTopic,
} from "./topics";
import type { ReleaseItem } from "./releases";
import "./guide.css";

/** One step: the demonstration, then its explanation. */
function GuideStepView({ page }: { page: GuidePage }) {
  const { step, topic } = page;
  return (
    <>
      <div className="guide-stage">
        <SceneCanvas
          key={step.id}
          scene={scenes[step.scene]}
          label={`演示：${step.title}`}
        />
      </div>
      <DialogHeader className="gap-1.5">
        <p className="text-xs text-muted-foreground">
          {topic.title}
          {topic.steps.length > 1 &&
            ` · ${page.index + 1}/${topic.steps.length}`}
        </p>
        <DialogTitle className="text-base">{step.title}</DialogTitle>
        <DialogDescription className="leading-6">{step.body}</DialogDescription>
      </DialogHeader>
    </>
  );
}

function Dots({ count, current }: { count: number; current: number }) {
  if (count < 2) return <span />;
  return (
    <span className="guide-dots" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} data-active={i === current || undefined} />
      ))}
    </span>
  );
}

const arrowKeys =
  (back: () => void, next: () => void) => (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('[role="tablist"]')) return;
    if (event.key === "ArrowLeft") back();
    if (event.key === "ArrowRight") next();
  };

/** The first-run walkthrough of every onboarding topic. */
export function OnboardingDialog({
  open,
  onFinish,
}: {
  open: boolean;
  onFinish: () => void;
}) {
  const pages = onboardingPages();
  const [index, setIndex] = useState(0);
  const page = pages[index];
  const last = index === pages.length - 1;
  const back = () => setIndex((i) => Math.max(0, i - 1));
  const next = () => (last ? onFinish() : setIndex(index + 1));
  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(_, details) => details.cancel()}
    >
      <DialogContent
        className="guide-dialog sm:max-w-2xl"
        showCloseButton={false}
        onKeyDown={arrowKeys(back, () => !last && next())}
      >
        <GuideStepView page={page} />
        <DialogFooter className="guide-footer">
          <Dots count={pages.length} current={index} />
          <span className="sr-only" aria-live="polite">
            第 {index + 1} 步，共 {pages.length} 步
          </span>
          {index > 0 && (
            <Button variant="outline" onClick={back}>
              上一步
            </Button>
          )}
          <Button autoFocus onClick={next}>
            {last ? "开始使用" : "下一步"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TopicPanel({
  topic,
  onNextTopic,
  onPreviousTopic,
  onAction,
}: {
  topic: GuideTopic;
  onNextTopic?: () => void;
  onPreviousTopic?: () => void;
  onAction: (action: GuideAction) => void;
}) {
  const [index, setIndex] = useState(0);
  const step = Math.min(index, topic.steps.length - 1);
  const back = () => (step > 0 ? setIndex(step - 1) : onPreviousTopic?.());
  const next = () =>
    step < topic.steps.length - 1 ? setIndex(step + 1) : onNextTopic?.();
  return (
    <div className="guide-panel" onKeyDown={arrowKeys(back, next)}>
      <GuideStepView page={{ topic, step: topic.steps[step], index: step }} />
      <div className="guide-footer">
        <Dots count={topic.steps.length} current={step} />
        {topic.action && (
          <Button variant="ghost" onClick={() => onAction(topic.action!.kind)}>
            {topic.action.label}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          aria-label="上一步"
          disabled={step === 0 && !onPreviousTopic}
          onClick={back}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="下一步"
          disabled={step === topic.steps.length - 1 && !onNextTopic}
          onClick={next}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Every guide topic, browsable at any time. */
export function GuideDialog({
  open,
  onOpenChange,
  topic,
  onTopicChange,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: string;
  onTopicChange: (topic: string) => void;
  onAction: (action: GuideAction) => void;
}) {
  const index = Math.max(
    0,
    guideTopics.findIndex((t) => t.id === topic),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="guide-dialog guide-browser sm:max-w-4xl">
        <DialogTitle className="sr-only">指南</DialogTitle>
        <Tabs
          orientation="vertical"
          value={topic === "shortcuts" ? "shortcuts" : guideTopics[index].id}
          onValueChange={(value) => onTopicChange(String(value))}
          className="guide-layout"
        >
          <div className="guide-nav">
            <h2 className="mb-3 px-2 text-sm font-medium">指南</h2>
            <TabsList variant="line" aria-label="指南主题" className="w-full">
              <TabsTrigger value="shortcuts" className="h-9 px-2">
                <Keyboard />
                快捷键
              </TabsTrigger>
              <div className="my-2 w-full border-t" role="separator" />
              {guideTopics.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="h-9 px-2">
                  <t.icon />
                  {t.title}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="shortcuts" className="min-w-0">
            <ShortcutPanel />
          </TabsContent>
          {guideTopics.map((t, i) => (
            <TabsContent key={t.id} value={t.id} className="min-w-0">
              <TopicPanel
                topic={t}
                onAction={onAction}
                onPreviousTopic={
                  i > 0 ? () => onTopicChange(guideTopics[i - 1].id) : undefined
                }
                onNextTopic={
                  i < guideTopics.length - 1
                    ? () => onTopicChange(guideTopics[i + 1].id)
                    : undefined
                }
              />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** What changed in this version; topics link to their demonstration. */
export function ReleaseNotesDialog({
  open,
  version,
  items,
  onClose,
  onShowTopic,
}: {
  open: boolean;
  version: string;
  items: ReleaseItem[];
  onClose: () => void;
  onShowTopic: (topic: string) => void;
}) {
  const [opening, setOpening] = useState(false);
  const visitGitHub = async (issues: boolean) => {
    const url = `https://github.com/cynicalight/reader${issues ? "/issues/new/choose" : ""}`;
    setOpening(true);
    try {
      if (window.readerDesktop?.openExternal) {
        await window.readerDesktop.openExternal(url);
      } else {
        const opened = window.open(url, "_blank");
        if (!opened) throw new Error("无法打开浏览器，请允许弹出窗口后重试。");
        opened.opener = null;
      }
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "无法打开链接，请重试。",
      );
    } finally {
      setOpening(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="guide-dialog sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Reader {version} 更新内容</DialogTitle>
          <DialogDescription>
            {items.length ? "本次更新的主要变化" : "已更新到新版本。"}
          </DialogDescription>
        </DialogHeader>
        {items.length > 0 && (
          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.title} className="space-y-1">
                <p className="font-medium">{item.title}</p>
                {item.body && (
                  <p className="leading-6 text-muted-foreground">{item.body}</p>
                )}
                {item.topic && guideTopics.some((t) => t.id === item.topic) && (
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => onShowTopic(item.topic!)}
                  >
                    查看演示
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm leading-6 text-muted-foreground">
          如果 Reader 对你有帮助，欢迎在 GitHub 点个
          Star。遇到问题或有建议，也欢迎提交 Issue。
        </p>
        <DialogFooter className="flex-col sm:flex-col">
          <Button
            autoFocus
            disabled={opening}
            onClick={() => void visitGitHub(false)}
          >
            <Star />去 GitHub 点 Star
          </Button>
          <Button
            variant="outline"
            disabled={opening}
            onClick={() => void visitGitHub(true)}
          >
            <MessageSquare />
            已点 Star，去提 Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
