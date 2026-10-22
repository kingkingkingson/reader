import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const worker =
  process.argv[2] || fileURLToPath(new URL("./dist/main.mjs", import.meta.url));
let calls = 0;
const upstream = createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  const request = JSON.parse(raw);
  calls++;
  const read = request.messages.some(
    (m) => m.role === "tool" && m.content.includes("reader-smoke"),
  );
  assert.deepEqual(
    request.tools.map((t) => t.function.name),
    ["read_passage"],
  );
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const delta = read
    ? { content: "reader-smoke complete" }
    : {
        tool_calls: [
          {
            index: 0,
            id: "read",
            type: "function",
            function: { name: "read_passage", arguments: "{}" },
          },
        ],
      };
  res.end(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: read ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const child = spawn(process.execPath, [worker], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: ["pipe", "pipe", "inherit"],
});
const timeout = setTimeout(() => child.kill(), 20_000);
const events = [];
createInterface({ input: child.stdout }).on("line", (line) => {
  const event = JSON.parse(line);
  events.push(event);
  if (event.type === "tool")
    child.stdin.write(
      JSON.stringify({
        type: "toolResult",
        runId: "smoke",
        id: event.id,
        content: [{ type: "text", text: "reader-smoke" }],
      }) + "\n",
    );
});
const input = {
  version: 1,
  runId: "smoke",
  prompt: "Read once",
  system: "Use only read_passage",
  key: "",
  effort: "off",
  tools: [
    {
      name: "read_passage",
      description: "Read smoke fixture",
      schema: { type: "object", properties: {} },
    },
  ],
  model: {
    id: "smoke",
    name: "smoke",
    provider: "reader",
    api: "openai-completions",
    baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
    input: ["text"],
    reasoning: false,
    contextWindow: 32000,
    maxTokens: 2048,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
};
child.stdin.write(JSON.stringify({ type: "start", input }) + "\n");
try {
  const code = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  assert.equal(
    code,
    0,
    JSON.stringify(events.filter((e) => e.type === "error")),
  );
  assert.equal(calls, 2);
  assert.equal(events.at(-1)?.text, "reader-smoke complete");
  assert.ok(events.at(-1)?.entries?.length);
  console.log("pi worker smoke passed");
} finally {
  clearTimeout(timeout);
  upstream.close();
  upstream.closeAllConnections();
  child.kill();
}
