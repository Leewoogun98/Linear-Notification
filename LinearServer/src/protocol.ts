export interface LinearWebhookEvent {
  action: string;            // "create" | "update" | "remove"
  type: string;              // "Issue" | "Comment" | "Project" | "ProjectUpdate" ...
  data: Record<string, unknown>;
  url?: string;
  actor?: { id: string; name: string };
  createdAt?: string;
}

export interface RelayMessage {
  kind: "event" | "replay";
  receivedAt: number;        // relay가 받은 시각(ms epoch)
  event: LinearWebhookEvent;
}
