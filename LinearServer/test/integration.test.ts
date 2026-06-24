// 사전 조건: 다른 터미널에서 아래로 dev 서버를 띄워둔다(시크릿을 var로 주입):
//   npx wrangler dev --local --port 8787 --var LINEAR_WEBHOOK_SECRET:test-secret --var APP_AUTH_TOKEN:test-token
import { describe, it, expect } from "vitest";
import { computeSignature } from "../src/signature";

const BASE = "http://localhost:8787";
const WS = "ws://localhost:8787";

describe.skipIf(!process.env.RELAY_LIVE)("relay integration", () => {
  it("서명된 webhook이 WS 클라이언트로 전달된다", async () => {
    const ws = new WebSocket(`${WS}/connect?token=test-token`);
    const received = new Promise<any>((resolve, reject) => {
      ws.addEventListener("message", (e) => resolve(JSON.parse(e.data as string)));
      ws.addEventListener("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5000);
    });
    await new Promise((r) => ws.addEventListener("open", r));

    const body = JSON.stringify({ action: "create", type: "Issue", data: { id: "X1", title: "hi" } });
    const sig = await computeSignature(body, "test-secret");
    const res = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: { "Linear-Signature": sig, "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(200);

    const msg = await received;
    expect(msg.event.data.id).toBe("X1");
    ws.close();
  });

  it("잘못된 토큰은 거부된다 (서버 liveness 확인 후)", async () => {
    // 서버가 실제로 떠 있는지 먼저 확인 — 그래야 아래 거부가 'auth 거부'임을 보장
    const health = await fetch(`${BASE}/`);
    expect(health.status).toBe(200);

    const rejected = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`${WS}/connect?token=wrong`);
      ws.addEventListener("open", () => { ws.close(); resolve(false); });
      ws.addEventListener("error", () => resolve(true));
      setTimeout(() => resolve(false), 5000);
    });
    expect(rejected).toBe(true);
  });
});
