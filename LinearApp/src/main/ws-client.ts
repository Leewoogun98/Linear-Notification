import WebSocket from "ws";
import { nextBackoff } from "./backoff";
import type { RelayMessage } from "../shared/protocol";

export class RelayClient {
  private ws?: WebSocket;
  private attempt = 0;
  private lastReceivedAt = 0;
  private closed = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private getConfig: () => { relayUrl: string; authToken: string },
    private onMessage: (msg: RelayMessage) => void,
  ) {}

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }

  private connect() {
    const { relayUrl, authToken } = this.getConfig();
    if (!relayUrl || !authToken) {
      // 설정 전이면 잠시 후 재시도
      this.scheduleReconnect();
      return;
    }
    const since = this.lastReceivedAt;
    const url = `${relayUrl}/connect?token=${encodeURIComponent(authToken)}&since=${since}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => {
      this.attempt = 0;
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as RelayMessage;
        this.lastReceivedAt = Math.max(this.lastReceivedAt, msg.receivedAt);
        this.onMessage(msg);
      } catch {
        /* 잘못된 메시지 무시 */
      }
    });
    ws.on("close", () => this.scheduleReconnect());
    ws.on("error", () => ws.close());
  }

  private scheduleReconnect() {
    if (this.closed) return;
    const delay = nextBackoff(this.attempt++);
    this.timer = setTimeout(() => this.connect(), delay);
  }
}
