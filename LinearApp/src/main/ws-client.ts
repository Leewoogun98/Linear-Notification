import WebSocket from "ws";
import { nextBackoff } from "./backoff";
import type { RelayMessage, HelloMessage } from "../shared/protocol";

export class RelayClient {
  private ws?: WebSocket;
  private attempt = 0;
  private lastReceivedAt = 0;
  private closed = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private getConfig: () => { relayUrl: string; sessionToken: string },
    private onMessage: (msg: RelayMessage) => void,
    private onHello: (you: { id: string; name: string; displayName: string }) => void,
    private onUnauthorized: () => void,
  ) {}

  start() { this.closed = false; this.connect(); }
  stop() { this.closed = true; if (this.timer) clearTimeout(this.timer); this.ws?.close(); }

  private connect() {
    const { relayUrl, sessionToken } = this.getConfig();
    if (!relayUrl || !sessionToken) { this.scheduleReconnect(); return; }
    const url = `${relayUrl}/connect?token=${encodeURIComponent(sessionToken)}&since=${this.lastReceivedAt}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => { this.attempt = 0; });
    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as RelayMessage | HelloMessage;
        if (data.kind === "hello") { this.onHello(data.you); return; }
        this.lastReceivedAt = Math.max(this.lastReceivedAt, data.receivedAt);
        this.onMessage(data);
      } catch { /* 무시 */ }
    });
    // 세션 무효 시 릴레이가 101 대신 401 → ws 'unexpected-response'
    ws.on("unexpected-response", (_req, res) => {
      if (res.statusCode === 401) this.onUnauthorized();
      ws.close();
    });
    ws.on("close", () => this.scheduleReconnect());
    ws.on("error", () => ws.close());
  }

  private scheduleReconnect() {
    if (this.closed) return;
    this.timer = setTimeout(() => this.connect(), nextBackoff(this.attempt++));
  }
}
