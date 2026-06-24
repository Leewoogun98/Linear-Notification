import { describe, it, expect } from "vitest";
import { EventBuffer } from "../src/event-buffer";
import type { LinearWebhookEvent } from "../src/protocol";

const ev = (id: string): LinearWebhookEvent => ({ action: "create", type: "Issue", data: { id } });

describe("EventBuffer", () => {
  it("윈도우 내 이벤트만 since 이후로 돌려준다", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("a"), 1000);
    buf.add(ev("b"), 2000);
    const got = buf.since(1500);
    expect(got.map((m) => (m.event.data as any).id)).toEqual(["b"]);
  });

  it("윈도우보다 오래된 이벤트는 add 시 제거된다", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("old"), 1000);
    buf.add(ev("new"), 1000 + 61_000); // old는 윈도우 밖
    expect(buf.since(0).map((m) => (m.event.data as any).id)).toEqual(["new"]);
  });

  it("since가 모든 이벤트보다 미래면 빈 배열", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("a"), 1000);
    expect(buf.since(5000)).toEqual([]);
  });
});
