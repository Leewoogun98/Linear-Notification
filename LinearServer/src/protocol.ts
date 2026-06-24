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

// 연결 직후 릴레이가 앱에게 "당신은 누구"임을 알리는 메시지
export interface HelloMessage {
  kind: "hello";
  you: { id: string; name: string; displayName: string };
}
