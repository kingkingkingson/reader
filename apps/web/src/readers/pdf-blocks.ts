import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BlockActions } from "../BlockActions";
import {
  blockRegions,
  isPDFPageDecoration,
  type PDFBlock,
  type PDFBlockAction,
  type PDFBlockFragment,
  type PDFLocation,
} from "@reader/core";
// Includes the toolbar's padding, which bridges the gap above the block.
const blockActionTarget = "[data-block-action], .block-actions";
export function hitBlock(
  blocks: PDFBlock[],
  page: number,
  x: number,
  y: number,
) {
  const hits = blocks.flatMap((block) => {
    if (isPDFPageDecoration(block) || !(block.image || block.text.trim()))
      return [];
    return blockRegions(block)
      .filter(
        (part) =>
          part.page === page &&
          x >= part.bounds.x &&
          y >= part.bounds.y &&
          x <= part.bounds.x + part.bounds.width &&
          y <= part.bounds.y + part.bounds.height,
      )
      .map((part) => ({ block, part }));
  });
  hits.sort(
    (a, b) =>
      a.part.bounds.width * a.part.bounds.height -
      b.part.bounds.width * b.part.bounds.height,
  );
  return hits[0]?.block;
}
export function referenceBlock(
  blocks: PDFBlock[],
  location: PDFLocation,
  text: string,
) {
  const rect = location.rects?.[0];
  if (rect) {
    const hit = hitBlock(
      blocks,
      location.page,
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    if (hit) return hit;
  }
  const excerpt = (location.quote || text)
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
  if (excerpt) {
    const needle = excerpt.slice(0, 48);
    const match = blocks.find(
      (block) =>
        !isPDFPageDecoration(block) &&
        blockRegions(block).some(
          (part) =>
            part.page === location.page &&
            part.text.replace(/\s+/g, " ").toLocaleLowerCase().includes(needle),
        ),
    );
    if (match) return match;
  }
  if (location.x !== undefined && location.y !== undefined)
    return hitBlock(blocks, location.page, location.x, location.y);
}
// Pointer observation leaves the PDF text and links as the event targets.
export class PDFBlockOverlay {
  private blocks: PDFBlock[] = [];
  private fades = new Map<HTMLElement, Animation>();
  private overlay: HTMLDivElement;
  private root: Root;
  private active?: PDFBlock;
  private hovered?: string;
  private linkedId: string | null = null;
  private focusId: string | null = null;
  private focus = document.createElement("div");
  private referenceFlash = document.createElement("div");
  private referenceFlashId: string | null = null;
  private referenceFlashTimer?: ReturnType<typeof setTimeout>;
  private linked = document.createElement("div");
  private searchBlocks = new Map<string, HTMLDivElement>();
  private regionExtras = new Map<HTMLElement, HTMLElement[]>();
  private pressed?: { id: string; x: number; y: number };
  private textFocusTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private host: HTMLElement,
    private onAction: (
      block: PDFBlock,
      action: PDFBlockAction,
    ) => void = () => {},
    private onHover: (block: PDFBlock | null) => void = () => {},
    private onFocus: (block: PDFBlock) => boolean = () => false,
  ) {
    this.overlay = document.createElement("div");
    this.overlay.className = "reader-block-hover";
    this.root = createRoot(this.overlay);
    this.linked.className = "reader-block-hover reader-block-counterpart";
    this.linked.setAttribute("aria-hidden", "true");
    this.focus.className = "reader-block-hover reader-block-focus";
    this.focus.setAttribute("aria-hidden", "true");
    this.referenceFlash.className = "reader-block-reference-flash";
    this.referenceFlash.setAttribute("aria-hidden", "true");
    this.focus.addEventListener("animationend", () => {
      if (!this.focusId) this.focus.remove();
    });
    host.addEventListener("pointermove", this.move);
    host.addEventListener("pointerleave", this.leave);
    host.addEventListener("pointerdown", this.press);
    host.addEventListener("click", this.click, true);
    host.addEventListener("pointerup", this.move);
    host.addEventListener("scroll", this.clear, { passive: true });
  }
  setBlocks(blocks: PDFBlock[]) {
    this.blocks = blocks.filter((b) => !isPDFPageDecoration(b));
    // Refreshing the same parsed blocks must not dismiss a stationary hover.
    if (this.active) {
      const updated = this.blocks.find((b) => b.id === this.active?.id);
      if (!updated || JSON.stringify(updated) !== JSON.stringify(this.active))
        this.clear();
    }
    this.repaint();
  }
  setSearchBlocks(blockIds: string[]) {
    const wanted = new Set(blockIds);
    for (const [id, element] of this.searchBlocks) {
      if (!wanted.has(id)) {
        this.clearRegionExtras(element);
        element.remove();
        this.searchBlocks.delete(id);
      }
    }
    for (const id of wanted) {
      if (!this.searchBlocks.has(id)) {
        const element = document.createElement("div");
        element.className = "reader-block-search-hit";
        element.setAttribute("aria-hidden", "true");
        this.searchBlocks.set(id, element);
      }
    }
    this.repaint();
  }
  private hide(element: HTMLElement, immediate = false) {
    if (!element.parentElement) return;
    if (
      immediate ||
      !element.animate ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      this.fades.get(element)?.cancel();
      this.fades.delete(element);
      element.remove();
      return;
    }
    if (this.fades.has(element)) return;
    element.inert = true;
    const animation = element.animate(
      [{ opacity: getComputedStyle(element).opacity }, { opacity: 0 }],
      { duration: 160, easing: "ease-out", fill: "forwards" },
    );
    this.fades.set(element, animation);
    void animation.finished
      .then(() => {
        if (this.fades.get(element) !== animation) return;
        element.remove();
        this.fades.delete(element);
        animation.cancel();
      })
      .catch(() => {});
  }
  private show(element: HTMLElement, page: HTMLElement) {
    this.fades.get(element)?.cancel();
    this.fades.delete(element);
    element.inert = false;
    if (element.parentElement !== page) page.append(element);
  }
  private leave = () => this.dismiss(false);
  clear = () => {
    this.cancelTextFocus();
    this.dismiss(true);
  };
  private dismiss(immediate: boolean) {
    this.pressed = undefined;
    this.hide(this.overlay, immediate);
    if (this.hovered) {
      this.hovered = undefined;
      this.onHover(null);
    }
    this.paintReadingFocus();
  }
  private press = (event: PointerEvent) => {
    this.pressed = undefined;
    if (
      (event.target as Element)?.closest(blockActionTarget) ||
      event.button !== 0
    )
      return;
    const block = this.find(event);
    if (block)
      this.pressed = { id: block.id, x: event.clientX, y: event.clientY };
  };
  private click = (event: MouseEvent) => {
    if ((event.target as Element)?.closest(blockActionTarget)) return;
    // The first click of a double click must not zoom the paragraph.
    if (event.detail > 1) {
      this.cancelTextFocus();
      this.pressed = undefined;
      return;
    }
    const pressed = this.pressed;
    this.pressed = undefined;
    // The annotation listener runs first on this host and claims marked text.
    if (
      event.defaultPrevented ||
      !pressed ||
      Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 5 ||
      window.getSelection()?.toString().trim()
    )
      return;
    const block = this.find(event);
    if (!block || block.id !== pressed.id) return;
    if ((event.target as Element)?.closest("a, button, input, [role=button]"))
      return;
    if ((event.target as Element | null)?.closest(".textLayer")) {
      this.cancelTextFocus();
      this.textFocusTimer = setTimeout(() => {
        this.textFocusTimer = undefined;
        if (window.getSelection()?.toString().trim()) return;
        this.commitFocus(block);
      }, 400);
      return;
    }
    this.commitFocus(block, event);
  };
  private cancelTextFocus() {
    clearTimeout(this.textFocusTimer);
    this.textFocusTimer = undefined;
  }
  private commitFocus(block: PDFBlock, event?: MouseEvent) {
    if (this.onFocus(block)) {
      event?.preventDefault();
      event?.stopPropagation();
      this.clear();
      return;
    }
    if (!block.image) return;
    event?.preventDefault();
    event?.stopPropagation();
    this.onAction(block, "attach");
  }
  private find(event: MouseEvent) {
    const page = (event.target as Element | null)?.closest<HTMLElement>(
      ".page[data-page-number]",
    );
    if (!page || !this.host.contains(page)) return;
    const rect = page.getBoundingClientRect();
    return hitBlock(
      this.blocks,
      Number(page.dataset.pageNumber),
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
  }
  private move = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest(blockActionTarget)) return;
    if (event.buttons || window.getSelection()?.toString().trim()) {
      this.clear();
      return;
    }
    const page = (event.target as Element | null)?.closest<HTMLElement>(
      ".page[data-page-number]",
    );
    if (!page || !this.host.contains(page)) {
      this.leave();
      return;
    }
    const rect = page.getBoundingClientRect();
    const block = hitBlock(
      this.blocks,
      Number(page.dataset.pageNumber),
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
    if (!block) {
      this.leave();
      return;
    }
    if (this.active !== block) {
      this.active = block;
      this.root.render(
        createElement(BlockActions, { block, onAction: this.onAction }),
      );
    }
    const b =
      blockRegions(block).find(
        (part) => part.page === Number(page.dataset.pageNumber),
      )?.bounds ?? block.bounds;
    Object.assign(this.overlay.style, {
      left: `${b.x * 100}%`,
      top: `${b.y * 100}%`,
      width: `${b.width * 100}%`,
      height: `${b.height * 100}%`,
    });
    this.overlay.dataset.blockId = block.id;
    this.overlay.dataset.blockKind = block.image ? "image" : "text";
    this.show(this.overlay, page);
    if (this.hovered !== block.id) {
      this.hovered = block.id;
      this.onHover(block);
    }
    this.paintReadingFocus();
  };
  setLinkedBlock(blockId: string | null) {
    if (this.linkedId === blockId) return;
    this.linkedId = blockId;
    this.repaint();
  }
  setFocusBlock(blockId: string | null) {
    this.focusId = blockId;
    if (!blockId) {
      this.clearRegionExtras(this.focus);
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
        this.focus.remove();
      else this.focus.dataset.fading = "";
      return;
    }
    delete this.focus.dataset.fading;
    this.paintReadingFocus();
  }
  flashBlock(blockId: string) {
    clearTimeout(this.referenceFlashTimer);
    this.referenceFlashId = blockId;
    this.paintReferenceFlash();
    this.referenceFlashTimer = setTimeout(() => {
      this.referenceFlashId = null;
      this.clearRegionExtras(this.referenceFlash);
      this.referenceFlash.remove();
      this.referenceFlashTimer = undefined;
    }, 1000);
  }
  private paintReferenceFlash() {
    const block = this.blocks.find((b) => b.id === this.referenceFlashId);
    if (!block || !this.paintBlockRegions(this.referenceFlash, block))
      this.referenceFlash.remove();
  }
  private paintReadingFocus() {
    if (!this.focusId) return;
    this.focus.remove();
    if (this.focusId === this.hovered || this.focusId === this.linkedId) {
      this.clearRegionExtras(this.focus);
      return;
    }
    const block = this.blocks.find((b) => b.id === this.focusId);
    if (!block) return;
    this.paintBlockRegions(this.focus, block);
  }
  repaint() {
    this.paintReferenceFlash();
    for (const [id, element] of this.searchBlocks) {
      const match = this.blocks.find((block) => block.id === id);
      if (!match || !this.paintBlockRegions(element, match)) {
        this.clearRegionExtras(element);
        element.remove();
      }
    }
    this.paintReadingFocus();
    const block = this.blocks.find((b) => b.id === this.linkedId);
    if (!block || !this.paintBlockRegions(this.linked, block)) {
      this.hide(this.linked);
      this.clearRegionExtras(this.linked);
      return;
    }
    if (this.linked.parentElement)
      this.show(this.linked, this.linked.parentElement);
  }
  private pageElement(page: number) {
    return this.host.querySelector<HTMLElement>(
      `.page[data-page-number="${page}"]`,
    );
  }
  private placeBox(
    element: HTMLElement,
    page: HTMLElement,
    bounds: PDFBlockFragment["bounds"],
  ) {
    Object.assign(element.style, {
      left: `${bounds.x * 100}%`,
      top: `${bounds.y * 100}%`,
      width: `${bounds.width * 100}%`,
      height: `${bounds.height * 100}%`,
    });
    if (element.parentElement !== page) page.append(element);
  }
  private clearRegionExtras(primary: HTMLElement) {
    for (const extra of this.regionExtras.get(primary) ?? []) extra.remove();
    this.regionExtras.delete(primary);
  }
  private paintBlockRegions(primary: HTMLElement, block: PDFBlock) {
    const regions = blockRegions(block);
    const page = this.pageElement(regions[0].page);
    if (!page) {
      this.clearRegionExtras(primary);
      return false;
    }
    this.placeBox(primary, page, regions[0].bounds);
    primary.dataset.blockId = block.id;
    primary.dataset.blockKind = block.image ? "image" : "text";
    const extras = this.regionExtras.get(primary) ?? [];
    while (extras.length > regions.length - 1) extras.pop()?.remove();
    for (let i = 1; i < regions.length; i++) {
      const region = regions[i];
      const target = this.pageElement(region.page);
      let extra = extras[i - 1];
      if (!target) {
        extra?.remove();
        continue;
      }
      if (!extra) {
        extra = document.createElement("div");
        extra.className = primary.className;
        extra.setAttribute("aria-hidden", "true");
        extras[i - 1] = extra;
      }
      extra.dataset.blockId = block.id;
      extra.dataset.blockKind = primary.dataset.blockKind ?? "";
      this.placeBox(extra, target, region.bounds);
    }
    this.regionExtras.set(
      primary,
      extras.filter((extra) => extra?.isConnected),
    );
    return true;
  }
  destroy() {
    this.cancelTextFocus();
    clearTimeout(this.referenceFlashTimer);
    for (const extras of this.regionExtras.values())
      for (const extra of extras) extra.remove();
    this.regionExtras.clear();
    this.referenceFlash.remove();
    for (const element of this.searchBlocks.values()) element.remove();
    this.searchBlocks.clear();
    this.focusId = null;
    this.focus.remove();
    this.clear();
    this.hide(this.linked, true);
    this.fades.forEach((a) => a.cancel());
    this.fades.clear();
    this.root.unmount();
    this.host.removeEventListener("pointermove", this.move);
    this.host.removeEventListener("pointerleave", this.leave);
    this.host.removeEventListener("pointerdown", this.press);
    this.host.removeEventListener("click", this.click, true);
    this.host.removeEventListener("pointerup", this.move);
    this.host.removeEventListener("scroll", this.clear);
  }
}
