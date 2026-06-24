import { EventBuffer } from "./event-buffer";
import type { LinearWebhookEvent } from "./protocol";

const WINDOW_MS = 60_000;

export class RelayDurableObject {
  private buffer = new EventBuffer(WINDOW_MS);

  constructor(private ctx: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 데스크탑 앱의 WS 업그레이드 (worker가 토큰 검증 후 라우팅)
    if (url.pathname === "/connect") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);

      const since = Number(url.searchParams.get("since") ?? "0");
      if (since > 0) {
        for (const msg of this.buffer.since(since)) {
          server.send(JSON.stringify(msg));
        }
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    // worker가 검증한 webhook 이벤트를 내부 전달 (POST JSON: LinearWebhookEvent)
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const event = (await request.json()) as LinearWebhookEvent;
      const now = Date.now();
      const msg = this.buffer.add(event, now);
      const payload = JSON.stringify(msg);
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(payload);
        } catch {
          /* 닫힌 소켓 무시 */
        }
      }
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }

  // hibernation 콜백: 앱→relay 메시지는 사용하지 않지만 핸들러는 있어야 한다.
  async webSocketMessage(_ws: WebSocket, _msg: string | ArrayBuffer) {}

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      /* 무시 */
    }
  }
}
