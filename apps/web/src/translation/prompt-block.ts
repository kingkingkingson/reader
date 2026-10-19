export type PromptRole = "title" | "field";

const titlePattern = /^(?:prompt|提示词)\s*\d*\s*[:：]/i;
const fieldPattern =
  /^(?:inputs?|tasks?|outputs?|constraints?|输入|任务|输出|约束)\s*[:：]/i;

/** A prompt-template title or labeled field, from the start of a line. */
export function promptRole(text: string): PromptRole | undefined {
  const line = text.trim().split(/\n/, 1)[0] ?? "";
  if (titlePattern.test(line)) return "title";
  if (fieldPattern.test(line)) return "field";
  return;
}

/** Whether a source block is a prompt template rather than running prose. */
export function isPromptText(text: string) {
  return text.split(/\n/).some((line) => promptRole(line) !== undefined);
}

function emphasize(text: string, role: PromptRole) {
  if (role === "title") {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("**")) return text;
    return `${text.slice(0, text.indexOf(trimmed))}**${trimmed}**`;
  }
  const match = text.match(/^(\s*)([^\s:：\n*]{1,40}[:：])/);
  if (!match) return text;
  return `${match[1]}**${match[2]}**${text.slice(match[0].length)}`;
}

/** Markdown that bolds a prompt title or the label before its colon. */
export function promptMarkdown(text: string, role: PromptRole) {
  if (!text.includes("\n")) return emphasize(text, role);
  return text
    .split(/\n/)
    .map((line) => {
      const lineRole = promptRole(line);
      return lineRole ? emphasize(line, lineRole) : line;
    })
    .join("\n\n");
}

/** Display text for one translated sentence inside a prompt block. */
export function promptDisplay(
  blockText: string,
  source: string,
  target: string,
  index: number,
) {
  const roles = blockText
    .split(/\n/)
    .map((line) => promptRole(line))
    .filter((role): role is PromptRole => role !== undefined);
  if (!roles.length && !promptRole(source) && !promptRole(target))
    return target;
  if (roles.length >= 2 || target.includes("\n")) {
    const role = promptRole(source) ?? promptRole(target);
    if (!role && !target.includes("\n")) return target;
    return promptMarkdown(target, role ?? "field");
  }
  const role = roles[0] ?? promptRole(source) ?? promptRole(target);
  if (!role || index > 0) return target;
  return promptMarkdown(target, role);
}
