import { expect, test } from "bun:test";
import { captureOutput } from "../src/record";

test("capture output drains the stream while retaining only the configured prefix", async () => {
  const secret = "correct-horse-battery";
  const chunks = [
    new TextEncoder().encode(`start ${secret}\n`),
    new Uint8Array(1024 * 1024).fill(120),
    new TextEncoder().encode(`\nend ${secret}`),
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  const captured = await captureOutput(stream, 1024, { API_TOKEN: secret });

  expect(captured.bytes).toBe(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  expect(new TextEncoder().encode(captured.text).byteLength).toBeLessThanOrEqual(1024);
  expect(captured.truncated).toBe(true);
  expect(captured.text).not.toContain(secret);
  expect(captured.inspectionTail).not.toContain(secret);
  expect(captured.inspectionTail).toContain("end [REDACTED]");
});
