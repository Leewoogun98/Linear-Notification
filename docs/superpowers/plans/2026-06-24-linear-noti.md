# Linear 커스텀 알림 데스크탑 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear webhook 이벤트 중 사용자가 정의한 규칙에 맞는 것만 macOS/Windows 화면 정중앙에 알림으로 띄우는 데스크탑 앱과, webhook을 실시간 중계하는 Cloudflare relay를 만든다.

**Architecture:** Linear가 Cloudflare Worker(relay)로 서명된 webhook을 보내면, Worker가 서명을 검증하고 Durable Object를 통해 WebSocket으로 연결된 Electron 앱에 실시간 전달한다. 규칙 평가(필터링)는 relay가 아니라 데스크탑 앱에서 수행한다. 매칭되면 앱이 중앙 알림창을 띄운다(5초 자동 사라짐/클릭 닫힘/소리/스택).

**Tech Stack:** Cloudflare Workers + Durable Objects + TypeScript(wrangler, vitest) / Electron + TypeScript(vanilla 렌더러, electron-builder, vitest).

설계 문서: `docs/superpowers/specs/2026-06-24-linear-noti-design.md`

---

## File Structure

### Part 1 — Relay (`LinearServer/`)

- `LinearServer/package.json` — 의존성(wrangler, vitest, typescript) 및 스크립트
- `LinearServer/tsconfig.json` — TS 설정
- `LinearServer/wrangler.toml` — Worker + Durable Object 바인딩, 시크릿 변수 선언
- `LinearServer/vitest.config.ts` — 단위 테스트 설정
- `LinearServer/src/protocol.ts` — relay↔앱 메시지 타입
- `LinearServer/src/signature.ts` — Linear 서명(HMAC-SHA256) 검증 순수 함수
- `LinearServer/src/event-buffer.ts` — 최근 N초 이벤트 링 버퍼 순수 클래스
- `LinearServer/src/relay-do.ts` — `RelayDurableObject`: WS 연결 유지/broadcast/replay
- `LinearServer/src/worker.ts` — Worker 엔트리: `/webhook`(POST), `/connect`(WS upgrade) 라우팅
- `LinearServer/test/signature.test.ts`
- `LinearServer/test/event-buffer.test.ts`
- `LinearServer/test/integration.test.ts` — wrangler dev 대상 통합 테스트

### Part 2 — Electron 앱 (`LinearApp/`)

- `LinearApp/package.json` — electron, electron-builder, typescript, vitest
- `LinearApp/tsconfig.json`
- `LinearApp/vitest.config.ts`
- `LinearApp/src/shared/protocol.ts` — relay 메시지 타입(서버와 동일 형태)
- `LinearApp/src/shared/types.ts` — Rule/FilterCondition/Identity/Settings 타입
- `LinearApp/src/main/rule-engine.ts` — 순수 규칙 평가 + 표시 텍스트 생성
- `LinearApp/src/main/backoff.ts` — 재연결 지수 백오프 계산(순수)
- `LinearApp/src/main/config-store.ts` — 설정/규칙 로컬 JSON 저장·로드
- `LinearApp/src/main/ws-client.ts` — relay WebSocket 클라이언트(자동 재연결)
- `LinearApp/src/main/notification-manager.ts` — 중앙 알림창 스택 관리
- `LinearApp/src/main/main.ts` — Electron 엔트리: 트레이/창/배선
- `LinearApp/src/preload/settings-preload.ts` — 설정창 IPC 브리지
- `LinearApp/src/preload/notification-preload.ts` — 알림창 IPC 브리지
- `LinearApp/src/renderer/notification/index.html` + `notification.ts` + `notification.css`
- `LinearApp/src/renderer/settings/index.html` + `settings.ts` + `settings.css`
- `LinearApp/test/rule-engine.test.ts`
- `LinearApp/test/backoff.test.ts`
- `LinearApp/test/config-store.test.ts`

---

# Part 1 — Relay (Cloudflare Workers)

## Task 1: LinearServer 스캐폴딩

**Files:**
- Create: `LinearServer/package.json`
- Create: `LinearServer/tsconfig.json`
- Create: `LinearServer/wrangler.toml`
- Create: `LinearServer/vitest.config.ts`

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "linear-noti-relay",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240620.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.60.0"
  }
}
```

- [ ] **Step 2: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: wrangler.toml 작성**

```toml
name = "linear-noti-relay"
main = "src/worker.ts"
compatibility_date = "2024-06-20"

[[durable_objects.bindings]]
name = "RELAY"
class_name = "RelayDurableObject"

[[migrations]]
tag = "v1"
new_classes = ["RelayDurableObject"]

# 시크릿은 `wrangler secret put` 으로 등록:
#   LINEAR_WEBHOOK_SECRET  — Linear webhook 서명 검증용
#   APP_AUTH_TOKEN         — 데스크탑 앱 WS 접속 토큰
```

- [ ] **Step 4: vitest.config.ts 작성**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: 의존성 설치 확인**

Run: `cd LinearServer && npm install`
Expected: 에러 없이 설치 완료, `node_modules` 생성.

- [ ] **Step 6: Commit**

```bash
git add LinearServer/package.json LinearServer/tsconfig.json LinearServer/wrangler.toml LinearServer/vitest.config.ts
git commit -m "chore: scaffold LinearServer relay (Cloudflare Workers)"
```

---

## Task 2: Linear 서명 검증 (순수 함수, TDD)

Linear는 webhook 본문을 webhook secret으로 HMAC-SHA256 서명해 `Linear-Signature`
헤더(hex)로 보낸다. 이 헤더와 본문으로 직접 계산한 서명을 상수시간 비교한다.

**Files:**
- Create: `LinearServer/src/signature.ts`
- Test: `LinearServer/test/signature.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// LinearServer/test/signature.test.ts
import { describe, it, expect } from "vitest";
import { verifyLinearSignature, computeSignature } from "../src/signature";

const SECRET = "test-secret";

describe("verifyLinearSignature", () => {
  it("유효한 서명이면 true", async () => {
    const body = JSON.stringify({ action: "create", type: "Issue" });
    const sig = await computeSignature(body, SECRET);
    expect(await verifyLinearSignature(body, sig, SECRET)).toBe(true);
  });

  it("본문이 변조되면 false", async () => {
    const body = JSON.stringify({ action: "create", type: "Issue" });
    const sig = await computeSignature(body, SECRET);
    expect(await verifyLinearSignature(body + "x", sig, SECRET)).toBe(false);
  });

  it("서명 헤더가 비어 있으면 false", async () => {
    expect(await verifyLinearSignature("{}", "", SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd LinearServer && npx vitest run test/signature.test.ts`
Expected: FAIL — `../src/signature` 모듈 없음.

- [ ] **Step 3: 최소 구현 작성**

```ts
// LinearServer/src/signature.ts

// Web Crypto(subtle)로 HMAC-SHA256 hex 서명을 계산한다. Workers/Node 모두 globalThis.crypto 제공.
export async function computeSignature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 상수시간 비교(길이 다르면 즉시 false).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyLinearSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;
  const expected = await computeSignature(body, secret);
  return timingSafeEqual(signature, expected);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd LinearServer && npx vitest run test/signature.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add LinearServer/src/signature.ts LinearServer/test/signature.test.ts
git commit -m "feat(relay): add Linear webhook signature verification"
```

---

## Task 3: 이벤트 버퍼 (순수 클래스, TDD)

앱이 잠깐 끊겼다 재연결하면 놓친 이벤트를 돌려주기 위해 최근 N밀리초 이벤트만 보관한다.

**Files:**
- Create: `LinearServer/src/protocol.ts`
- Create: `LinearServer/src/event-buffer.ts`
- Test: `LinearServer/test/event-buffer.test.ts`

- [ ] **Step 1: 프로토콜 타입 작성**

```ts
// LinearServer/src/protocol.ts
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
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// LinearServer/test/event-buffer.test.ts
import { describe, it, expect } from "vitest";
import { EventBuffer } from "../src/event-buffer";
import type { LinearWebhookEvent } from "../src/protocol";

const ev = (id: string): LinearWebhookEvent => ({ action: "create", type: "Issue", data: { id } });

describe("EventBuffer", () => {
  it("윈도우 내 이벤트만 since 이후로 돌려준다", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("a"), 1000);
    buf.add(ev("b"), 2000);
    const got = buf.since(1500);
    expect(got.map((m) => (m.event.data as any).id)).toEqual(["b"]);
  });

  it("윈도우보다 오래된 이벤트는 add 시 제거된다", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("old"), 1000);
    buf.add(ev("new"), 1000 + 61_000); // old는 윈도우 밖
    expect(buf.since(0).map((m) => (m.event.data as any).id)).toEqual(["new"]);
  });

  it("since가 모든 이벤트보다 미래면 빈 배열", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("a"), 1000);
    expect(buf.since(5000)).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd LinearServer && npx vitest run test/event-buffer.test.ts`
Expected: FAIL — `EventBuffer` 없음.

- [ ] **Step 4: 최소 구현 작성**

```ts
// LinearServer/src/event-buffer.ts
import type { LinearWebhookEvent, RelayMessage } from "./protocol";

export class EventBuffer {
  private items: RelayMessage[] = [];
  constructor(private windowMs: number) {}

  add(event: LinearWebhookEvent, now: number): RelayMessage {
    const msg: RelayMessage = { kind: "event", receivedAt: now, event };
    this.items.push(msg);
    const cutoff = now - this.windowMs;
    this.items = this.items.filter((m) => m.receivedAt >= cutoff);
    return msg;
  }

  // since(ms) 이후에 받은 이벤트를 replay 메시지로 반환.
  since(timestamp: number): RelayMessage[] {
    return this.items
      .filter((m) => m.receivedAt > timestamp)
      .map((m) => ({ ...m, kind: "replay" as const }));
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd LinearServer && npx vitest run test/event-buffer.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add LinearServer/src/protocol.ts LinearServer/src/event-buffer.ts LinearServer/test/event-buffer.test.ts
git commit -m "feat(relay): add 60s event buffer for reconnect replay"
```

---

## Task 4: Relay Durable Object

WebSocket hibernation API로 앱 연결을 유지하고, 들어온 이벤트를 모든 연결에 broadcast하며,
재연결 시 `?since=<ms>` 쿼리로 버퍼를 replay한다.

**Files:**
- Create: `LinearServer/src/relay-do.ts`

- [ ] **Step 1: Durable Object 구현 작성**

```ts
// LinearServer/src/relay-do.ts
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
```

- [ ] **Step 2: 타입 체크**

Run: `cd LinearServer && npx tsc --noEmit`
Expected: 에러 없음. (worker.ts가 아직 없어도 `relay-do.ts` 단독 타입은 통과해야 함)

> 주의: `Date.now()`는 Worker 런타임에서 정상 동작한다(이 제약은 워크플로 스크립트에만 해당). 단위 테스트에서는 Task 3처럼 시간을 주입하므로 결정적이다.

- [ ] **Step 3: Commit**

```bash
git add LinearServer/src/relay-do.ts
git commit -m "feat(relay): add RelayDurableObject with WS broadcast and replay"
```

---

## Task 5: Worker 엔트리 (라우팅 + 검증)

`/webhook`(Linear POST): 서명 검증 → DO `/broadcast` 호출. `/connect`(앱 WS): `?token=` 검증
→ DO `/connect`로 포워드. 단일 사용자이므로 고정 DO 인스턴스 이름 `"main"` 사용.

**Files:**
- Create: `LinearServer/src/worker.ts`

- [ ] **Step 1: Worker 구현 작성**

```ts
// LinearServer/src/worker.ts
import { verifyLinearSignature } from "./signature";
export { RelayDurableObject } from "./relay-do";

interface Env {
  RELAY: DurableObjectNamespace;
  LINEAR_WEBHOOK_SECRET: string;
  APP_AUTH_TOKEN: string;
}

function relayStub(env: Env) {
  return env.RELAY.get(env.RELAY.idFromName("main"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1) Linear webhook 수신
    if (url.pathname === "/webhook" && request.method === "POST") {
      const body = await request.text();
      const signature = request.headers.get("Linear-Signature") ?? "";
      const ok = await verifyLinearSignature(body, signature, env.LINEAR_WEBHOOK_SECRET);
      if (!ok) return new Response("invalid signature", { status: 401 });

      // 검증된 본문을 DO로 내부 전달
      const stub = relayStub(env);
      await stub.fetch("https://do/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      return new Response("ok");
    }

    // 2) 데스크탑 앱 WS 연결
    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const token = url.searchParams.get("token") ?? "";
      if (token !== env.APP_AUTH_TOKEN) {
        return new Response("unauthorized", { status: 401 });
      }
      const since = url.searchParams.get("since") ?? "0";
      const stub = relayStub(env);
      return stub.fetch(`https://do/connect?since=${encodeURIComponent(since)}`, request);
    }

    return new Response("Linear Noti relay", { status: 200 });
  },
};
```

- [ ] **Step 2: 타입 체크**

Run: `cd LinearServer && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 로컬 dev 기동 확인**

Run: `cd LinearServer && npx wrangler dev --local --port 8787` (백그라운드로 실행)
별도 터미널에서 Run: `curl -s http://localhost:8787/`
Expected: `Linear Noti relay` 출력. 확인 후 dev 프로세스 종료.

- [ ] **Step 4: Commit**

```bash
git add LinearServer/src/worker.ts
git commit -m "feat(relay): add Worker entry routing webhook and app WS"
```

---

## Task 6: Relay 통합 테스트 (wrangler dev 대상)

서명된 webhook을 보내고, WS로 붙은 클라이언트가 그 이벤트를 받는지 실제로 확인한다.

**Files:**
- Create: `LinearServer/test/integration.test.ts`

- [ ] **Step 1: 통합 테스트 작성**

```ts
// LinearServer/test/integration.test.ts
// 사전 조건: 다른 터미널에서 아래로 dev 서버를 띄워둔다(시크릿을 env로 주입):
//   LINEAR_WEBHOOK_SECRET=test-secret APP_AUTH_TOKEN=test-token \
//     npx wrangler dev --local --port 8787 --var LINEAR_WEBHOOK_SECRET:test-secret --var APP_AUTH_TOKEN:test-token
import { describe, it, expect } from "vitest";
import { computeSignature } from "../src/signature";

const BASE = "http://localhost:8787";
const WS = "ws://localhost:8787";

describe("relay integration", () => {
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

  it("잘못된 토큰은 401", async () => {
    const res = await fetch(`${BASE}/connect?token=wrong`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: dev 서버 기동 후 테스트 실행**

터미널 1 Run:
`cd LinearServer && npx wrangler dev --local --port 8787 --var LINEAR_WEBHOOK_SECRET:test-secret --var APP_AUTH_TOKEN:test-token`
터미널 2 Run: `cd LinearServer && npx vitest run test/integration.test.ts`
Expected: PASS (2 passed). 확인 후 dev 종료.

- [ ] **Step 3: Commit**

```bash
git add LinearServer/test/integration.test.ts
git commit -m "test(relay): add end-to-end webhook->WS integration test"
```

---

# Part 2 — Electron 앱

## Task 7: LinearApp 스캐폴딩

**Files:**
- Create: `LinearApp/package.json`
- Create: `LinearApp/tsconfig.json`
- Create: `LinearApp/vitest.config.ts`

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "linear-noti-app",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main/main.js",
  "scripts": {
    "build": "tsc",
    "start": "tsc && electron .",
    "test": "vitest run",
    "dist": "tsc && electron-builder"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-builder": "^24.13.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/ws": "^8.5.10"
  },
  "dependencies": {
    "ws": "^8.17.0",
    "electron-store": "^8.2.0"
  },
  "build": {
    "appId": "com.woogun.linearnoti",
    "files": ["dist/**/*", "src/renderer/**/*"],
    "mac": { "target": "dmg" },
    "win": { "target": "nsis" }
  }
}
```

- [ ] **Step 2: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["es2022", "dom"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: vitest.config.ts 작성**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 4: 설치 확인**

Run: `cd LinearApp && npm install`
Expected: 설치 완료.

- [ ] **Step 5: Commit**

```bash
git add LinearApp/package.json LinearApp/tsconfig.json LinearApp/vitest.config.ts
git commit -m "chore: scaffold LinearApp (Electron + TypeScript)"
```

---

## Task 8: 공유 타입 정의

**Files:**
- Create: `LinearApp/src/shared/protocol.ts`
- Create: `LinearApp/src/shared/types.ts`

- [ ] **Step 1: protocol.ts 작성 (relay와 동일 형태)**

```ts
// LinearApp/src/shared/protocol.ts
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
```

- [ ] **Step 2: types.ts 작성**

```ts
// LinearApp/src/shared/types.ts
export type FilterKind = "team" | "project" | "label" | "assignee" | "mentionsMe" | "keyword";

export interface FilterCondition {
  kind: FilterKind;
  value?: string; // mentionsMe 외에는 비교 대상 문자열
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  eventTypes: string[];   // 예: ["Issue","Comment"] — 비어있으면 모든 타입
  actions: string[];      // 예: ["create","update"] — 비어있으면 모든 액션
  filters: FilterCondition[]; // 모두 만족해야 매칭(AND)
}

export interface Identity {
  id: string;   // 내 Linear user id (assignee 비교용)
  name: string; // 멘션 매칭용 표시 이름/핸들
}

export interface Settings {
  relayUrl: string;   // 예: wss://linear-noti-relay.<account>.workers.dev
  authToken: string;
  me: Identity;
  rules: Rule[];
}

export const DEFAULT_SETTINGS: Settings = {
  relayUrl: "",
  authToken: "",
  me: { id: "", name: "" },
  rules: [],
};
```

- [ ] **Step 3: 타입 체크**

Run: `cd LinearApp && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add LinearApp/src/shared/
git commit -m "feat(app): add shared protocol and settings types"
```

---

## Task 9: 규칙 엔진 (순수 모듈, TDD)

앱의 핵심. 이벤트와 규칙들을 받아 매칭 여부와 표시할 텍스트를 만든다.

**Files:**
- Create: `LinearApp/src/main/rule-engine.ts`
- Test: `LinearApp/test/rule-engine.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// LinearApp/test/rule-engine.test.ts
import { describe, it, expect } from "vitest";
import { evaluateEvent } from "../src/main/rule-engine";
import type { Rule, Identity } from "../src/shared/types";
import type { LinearWebhookEvent } from "../src/shared/protocol";

const me: Identity = { id: "user_me", name: "woogun" };

const rule = (over: Partial<Rule>): Rule => ({
  id: "r1", name: "r1", enabled: true, eventTypes: [], actions: [], filters: [], ...over,
});

const issue = (over: Partial<LinearWebhookEvent> = {}): LinearWebhookEvent => ({
  action: "create",
  type: "Issue",
  data: { id: "I1", identifier: "ENG-1", title: "Fix login", description: "broken",
          labels: [{ name: "urgent" }], team: { key: "ENG", name: "Engineering" },
          project: { name: "Auth" }, assignee: { id: "user_me", name: "woogun" } },
  actor: { id: "user_x", name: "Alice" },
  ...over,
});

describe("evaluateEvent", () => {
  it("이벤트 타입이 규칙과 다르면 매칭 안 됨", () => {
    const r = rule({ eventTypes: ["Comment"] });
    expect(evaluateEvent(issue(), [r], me).matched).toBe(false);
  });

  it("타입만 맞고 필터 없으면 매칭", () => {
    const r = rule({ eventTypes: ["Issue"] });
    expect(evaluateEvent(issue(), [r], me).matched).toBe(true);
  });

  it("label 필터 일치 시 매칭", () => {
    const r = rule({ eventTypes: ["Issue"], filters: [{ kind: "label", value: "urgent" }] });
    expect(evaluateEvent(issue(), [r], me).matched).toBe(true);
  });

  it("label 필터 불일치 시 매칭 안 됨", () => {
    const r = rule({ eventTypes: ["Issue"], filters: [{ kind: "label", value: "p0" }] });
    expect(evaluateEvent(issue(), [r], me).matched).toBe(false);
  });

  it("여러 필터는 AND", () => {
    const r = rule({ eventTypes: ["Issue"],
      filters: [{ kind: "label", value: "urgent" }, { kind: "team", value: "ENG" }] });
    expect(evaluateEvent(issue(), [r], me).matched).toBe(true);
    const r2 = rule({ eventTypes: ["Issue"],
      filters: [{ kind: "label", value: "urgent" }, { kind: "team", value: "OPS" }] });
    expect(evaluateEvent(issue(), [r2], me).matched).toBe(false);
  });

  it("assignee=나 매칭", () => {
    const r = rule({ eventTypes: ["Issue"], filters: [{ kind: "assignee" }] });
    expect(evaluateEvent(issue(), [r], me).matched).toBe(true);
  });

  it("mentionsMe: 코멘트 본문에 내 핸들 있으면 매칭", () => {
    const comment: LinearWebhookEvent = {
      action: "create", type: "Comment",
      data: { id: "C1", body: "hey @woogun please check", issue: { title: "Fix login" },
              user: { name: "Alice" } },
    };
    const r = rule({ eventTypes: ["Comment"], filters: [{ kind: "mentionsMe" }] });
    expect(evaluateEvent(comment, [r], me).matched).toBe(true);
  });

  it("keyword: 제목/본문에 키워드 포함 시 매칭", () => {
    const r = rule({ eventTypes: ["Issue"], filters: [{ kind: "keyword", value: "login" }] });
    expect(evaluateEvent(issue(), [r], me).matched).toBe(true);
  });

  it("action 필터: 지정한 액션만 매칭", () => {
    const r = rule({ eventTypes: ["Issue"], actions: ["update"] });
    expect(evaluateEvent(issue({ action: "create" }), [r], me).matched).toBe(false);
    expect(evaluateEvent(issue({ action: "update" }), [r], me).matched).toBe(true);
  });

  it("disabled 규칙은 무시", () => {
    const r = rule({ eventTypes: ["Issue"], enabled: false });
    expect(evaluateEvent(issue(), [r], me).matched).toBe(false);
  });

  it("매칭 시 표시 텍스트 생성(이슈)", () => {
    const r = rule({ eventTypes: ["Issue"] });
    const res = evaluateEvent(issue(), [r], me);
    expect(res.text?.title).toContain("ENG-1");
    expect(res.text?.body).toContain("Fix login");
  });

  it("매칭 시 표시 텍스트 생성(코멘트)", () => {
    const comment: LinearWebhookEvent = {
      action: "create", type: "Comment",
      data: { id: "C1", body: "looks good", issue: { title: "Fix login" }, user: { name: "Alice" } },
    };
    const r = rule({ eventTypes: ["Comment"] });
    const res = evaluateEvent(comment, [r], me);
    expect(res.text?.title).toContain("Alice");
    expect(res.text?.body).toContain("looks good");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd LinearApp && npx vitest run test/rule-engine.test.ts`
Expected: FAIL — `evaluateEvent` 없음.

- [ ] **Step 3: 구현 작성**

```ts
// LinearApp/src/main/rule-engine.ts
import type { Rule, Identity, FilterCondition } from "../shared/types";
import type { LinearWebhookEvent } from "../shared/protocol";

export interface NotificationText {
  title: string;
  body: string;
}

export interface EvalResult {
  matched: boolean;
  rule?: Rule;
  text?: NotificationText;
}

function labelNames(event: LinearWebhookEvent): string[] {
  const labels = event.data.labels;
  if (Array.isArray(labels)) return labels.map((l: any) => String(l?.name ?? "").toLowerCase());
  return [];
}

function bodyText(event: LinearWebhookEvent): string {
  const d = event.data;
  return [d.title, d.description, d.body].filter(Boolean).join(" ").toLowerCase();
}

function matchFilter(f: FilterCondition, event: LinearWebhookEvent, me: Identity): boolean {
  const d = event.data;
  const v = (f.value ?? "").toLowerCase();
  switch (f.kind) {
    case "team":
      return [d.team?.key, d.team?.name].some((x) => String(x ?? "").toLowerCase() === v);
    case "project":
      return String(d.project?.name ?? "").toLowerCase() === v;
    case "label":
      return labelNames(event).includes(v);
    case "assignee":
      return String(d.assignee?.id ?? "") === me.id && me.id !== "";
    case "mentionsMe": {
      const text = bodyText(event);
      return (
        (me.name !== "" && text.includes(`@${me.name.toLowerCase()}`)) ||
        (me.id !== "" && text.includes(me.id.toLowerCase()))
      );
    }
    case "keyword":
      return v !== "" && bodyText(event).includes(v);
    default:
      return false;
  }
}

function buildText(event: LinearWebhookEvent): NotificationText {
  const d = event.data;
  const actor = event.actor?.name ?? d.user?.name ?? "Someone";
  if (event.type === "Comment") {
    const issueTitle = d.issue?.title ? ` on "${d.issue.title}"` : "";
    return { title: `${actor} commented${issueTitle}`, body: String(d.body ?? "") };
  }
  // 기본: Issue/Project 등
  const ident = d.identifier ? `${d.identifier} ` : "";
  const verb = event.action === "create" ? "created" : event.action === "remove" ? "removed" : "updated";
  return {
    title: `${actor} ${verb} ${event.type} ${ident}`.trim(),
    body: [d.title, d.name, d.description].filter(Boolean).join("\n"),
  };
}

export function evaluateEvent(event: LinearWebhookEvent, rules: Rule[], me: Identity): EvalResult {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.eventTypes.length > 0 && !rule.eventTypes.includes(event.type)) continue;
    if (rule.actions.length > 0 && !rule.actions.includes(event.action)) continue;
    if (rule.filters.every((f) => matchFilter(f, event, me))) {
      return { matched: true, rule, text: buildText(event) };
    }
  }
  return { matched: false };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd LinearApp && npx vitest run test/rule-engine.test.ts`
Expected: PASS (전체 통과).

- [ ] **Step 5: Commit**

```bash
git add LinearApp/src/main/rule-engine.ts LinearApp/test/rule-engine.test.ts
git commit -m "feat(app): add rule engine with filter matching and text builder"
```

---

## Task 10: 설정 저장소 (TDD)

`electron-store`를 직접 쓰면 Electron 런타임이 필요해 테스트가 어렵다. 순수한 파일
입출력 함수로 분리하고 경로를 주입받게 하여 임시 디렉터리로 테스트한다.

**Files:**
- Create: `LinearApp/src/main/config-store.ts`
- Test: `LinearApp/test/config-store.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// LinearApp/test/config-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, saveSettings } from "../src/main/config-store";
import { DEFAULT_SETTINGS } from "../src/shared/types";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "linearnoti-"));
  file = join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("config-store", () => {
  it("파일 없으면 기본값 반환", () => {
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
  });

  it("저장한 값을 다시 읽으면 동일", () => {
    const s = { ...DEFAULT_SETTINGS, relayUrl: "wss://x", me: { id: "u1", name: "woogun" } };
    saveSettings(file, s);
    expect(loadSettings(file)).toEqual(s);
  });

  it("손상된 JSON이면 기본값 반환", () => {
    saveSettings(file, DEFAULT_SETTINGS);
    require("node:fs").writeFileSync(file, "{ not json");
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd LinearApp && npx vitest run test/config-store.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현 작성**

```ts
// LinearApp/src/main/config-store.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_SETTINGS, type Settings } from "../shared/types";

export function loadSettings(file: string): Settings {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd LinearApp && npx vitest run test/config-store.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add LinearApp/src/main/config-store.ts LinearApp/test/config-store.test.ts
git commit -m "feat(app): add JSON-file config store"
```

---

## Task 11: 재연결 백오프 + WS 클라이언트

백오프 계산은 순수 함수로 TDD하고, 실제 연결/재연결 루프는 그 함수를 사용하는
얇은 클라이언트로 구현한다.

**Files:**
- Create: `LinearApp/src/main/backoff.ts`
- Create: `LinearApp/src/main/ws-client.ts`
- Test: `LinearApp/test/backoff.test.ts`

- [ ] **Step 1: 실패하는 백오프 테스트 작성**

```ts
// LinearApp/test/backoff.test.ts
import { describe, it, expect } from "vitest";
import { nextBackoff } from "../src/main/backoff";

describe("nextBackoff", () => {
  it("시도 횟수에 따라 지수적으로 증가", () => {
    expect(nextBackoff(0)).toBe(1000);
    expect(nextBackoff(1)).toBe(2000);
    expect(nextBackoff(2)).toBe(4000);
  });
  it("최대값 30초로 제한", () => {
    expect(nextBackoff(10)).toBe(30000);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd LinearApp && npx vitest run test/backoff.test.ts`
Expected: FAIL — `nextBackoff` 없음.

- [ ] **Step 3: backoff 구현**

```ts
// LinearApp/src/main/backoff.ts
const BASE = 1000;
const MAX = 30000;
export function nextBackoff(attempt: number): number {
  return Math.min(MAX, BASE * 2 ** attempt);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd LinearApp && npx vitest run test/backoff.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: WS 클라이언트 구현**

```ts
// LinearApp/src/main/ws-client.ts
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
```

- [ ] **Step 6: 타입 체크**

Run: `cd LinearApp && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 7: Commit**

```bash
git add LinearApp/src/main/backoff.ts LinearApp/src/main/ws-client.ts LinearApp/test/backoff.test.ts
git commit -m "feat(app): add reconnecting relay WS client with backoff"
```

---

## Task 12: 알림 매니저 + 알림 렌더러

중앙에 알림창을 띄우고 스택으로 쌓는다. 각 창은 5초 자동 닫힘, 클릭 시 닫힘, 소리 재생.

**Files:**
- Create: `LinearApp/src/preload/notification-preload.ts`
- Create: `LinearApp/src/renderer/notification/index.html`
- Create: `LinearApp/src/renderer/notification/notification.css`
- Create: `LinearApp/src/renderer/notification/notification.ts`
- Create: `LinearApp/src/main/notification-manager.ts`

- [ ] **Step 1: preload 작성**

```ts
// LinearApp/src/preload/notification-preload.ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("notiApi", {
  onContent: (cb: (data: { title: string; body: string }) => void) =>
    ipcRenderer.on("noti:content", (_e, data) => cb(data)),
  dismiss: () => ipcRenderer.send("noti:dismiss"),
});
```

- [ ] **Step 2: 알림 HTML 작성**

```html
<!-- LinearApp/src/renderer/notification/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="notification.css" />
  </head>
  <body>
    <div id="card" title="클릭하면 닫힘">
      <div id="title"></div>
      <div id="body"></div>
    </div>
    <script src="notification.js"></script>
  </body>
</html>
```

- [ ] **Step 3: 알림 CSS 작성**

```css
/* LinearApp/src/renderer/notification/notification.css */
html, body { margin: 0; background: transparent; overflow: hidden; font-family: -apple-system, "Segoe UI", sans-serif; }
#card {
  margin: 8px; padding: 16px 20px; border-radius: 14px;
  background: rgba(28, 28, 32, 0.97); color: #fff; cursor: pointer;
  box-shadow: 0 10px 30px rgba(0,0,0,0.45);
  border: 1px solid rgba(255,255,255,0.08);
}
#title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
#body { font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word;
  max-height: 160px; overflow: hidden; opacity: 0.9; }
```

- [ ] **Step 4: 알림 렌더러 스크립트 작성**

```ts
// LinearApp/src/renderer/notification/notification.ts
declare const notiApi: {
  onContent: (cb: (d: { title: string; body: string }) => void) => void;
  dismiss: () => void;
};

notiApi.onContent((d) => {
  document.getElementById("title")!.textContent = d.title;
  document.getElementById("body")!.textContent = d.body;
});
document.getElementById("card")!.addEventListener("click", () => notiApi.dismiss());
```

- [ ] **Step 5: 알림 매니저 작성**

```ts
// LinearApp/src/main/notification-manager.ts
import { BrowserWindow, screen, shell } from "electron";
import { join } from "node:path";
import type { NotificationText } from "./rule-engine";

const WIDTH = 380;
const HEIGHT = 120;
const GAP = 10;
const AUTO_MS = 5000;

export class NotificationManager {
  private windows: BrowserWindow[] = [];

  show(text: NotificationText) {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, "../preload/notification-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.loadFile(join(__dirname, "../renderer/notification/index.html"));

    win.webContents.once("did-finish-load", () => {
      win.webContents.send("noti:content", text);
      win.showInactive();
      shell.beep(); // 소리
    });

    const dismiss = () => this.close(win);
    win.webContents.ipc.on("noti:dismiss", dismiss);
    const timer = setTimeout(dismiss, AUTO_MS);
    win.on("closed", () => clearTimeout(timer));

    this.windows.push(win);
    this.relayout();
  }

  private close(win: BrowserWindow) {
    const i = this.windows.indexOf(win);
    if (i >= 0) this.windows.splice(i, 1);
    if (!win.isDestroyed()) win.close();
    this.relayout();
  }

  // 화면 중앙을 기준으로 스택을 세로로 쌓는다.
  private relayout() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const totalH = this.windows.length * HEIGHT + (this.windows.length - 1) * GAP;
    let y = Math.round(height / 2 - totalH / 2);
    const x = Math.round(width / 2 - WIDTH / 2);
    for (const win of this.windows) {
      if (!win.isDestroyed()) win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
      y += HEIGHT + GAP;
    }
  }
}
```

- [ ] **Step 6: 빌드 타입 체크**

Run: `cd LinearApp && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 7: Commit**

```bash
git add LinearApp/src/preload/notification-preload.ts LinearApp/src/renderer/notification/ LinearApp/src/main/notification-manager.ts
git commit -m "feat(app): add center notification windows with stacking and auto-dismiss"
```

---

## Task 13: 설정창 (규칙 편집기) + IPC

규칙/연결 정보를 보고 편집하는 창. 단일 사용자용이라 폼은 단순하게: relay URL·토큰·내
정보 + 규칙 목록(JSON 편집 또는 폼). MVP는 규칙을 폼으로 추가/삭제한다.

**Files:**
- Create: `LinearApp/src/preload/settings-preload.ts`
- Create: `LinearApp/src/renderer/settings/index.html`
- Create: `LinearApp/src/renderer/settings/settings.css`
- Create: `LinearApp/src/renderer/settings/settings.ts`

- [ ] **Step 1: preload 작성**

```ts
// LinearApp/src/preload/settings-preload.ts
import { contextBridge, ipcRenderer } from "electron";
import type { Settings } from "../shared/types";

contextBridge.exposeInMainWorld("settingsApi", {
  load: (): Promise<Settings> => ipcRenderer.invoke("settings:load"),
  save: (s: Settings): Promise<void> => ipcRenderer.invoke("settings:save", s),
  test: (): Promise<void> => ipcRenderer.invoke("settings:test"), // 테스트 알림 한 번 띄우기
});
```

- [ ] **Step 2: 설정 HTML 작성**

```html
<!-- LinearApp/src/renderer/settings/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="settings.css" />
  </head>
  <body>
    <h2>연결</h2>
    <label>Relay URL <input id="relayUrl" placeholder="wss://...workers.dev" /></label>
    <label>Auth Token <input id="authToken" /></label>
    <label>내 Linear User ID <input id="meId" /></label>
    <label>내 멘션 핸들(이름) <input id="meName" /></label>

    <h2>규칙</h2>
    <p class="hint">규칙은 JSON 배열로 편집합니다. 각 규칙: { name, enabled, eventTypes[], actions[], filters[] }</p>
    <textarea id="rules" rows="14" spellcheck="false"></textarea>
    <div id="error" class="error"></div>

    <div class="row">
      <button id="save">저장</button>
      <button id="test">테스트 알림</button>
    </div>
    <script src="settings.js"></script>
  </body>
</html>
```

- [ ] **Step 3: 설정 CSS 작성**

```css
/* LinearApp/src/renderer/settings/settings.css */
body { font-family: -apple-system, "Segoe UI", sans-serif; padding: 20px; max-width: 640px; }
h2 { margin: 18px 0 8px; font-size: 15px; }
label { display: block; margin: 6px 0; font-size: 13px; }
input, textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 13px;
  font-family: ui-monospace, monospace; margin-top: 2px; }
.hint { color: #666; font-size: 12px; }
.error { color: #c0392b; font-size: 12px; min-height: 16px; white-space: pre-wrap; }
.row { margin-top: 14px; display: flex; gap: 8px; }
button { padding: 8px 16px; font-size: 13px; cursor: pointer; }
```

- [ ] **Step 4: 설정 렌더러 스크립트 작성**

```ts
// LinearApp/src/renderer/settings/settings.ts
import type { Settings } from "../../shared/types";

declare const settingsApi: {
  load: () => Promise<Settings>;
  save: (s: Settings) => Promise<void>;
  test: () => Promise<void>;
};

const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLTextAreaElement;

async function init() {
  const s = await settingsApi.load();
  $("relayUrl").value = s.relayUrl;
  $("authToken").value = s.authToken;
  $("meId").value = s.me.id;
  $("meName").value = s.me.name;
  $("rules").value = JSON.stringify(s.rules, null, 2);
}

$("save").addEventListener("click", async () => {
  $("error").textContent = "";
  let rules;
  try {
    rules = JSON.parse($("rules").value || "[]");
    if (!Array.isArray(rules)) throw new Error("규칙은 배열이어야 합니다");
  } catch (e: any) {
    $("error").textContent = "규칙 JSON 오류: " + e.message;
    return;
  }
  const s: Settings = {
    relayUrl: $("relayUrl").value.trim(),
    authToken: $("authToken").value.trim(),
    me: { id: $("meId").value.trim(), name: $("meName").value.trim() },
    rules,
  };
  await settingsApi.save(s);
  $("error").textContent = "저장됨 ✓";
});

$("test").addEventListener("click", () => settingsApi.test());

init();
```

- [ ] **Step 5: 타입 체크**

Run: `cd LinearApp && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: Commit**

```bash
git add LinearApp/src/preload/settings-preload.ts LinearApp/src/renderer/settings/
git commit -m "feat(app): add settings window with rule JSON editor"
```

---

## Task 14: 메인 프로세스 배선 (트레이/IPC/글루)

모든 조각을 연결한다: 설정 로드 → WS 클라이언트 시작 → 메시지마다 규칙 평가 → 매칭 시
알림. 트레이 메뉴로 설정창 열기/종료. IPC 핸들러(`settings:load/save/test`) 등록.

**Files:**
- Create: `LinearApp/src/main/main.ts`

- [ ] **Step 1: main.ts 작성**

```ts
// LinearApp/src/main/main.ts
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } from "electron";
import { join } from "node:path";
import { loadSettings, saveSettings } from "./config-store";
import { evaluateEvent } from "./rule-engine";
import { RelayClient } from "./ws-client";
import { NotificationManager } from "./notification-manager";
import type { Settings } from "../shared/types";

const settingsFile = () => join(app.getPath("userData"), "settings.json");

let tray: Tray | null = null;
let settingsWin: BrowserWindow | null = null;
let settings: Settings;
const notifications = new NotificationManager();
let client: RelayClient;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 680,
    height: 720,
    title: "Linear Noti 설정",
    webPreferences: {
      preload: join(__dirname, "../preload/settings-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(join(__dirname, "../renderer/settings/index.html"));
}

function buildTray() {
  // 빈 이미지로 트레이 생성(아이콘 자산은 추후 교체)
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Linear Noti");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "설정 열기", click: openSettings },
      { type: "separator" },
      { label: "종료", click: () => app.quit() },
    ]),
  );
}

function handleMessage(eventType: string) {
  // RelayMessage를 받아 규칙 평가 후 매칭 시 알림
  return (msg: any) => {
    const res = evaluateEvent(msg.event, settings.rules, settings.me);
    if (res.matched && res.text) notifications.show(res.text);
  };
}

app.whenReady().then(() => {
  settings = loadSettings(settingsFile());

  ipcMain.handle("settings:load", () => settings);
  ipcMain.handle("settings:save", (_e, s: Settings) => {
    settings = s;
    saveSettings(settingsFile(), s);
    client.stop();
    client.start(); // 새 연결 정보로 재연결
  });
  ipcMain.handle("settings:test", () => {
    notifications.show({ title: "테스트 알림", body: "정중앙 알림이 정상 동작합니다." });
  });

  client = new RelayClient(
    () => ({ relayUrl: settings.relayUrl, authToken: settings.authToken }),
    (msg) => {
      const res = evaluateEvent(msg.event, settings.rules, settings.me);
      if (res.matched && res.text) notifications.show(res.text);
    },
  );
  client.start();

  buildTray();
  openSettings(); // 최초 실행 시 설정창 표시
});

// 트레이 상주 앱: 모든 창을 닫아도 종료하지 않음
app.on("window-all-closed", (e: Electron.Event) => e.preventDefault());
```

> 참고: `handleMessage`는 가독성 위해 남겨둔 헬퍼이나 실제 배선은 `client` 생성 시
> 인라인 콜백을 쓴다. 사용하지 않으면 제거해도 된다(빌드 경고 방지를 위해 제거 권장).

- [ ] **Step 2: 미사용 헬퍼 제거**

`handleMessage` 함수를 삭제한다(인라인 콜백만 사용).

- [ ] **Step 3: 빌드**

Run: `cd LinearApp && npm run build`
Expected: `dist/` 생성, 타입 에러 없음.

- [ ] **Step 4: 앱 실행 + 테스트 알림 확인**

Run: `cd LinearApp && npm start`
화면: 설정창이 뜸 → "테스트 알림" 버튼 클릭 → 화면 정중앙에 알림 카드가 뜨고 5초 후
사라지는지, 클릭하면 즉시 닫히는지, 소리가 나는지 확인. 트레이 메뉴로 종료.

- [ ] **Step 5: Commit**

```bash
git add LinearApp/src/main/main.ts
git commit -m "feat(app): wire main process (tray, IPC, rule eval, notifications)"
```

---

## Task 15: 엔드투엔드 검증 + 패키징

실제 relay 배포 후 Linear webhook을 연결해 전체 흐름을 확인하고, 설치 패키지를 만든다.

- [ ] **Step 1: relay 배포**

Run:
```bash
cd LinearServer
npx wrangler secret put LINEAR_WEBHOOK_SECRET   # Linear webhook 시크릿 입력
npx wrangler secret put APP_AUTH_TOKEN          # 임의의 강한 토큰 입력
npx wrangler deploy
```
Expected: `https://linear-noti-relay.<account>.workers.dev` URL 출력. 이 URL을 기록.

- [ ] **Step 2: Linear webhook 등록**

Linear → Settings → API → Webhooks → New webhook:
- URL: `https://linear-noti-relay.<account>.workers.dev/webhook`
- Secret: Step 1의 `LINEAR_WEBHOOK_SECRET` 와 동일 값
- 구독 이벤트: Issues, Comments, Projects 등 원하는 것 체크
저장.

- [ ] **Step 3: 앱 설정 후 실제 이벤트 확인**

앱 설정창에서 relayUrl을 `wss://linear-noti-relay.<account>.workers.dev`, authToken을
Step 1의 `APP_AUTH_TOKEN`, 내 user id/이름, 규칙(JSON) 입력 후 저장. Linear에서 규칙에
맞는 이벤트(예: 이슈 생성, 나 멘션 코멘트)를 발생시키고 정중앙 알림이 뜨는지 확인.

- [ ] **Step 4: 패키지 빌드**

Run: `cd LinearApp && npm run dist`
Expected: macOS는 `dist/*.dmg`, Windows는 해당 OS에서 `dist/*.exe`(nsis) 생성.
(크로스 빌드는 각 OS에서 수행하거나 CI를 사용.)

- [ ] **Step 5: README 작성 및 커밋**

`LinearNoti/README.md` 에 셋업 순서(릴레이 배포 → 시크릿 → Linear webhook 등록 → 앱
설정)를 정리해 기록한다.

```bash
git add README.md
git commit -m "docs: add setup guide for relay deploy and app config"
```

---

## Self-Review 메모

- **Spec coverage:** webhook 수신/서명검증(Task 2,5), 실시간 WS 전달(Task 4,5), 60초
  버퍼 replay(Task 3,4), 앱 규칙 평가(Task 9), 중앙 알림 5초/클릭/소리/스택(Task 12),
  설정·규칙 편집(Task 13), 트레이 상주(Task 14), 배포/패키징(Task 15) — 모두 커버.
- **타입 일관성:** `RelayMessage`/`LinearWebhookEvent`는 서버(`src/protocol.ts`)와
  앱(`src/shared/protocol.ts`)에서 동일 형태로 중복 정의(단일 사용자 소규모라 의도적
  중복). `NotificationText`는 rule-engine에서 정의해 notification-manager가 import.
- **YAGNI 준수:** 멀티유저/Linear 열기/폴링/API 토큰/규칙별 소리 설정 제외(스펙과 일치).
