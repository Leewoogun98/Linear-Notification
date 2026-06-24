import type { LinearWebhookEvent, RelayMessage } from "./protocol";

interface Entry {
  msg: RelayMessage;
  recipients: string[];
}

export class EventBuffer {
  private items: Entry[] = [];
  constructor(private windowMs: number) {}

  add(event: LinearWebhookEvent, now: number, recipients: string[]): RelayMessage {
    const msg: RelayMessage = { kind: "event", receivedAt: now, event };
    this.items.push({ msg, recipients });
    const cutoff = now - this.windowMs;
    this.items = this.items.filter((e) => e.msg.receivedAt >= cutoff);
    return msg;
  }

  // userId가 수신 대상이고 timestamp 이후에 받은 메시지를 replay로 반환.
  since(timestamp: number, userId: string): RelayMessage[] {
    return this.items
      .filter((e) => e.msg.receivedAt > timestamp && e.recipients.includes(userId))
      .map((e) => ({ ...e.msg, kind: "replay" as const }));
  }
}
