/** Keep OS protocol opening limited to a local Codex thread, without commands. */
export function codexThreadURL(threadId: unknown): string {
  if (
    typeof threadId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      threadId,
    )
  )
    throw new Error("无效的 Codex 对话编号");
  return `codex://threads/${threadId}`;
}
