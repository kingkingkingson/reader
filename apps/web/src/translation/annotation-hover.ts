import type { Annotation } from "@reader/core";

export type AnnotationRange = { annotation: Annotation; range: Range };
const overlaps = (a: DOMRect, b: DOMRect) =>
  a.width > 0 &&
  a.height > 0 &&
  b.width > 0 &&
  b.height > 0 &&
  a.left < b.right &&
  a.right > b.left &&
  a.top < b.bottom &&
  a.bottom > b.top;

/** Resolve saved marks across both rendered text and PDF page-relative rectangles. */
export function annotationsInRects(
  host: HTMLElement,
  annotations: Annotation[],
  marks: AnnotationRange[],
  rects: DOMRect[],
): Annotation[] {
  const ids = new Set(
    marks
      .filter(({ range }) =>
        Array.from(range.getClientRects()).some((box) =>
          rects.some((r) => overlaps(box, r)),
        ),
      )
      .map(({ annotation }) => annotation.id),
  );
  const pages = new Map<number, DOMRect | undefined>();
  return annotations.filter((annotation) => {
    if (annotation.kind === "bookmark") return false;
    if (ids.has(annotation.id)) return true;
    const location = annotation.location;
    if (location.type !== "pdf" || location.translation) return false;
    if (!pages.has(location.page))
      pages.set(
        location.page,
        host
          .querySelector<HTMLElement>(
            `.page[data-page-number="${location.page}"]`,
          )
          ?.getBoundingClientRect(),
      );
    const page = pages.get(location.page);
    return (
      !!page &&
      !!location.rects?.some((r) =>
        rects.some((box) =>
          overlaps(
            box,
            new DOMRect(
              page.left + r.x * page.width,
              page.top + r.y * page.height,
              r.width * page.width,
              r.height * page.height,
            ),
          ),
        ),
      )
    );
  });
}

/** EPUB text and translated sentences are regular DOM text, including inline spans. */
export function sentenceRectsAtPoint(
  target: Element,
  x: number,
  y: number,
): DOMRect[] {
  const host = target.closest(
    "[data-sentence], [data-epub-run], [data-epub-block]",
  );
  if (!host) return [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  const text = nodes.map((node) => node.data).join("");
  const endpoint = (offset: number): [Text, number] => {
    for (const node of nodes) {
      if (offset <= node.length) return [node, offset];
      offset -= node.length;
    }
    return [nodes[nodes.length - 1], nodes[nodes.length - 1].length];
  };
  for (const sentence of new Intl.Segmenter(undefined, {
    granularity: "sentence",
  }).segment(text)) {
    const range = document.createRange();
    range.setStart(...endpoint(sentence.index));
    range.setEnd(...endpoint(sentence.index + sentence.segment.length));
    const rects = Array.from(range.getClientRects());
    if (
      rects.some(
        (r) =>
          r.width > 0 &&
          r.height > 0 &&
          x >= r.left &&
          x <= r.right &&
          y >= r.top &&
          y <= r.bottom,
      )
    )
      return rects;
  }
  return [];
}
