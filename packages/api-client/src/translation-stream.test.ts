import { expect, it } from "vitest";
import {
  consumeTranslationStream,
  type TranslationEvent,
} from "./translation-stream";

it("accepts unrequested book paragraphs alongside completed translations", async () => {
  const idle = {
    blockId: "p2-b1",
    sourceHash: "hash",
    status: "idle",
    sentences: [],
  };
  const complete = {
    ...idle,
    blockId: "p1-b1",
    status: "complete",
    sentences: [{ source: "Source.", target: "译文。" }],
  };
  const abort = new AbortController();
  const events: TranslationEvent[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(
        new TextEncoder().encode(
          `event: snapshot\ndata: ${JSON.stringify([complete, idle])}\n\nevent: translation\ndata: ${JSON.stringify(idle)}\n\n`,
        ),
      );
    },
  });
  await expect(
    consumeTranslationStream(body, abort.signal, (event) => {
      events.push(event);
      if (events.length === 2) abort.abort();
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(events).toEqual([
    { event: "snapshot", data: [complete, idle] },
    { event: "translation", data: idle },
  ]);
});

it("delivers completed paragraphs before EOF across fragmented UTF-8 and multiple frames", async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      source = c;
    },
  });
  const abort = new AbortController(),
    events: TranslationEvent[] = [];
  const running = consumeTranslationStream(body, abort.signal, (e) =>
    events.push(e),
  );
  const block = {
    blockId: "p1-b2",
    sourceHash: "hash",
    status: "complete",
    sentences: [{ source: "Source.", target: "译文。" }],
  };
  const bytes = new TextEncoder().encode(
    `event: snapshot\ndata: []\n\n: keepalive\n\nevent: translation\ndata: ${JSON.stringify(block)}\n\n`,
  );
  for (const byte of bytes) source.enqueue(new Uint8Array([byte]));
  // Let the reader consume the queued fragments without closing the connection.
  for (let i = 0; i < bytes.length + 5; i++) await Promise.resolve();
  expect(events).toEqual([
    { event: "snapshot", data: [] },
    { event: "translation", data: block },
  ]);
  source.enqueue(
    new TextEncoder().encode(
      `event: translation\ndata: ${JSON.stringify({ ...block, blockId: "p1-b1" })}\n\nevent: translation\ndata: {"blockId":`,
    ),
  );
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(events).toHaveLength(3);
  expect(events[2]).toMatchObject({ data: { blockId: "p1-b1" } });
  abort.abort();
  await expect(running).rejects.toMatchObject({ name: "AbortError" });
});
it("rejects malformed events and releases the stream", async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(
        new TextEncoder().encode(
          'event: translation\ndata: {"blockId":"wrong"}\n\n',
        ),
      );
    },
    cancel() {
      canceled = true;
    },
  });
  await expect(
    consumeTranslationStream(body, new AbortController().signal, () => {}),
  ).rejects.toThrow("格式无效");
  expect(canceled).toBe(true);
});
