import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
beforeAll(() => execFileSync(process.execPath, ["build.mjs"], { cwd: root }));

test("SDK worker bridges only registered tools and resumes accepted history", async () => {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const hasTool = body.messages.some((m: any) => m.role === "tool");
    const delta = hasTool
      ? { content: "原文是 42 [S1]。" }
      : {
          tool_calls: [
            {
              index: 0,
              id: "read-1",
              type: "function",
              function: { name: "read_passage", arguments: '{"full":true}' },
            },
          ],
        };
    for (const choice of [
      { delta, finish_reason: null },
      { delta: {}, finish_reason: hasTool ? "stop" : "tool_calls" },
    ])
      res.write(
        `data: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", model: "reader-test", choices: [{ index: 0, ...choice }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const input = {
    version: 1,
    runId: "test",
    key: "",
    effort: "off",
    prompt: "读原文",
    system: "只读当前论文",
    model: {
      id: "reader-test",
      name: "reader-test",
      provider: "reader",
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32000,
      maxTokens: 4096,
    },
    tools: [
      {
        name: "read_passage",
        description: "read text",
        schema: {
          type: "object",
          properties: { full: { type: "boolean" } },
          required: ["full"],
        },
      },
    ],
  };
  async function run(entries?: unknown[]) {
    const child = spawn(process.execPath, ["dist/main.mjs"], { cwd: root });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const events: any[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => {
      const event = JSON.parse(line);
      events.push(event);
      if (event.type === "tool")
        child.stdin.write(
          JSON.stringify({
            type: "toolResult",
            runId: "test",
            id: event.id,
            content: [{ type: "text", text: "[S1] 原文是42" }],
          }) + "\n",
        );
    });
    child.stdin.write(
      JSON.stringify({ type: "start", input: { ...input, entries } }) + "\n",
    );
    const code = await new Promise((resolve) => child.on("exit", resolve));
    expect({
      code,
      stderr,
      error: events.find((e) => e.type === "error"),
    }).toEqual({ code: 0, stderr: "", error: undefined });
    return events;
  }
  try {
    const events = await run();
    expect(
      events.some((e) => e.type === "draft" && e.text.includes("42")),
    ).toBe(true);
    expect(events.filter((e) => e.type === "tool")).toHaveLength(1);
    const complete = events.at(-1);
    expect(complete.type).toBe("complete");
    expect(complete.entries.some((e: any) => e.type === "message")).toBe(true);
    const resumed = await run(complete.entries);
    expect(resumed.filter((e) => e.type === "tool")).toHaveLength(0);
    expect(requests[0].tools.map((t: any) => t.function.name)).toEqual([
      "read_passage",
    ]);
    expect(
      requests.at(-1).messages.filter((m: any) => m.role === "user").length,
    ).toBe(2);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}, 20000);

test.each(["truncated", "anthropic"])(
  "validates %s provider termination",
  async (mode) => {
    const upstream = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      expect(request.messages.at(-1).content).toBeTruthy();
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (mode === "truncated") {
        res.end(
          'data: {"choices":[{"index":0,"delta":{"content":"partial answer"}}]}\n\n',
        );
        return;
      }
      expect(req.url).toBe("/relay/messages");
      for (const [event, data] of [
        [
          "message_start",
          {
            type: "message_start",
            message: {
              id: "m",
              type: "message",
              role: "assistant",
              model: "test",
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          },
        ],
        [
          "content_block_start",
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
        ],
        [
          "content_block_delta",
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "anthropic complete" },
          },
        ],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        [
          "message_delta",
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 4 },
          },
        ],
        ["message_stop", { type: "message_stop" }],
      ])
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/relay`;
    const child = spawn(process.execPath, ["dist/main.mjs"], { cwd: root });
    const events: any[] = [];
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    createInterface({ input: child.stdout }).on("line", (line) =>
      events.push(JSON.parse(line)),
    );
    child.stdin.write(
      JSON.stringify({
        type: "start",
        input: {
          version: 1,
          runId: "protocol",
          prompt: "hello",
          system: "read",
          key: "",
          effort: "off",
          tools: [],
          endpoint:
            base + (mode === "anthropic" ? "/messages" : "/chat/completions"),
          payload: mode === "anthropic" ? { max_tokens: 8192 } : {},
          model: {
            id: "test",
            name: "test",
            provider: "reader",
            api:
              mode === "anthropic"
                ? "anthropic-messages"
                : "openai-completions",
            baseUrl: base,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 32000,
            maxTokens: 4096,
          },
        },
      }) + "\n",
    );
    try {
      const code = await new Promise((resolve) => child.on("exit", resolve));
      expect(stderr).toBe("");
      if (mode === "truncated") {
        expect(code).toBe(1);
        expect(
          events.some((e) => e.type === "draft" && e.text === "partial answer"),
        ).toBe(true);
        expect(events.some((e) => e.type === "complete")).toBe(false);
      } else {
        expect({ code, error: events.find((e) => e.type === "error") }).toEqual(
          { code: 0, error: undefined },
        );
        expect(events.at(-1).text).toBe("anthropic complete");
      }
    } finally {
      child.kill();
      upstream.close();
      upstream.closeAllConnections();
    }
  },
  15000,
);
