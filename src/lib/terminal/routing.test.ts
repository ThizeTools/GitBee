import { describe, test, expect } from "bun:test";
import { OutputRouter } from "./outputRouter";
import { createSerialWriter } from "./serialWriter";

/** Sink that remembers everything it was given. */
class RecordingSink {
  readonly received: string[] = [];
  readonly fn = (data: string): void => {
    this.received.push(data);
  };
}

describe("OutputRouter", () => {
  test("output that arrives before attach is replayed on attach", () => {
    const router = new OutputRouter();
    router.deliver(1, "prompt$ ");
    const sink = new RecordingSink();
    router.attach(1, sink.fn);
    expect(sink.received).toEqual(["prompt$ "]);
  });

  test("after attach, output goes straight to the sink", () => {
    const router = new OutputRouter();
    const sink = new RecordingSink();
    router.attach(1, sink.fn);
    router.deliver(1, "a");
    router.deliver(1, "b");
    expect(sink.received).toEqual(["a", "b"]);
  });

  test("detached output waits in the backlog until the next attach", () => {
    const router = new OutputRouter();
    const first = new RecordingSink();
    router.attach(1, first.fn);
    router.detach(1);
    router.deliver(1, "while hidden");
    expect(first.received).toEqual([]);
    const second = new RecordingSink();
    router.attach(1, second.fn);
    expect(second.received).toEqual(["while hidden"]);
  });

  test("the backlog keeps only the newest characters", () => {
    const router = new OutputRouter(4);
    router.deliver(1, "abcdef");
    const sink = new RecordingSink();
    router.attach(1, sink.fn);
    expect(sink.received).toEqual(["cdef"]);
  });

  test("sessions do not share output", () => {
    const router = new OutputRouter();
    const sink = new RecordingSink();
    router.attach(1, sink.fn);
    router.deliver(2, "other");
    expect(sink.received).toEqual([]);
  });

  test("drop forgets the sink and the backlog", () => {
    const router = new OutputRouter();
    router.deliver(5, "stale");
    router.drop(5);
    const sink = new RecordingSink();
    router.attach(5, sink.fn);
    expect(sink.received).toEqual([]);
  });
});

/** Fake write that records calls and fails for one chosen payload. */
class FakeWrite {
  readonly calls: string[] = [];
  constructor(private readonly failOn: string | null = null) {}
  readonly fn = async (id: number, data: string): Promise<void> => {
    await Promise.resolve();
    this.calls.push(`${id}:${data}`);
    if (data === this.failOn) throw new Error("pty gone");
  };
}

describe("createSerialWriter", () => {
  test("writes run in the order they were queued", async () => {
    const write = new FakeWrite();
    const send = createSerialWriter(write.fn, () => {});
    send(1, "l");
    send(1, "s");
    send(1, "\r");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(write.calls).toEqual(["1:l", "1:s", "1:\r"]);
  });

  test("a failed write is reported and the queue keeps going", async () => {
    const write = new FakeWrite("bad");
    const errors: string[] = [];
    const send = createSerialWriter(write.fn, (msg) => errors.push(msg));
    send(2, "bad");
    send(2, "ok");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(write.calls).toEqual(["2:bad", "2:ok"]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("session 2");
  });
});
