import { EventBuffer } from "./event-buffer";
import { computeRecipients } from "./recipients";
import type { LinearWebhookEvent, HelloMessage } from "./protocol";

const WINDOW_MS = 60_000;
const PAIR_TTL_MS = 5 * 60_000;

interface Session {
  userId: string;
  name: string;
  displayName: string;
}

export class RelayDurableObject {
  private buffer = new EventBuffer(WINDOW_MS);
  constructor(private ctx: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 세션 저장 (worker의 /auth/callback에서 호출)
    if (url.pathname === "/session/put" && request.method === "POST") {
      const { token, session, pairing } = (await request.json()) as {
        token: string; session: Session; pairing: string;
      };
      await this.ctx.storage.put(`session:${token}`, session);
      await this.ctx.storage.put(`pair:${pairing}`, { token, at: Date.now() });
      return new Response("ok");
    }

    // 페어링 코드 소비 (worker의 /auth/poll에서 호출)
    if (url.pathname === "/session/poll") {
      const pairing = url.searchParams.get("cb") ?? "";
      const rec = (await this.ctx.storage.get(`pair:${pairing}`)) as
        | { token: string; at: number } | undefined;
      if (!rec || Date.now() - rec.at > PAIR_TTL_MS) {
        return new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } });
      }
      await this.ctx.storage.delete(`pair:${pairing}`); // 1회용
      return new Response(JSON.stringify({ token: rec.token }), {
        headers: { "content-type": "application/json" },
      });
    }

    // 앱 WS 연결 (worker가 forward; token 쿼리로 세션 검증)
    if (url.pathname === "/connect") {
      const token = url.searchParams.get("token") ?? "";
      const session = (await this.ctx.storage.get(`session:${token}`)) as Session | undefined;
      if (!session) return new Response("unauthorized", { status: 401 });

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ userId: session.userId, displayName: session.displayName });
      console.log("[connect] userId=", session.userId, "name=", session.name);

      const hello: HelloMessage = { kind: "hello", you: { id: session.userId, name: session.name, displayName: session.displayName } };
      server.send(JSON.stringify(hello));

      const since = Number(url.searchParams.get("since") ?? "0");
      if (since > 0) {
        for (const msg of this.buffer.since(since, session.userId)) server.send(JSON.stringify(msg));
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    // 검증된 webhook 이벤트 (worker가 forward)
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const event = (await request.json()) as LinearWebhookEvent;
      const now = Date.now();
      const sockets = this.ctx.getWebSockets();
      const connected = sockets
        .map((ws) => ws.deserializeAttachment() as { userId: string; displayName: string } | null)
        .filter((a): a is { userId: string; displayName: string } => !!a);
      const recipients = computeRecipients(event, connected);
      const connectedIds = connected.map((a) => a.userId);
      console.log("[broadcast] type=", event.type, "action=", event.action,
        "dataKeys=", JSON.stringify(Object.keys(event.data ?? {})),
        "subscriberIds=", JSON.stringify((event.data as any)?.subscriberIds),
        "assignee=", JSON.stringify((event.data as any)?.assignee?.id),
        "recipients=", JSON.stringify(recipients),
        "connected=", JSON.stringify(connectedIds));
      console.log("[broadcast-detail] body=", JSON.stringify((event.data as any)?.body),
        "issueKeys=", JSON.stringify(Object.keys((event.data as any)?.issue ?? {})),
        "issue.subscriberIds=", JSON.stringify((event.data as any)?.issue?.subscriberIds),
        "userId=", JSON.stringify((event.data as any)?.userId),
        "user=", JSON.stringify((event.data as any)?.user));
      console.log("[broadcast-updatedFrom] updatedFrom=", JSON.stringify((event as any)?.updatedFrom));
      console.log("[broadcast-project] leadId=", JSON.stringify((event.data as any)?.leadId),
        "lead=", JSON.stringify((event.data as any)?.lead),
        "leadUserId=", JSON.stringify((event.data as any)?.leadUserId),
        "creatorId=", JSON.stringify((event.data as any)?.creatorId),
        "memberIds=", JSON.stringify((event.data as any)?.memberIds));
      console.log("[broadcast-actor] actor=", JSON.stringify((event as any)?.actor));
      const msg = this.buffer.add(event, now, recipients);
      const payload = JSON.stringify(msg);
      const targets = new Set(recipients);
      for (const ws of sockets) {
        const att = ws.deserializeAttachment() as { userId: string } | null;
        if (att && targets.has(att.userId)) {
          try { ws.send(payload); } catch { /* 닫힌 소켓 무시 */ }
        }
      }
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(_ws: WebSocket, _msg: string | ArrayBuffer) {}
  async webSocketClose(ws: WebSocket) {
    try { ws.close(); } catch { /* 무시 */ }
  }
}
