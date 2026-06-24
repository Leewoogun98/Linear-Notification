export interface LinearWebhookEvent {
  action: string;
  type: string;
  data: Record<string, any>;
  url?: string;
  actor?: { id: string; name: string };
  createdAt?: string;
}

export interface RelayMessage {
  kind: "event" | "replay";
  receivedAt: number;
  event: LinearWebhookEvent;
}

export interface HelloMessage {
  kind: "hello";
  you: { id: string; name: string; displayName: string };
}
