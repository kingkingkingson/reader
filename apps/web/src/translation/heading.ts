/** Visual rank of a translated block. 1 is the document title. */
export function translationHeadingLevel(block: {
  label: string;
  text: string;
  level?: number;
}): number | undefined {
  if (block.label === "doc_title") return 1;
  if (block.label !== "paragraph_title") return;
  if (block.level && block.level >= 1 && block.level <= 6) return block.level;
  const match = block.text
    .trim()
    .match(/^(?:第\s*)?((?:[A-Z]|\d+)(?:\.\d+)*)\b/);
  if (!match) return 2;
  return Math.min(match[1].split(".").filter(Boolean).length + 1, 6);
}
