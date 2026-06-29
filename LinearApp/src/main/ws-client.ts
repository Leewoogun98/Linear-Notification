import WebSocket from "ws";
import { nextBackoff } from "./backoff";
import type { RelayMessage, HelloMessage } from "../shared/protocol";

const HEARTBEAT_MS = 30_000; // 30초마다 ping
const PONG_WAIT_MS = 10_000; // ping 후 10초 내 pong 없으면 죽은 연결로 판정

export class RelayClient {
  private ws?: WebSocket;
  private attempt = 0;
  private lastReceivedAt = 0;
  private closed = false;
  private timer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;

  constructor(
    private getConfig: () => { relayUrl: string; sessionToken: string },
    private onMessage: (msg: RelayMessage) => void,
    private onHello: (you: { id: string; name: string; displayName: string }) => void,
    private onUnauthorized: () => void,
  ) {}

  start() { this.closed = false; this.connect(); }

  stop() {
    this.closed = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.cleanupSocket();
  }

  // 절전에서 깨어남 / 화면 잠금 해제 등 외부 신호로 즉시 재연결한다.
  reconnect() {
    if (this.closed) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.attempt = 0;
    this.connect(); // connect()가 기존(좀비) 소켓을 정리하고 새로 연결
  }

  private connect() {
    this.cleanupSocket(); // 기존 소켓 리스너 제거 + 종료 → 중복 연결 방지
    const { relayUrl, sessionToken } = this.getConfig();
    if (!relayUrl || !sessionToken) { this.scheduleReconnect(); return; }
    const url = `${relayUrl}/connect?token=${encodeURIComponent(sessionToken)}&since=${this.lastReceivedAt}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => { this.attempt = 0; this.startHeartbeat(ws); });
    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as RelayMessage | HelloMessage;
        if (data.kind === "hello") { this.onHello(data.you); return; }
        this.lastReceivedAt = Math.max(this.lastReceivedAt, data.receivedAt);
        this.onMessage(data);
      } catch { /* 무시 */ }
    });
    // pong 수신 = 연결 살아있음 → 죽음 판정 타이머 해제
    ws.on("pong", () => { if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = undefined; } });
    // 세션 무효 시 릴레이가 101 대신 401 → ws 'unexpected-response'
    ws.on("unexpected-response", (_req, res) => {
      if (res.statusCode === 401) this.onUnauthorized();
      ws.close();
    });
    ws.on("close", () => { this.stopHeartbeat(); this.scheduleReconnect(); });
    ws.on("error", () => ws.close());
  }

  // 깨어 있는 동안 주기적으로 ping을 보내 좀비(half-open) 소켓을 감지한다.
  private startHeartbeat(ws: WebSocket) {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => { try { ws.terminate(); } catch { /* 무시 */ } }, PONG_WAIT_MS);
      try { ws.ping(); } catch { try { ws.terminate(); } catch { /* 무시 */ } }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = undefined; }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = undefined; }
  }

  private cleanupSocket() {
    this.stopHeartbeat();
    const ws = this.ws;
    if (ws) {
      ws.removeAllListeners(); // 이 소켓의 close/error가 더는 재연결을 트리거하지 않도록
      try { ws.terminate(); } catch { /* 무시 */ }
      this.ws = undefined;
    }
  }

  private scheduleReconnect() {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), nextBackoff(this.attempt++));
  }
}
