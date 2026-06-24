import type { LinearWebhookEvent, RelayMessage } from "./protocol";

export class EventBuffer {
  private items: RelayMessage[] = [];
  constructor(private windowMs: number) {}

  add(event: LinearWebhookEvent, now: number): RelayMessage {
    const msg: RelayMessage = { kind: "event", receivedAt: now, event };
    this.items.push(msg);
    const cutoff = now - this.windowMs;
    this.items = this.items.filter((m) => m.receivedAt >= cutoff);
    return msg;
  }

  // since(ms) 이후에 받은 이벤트를 replay 메시지로 반환.
  since(timestamp: number): RelayMessage[] {
    return this.items
      .filter((m) => m.receivedAt > timestamp)
      .map((m) => ({ ...m, kind: "replay" as const }));
  }
}
