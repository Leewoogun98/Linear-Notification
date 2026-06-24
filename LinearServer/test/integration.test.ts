// 전체 두-사용자 라우팅은 실제 OAuth 세션이 필요하고, production worker에 테스트 백도어를
// 두지 않기 위해 수동 e2e(계획 Task 17)에서 검증한다. 여기서는 헬스 + 세션없는 연결 거부만 검증.
// 사전: dev 서버를 RELAY_LIVE와 함께 띄워둔다(아래 Step 2 명령 참고).
declare const process: { env: Record<string, string | undefined> };

import { describe, it, expect } from "vitest";

const BASE = "http://localhost:8787";
const WS = "ws://localhost:8787";

describe.skipIf(!process.env.RELAY_LIVE)("relay routing", () => {
  it("헬스 체크", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Linear Noti relay");
  });

  it("세션 없는 connect는 거부된다 (서버 liveness 확인 후)", async () => {
    const health = await fetch(`${BASE}/`);
    expect(health.status).toBe(200);
    const rejected = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`${WS}/connect?token=nope`);
      ws.addEventListener("open", () => { ws.close(); resolve(false); });
      ws.addEventListener("error", () => resolve(true));
      setTimeout(() => resolve(false), 5000);
    });
    expect(rejected).toBe(true);
  });
});
