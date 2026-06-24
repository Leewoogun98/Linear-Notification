import { describe, it, expect } from "vitest";
import { EventBuffer } from "../src/event-buffer";
import type { LinearWebhookEvent } from "../src/protocol";

const ev = (id: string): LinearWebhookEvent => ({ action: "create", type: "Issue", data: { id } });

describe("EventBuffer", () => {
  it("since(ts, userId): 대상이고 ts 이후인 것만 replay", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("a"), 1000, ["u1"]);
    buf.add(ev("b"), 2000, ["u2"]);
    buf.add(ev("c"), 3000, ["u1", "u2"]);
    const forU1 = buf.since(1500, "u1");
    expect(forU1.map((m) => (m.event.data as any).id)).toEqual(["c"]);
  });

  it("대상이 아니면 replay에서 제외", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("a"), 1000, ["u2"]);
    expect(buf.since(0, "u1")).toEqual([]);
  });

  it("윈도우 밖 메시지는 add 시 제거", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("old"), 1000, ["u1"]);
    buf.add(ev("new"), 1000 + 61_000, ["u1"]);
    expect(buf.since(0, "u1").map((m) => (m.event.data as any).id)).toEqual(["new"]);
  });
});
