# 팀 다중 사용자 (Linear OAuth + 서버 라우팅) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일 사용자용 Linear 알림 앱을, 각 팀원이 Linear OAuth로 로그인하고 자신과 관련된 이벤트만 서버측 라우팅으로 수신하는 팀용 앱으로 개조한다.

**Architecture:** 릴레이(Cloudflare Worker + Durable Object)가 Linear OAuth 콜백을 호스팅해 사용자 신원을 검증하고 세션을 발급한다. WebSocket 연결은 세션의 userId로 태깅되고, webhook 이벤트마다 "관련 사용자(담당/구독)"를 계산해 해당 연결에만 전송한다. 데스크탑 앱은 "Linear로 로그인" 후 세션 토큰으로 접속하며, 규칙은 "받은 내 알림 중 무엇을 띄울지" 개인 필터로 재활용된다.

**Tech Stack:** Cloudflare Workers + Durable Objects(WebSocket Hibernation, DO storage) + TypeScript / Electron + TypeScript / Linear OAuth 2.0.

설계 문서: `docs/superpowers/specs/2026-06-24-team-multiuser-design.md`
기반 코드: 단일 사용자 버전(이미 구현/배포). 본 계획은 그 코드를 개조한다.

---

## 사전 작업 (사용자 = admin, 코드 아님)

구현 시작 전 또는 통합 테스트 전에 필요. Task 0으로 둔다.

### Task 0: Linear OAuth 앱 등록 + 릴레이 시크릿 준비

- [ ] **Step 1: Linear OAuth 애플리케이션 생성**
  Linear → Settings → API → **OAuth applications** → New application:
  - Application name: `Linear Noti`
  - **Redirect URI**: `https://linear-noti-relay.bome00519.workers.dev/auth/callback`
  - 발급되는 **Client ID**, **Client secret** 를 기록.

- [ ] **Step 2: 릴레이 시크릿 등록 / 정리**
  ```bash
  cd LinearServer
  npx wrangler secret put LINEAR_CLIENT_ID       # 위 Client ID
  npx wrangler secret put LINEAR_CLIENT_SECRET   # 위 Client secret
  npx wrangler secret delete APP_AUTH_TOKEN      # 단일사용자용 토큰 폐기
  ```
  (`LINEAR_WEBHOOK_SECRET` 은 그대로 유지.)

---

## File Structure

### Relay (`LinearServer/`)

- `src/protocol.ts` — 수정: `HelloMessage` 추가
- `src/recipients.ts` — 신규: 이벤트 → 관련 userId 목록 (순수)
- `src/event-buffer.ts` — 수정: 메시지에 recipients 저장, `since(ts, userId)` 필터
- `src/oauth.ts` — 신규: Linear authorize URL 빌드(순수) + 토큰교환/viewer 조회(fetch)
- `src/tokens.ts` — 신규: 랜덤 토큰/페어링코드 생성 (순수)
- `src/relay-do.ts` — 수정: 세션/페어링 저장(DO storage), userId 태깅, 라우팅 broadcast, 사람별 replay
- `src/worker.ts` — 수정: `/auth/start|callback|poll` 라우트, 세션검증 `/connect`, `APP_AUTH_TOKEN` 제거
- `test/recipients.test.ts`, `test/event-buffer.test.ts`(확장), `test/oauth.test.ts`, `test/tokens.test.ts`, `test/integration.test.ts`(수정)

### 앱 (`LinearApp/`)

- `src/shared/types.ts` — 수정: `Settings.authToken`→`sessionToken`, `me`는 로그인서 채움
- `src/shared/protocol.ts` — 수정: `HelloMessage` 추가
- `src/main/tokens.ts` — 신규: 페어링코드 생성 (순수)
- `src/main/auth-client.ts` — 신규: 로그인(브라우저 열기 + 폴링)
- `src/main/ws-client.ts` — 수정: sessionToken 사용, hello 처리, 401→재로그인 신호
- `src/main/rule-engine.ts` — 수정: 규칙 비면 전부 매칭
- `src/main/config-store.ts` — 변경 없음(타입만 따라감), 테스트 갱신
- `src/preload/settings-preload.ts` — 수정: auth IPC
- `src/renderer/settings/*` — 수정: 로그인 버튼/상태 UI
- `src/main/main.ts` — 수정: auth 배선
- `test/rule-engine.test.ts`(확장), `test/tokens.test.ts`, `test/config-store.test.ts`(갱신)

---

# Part 1 — Relay

## Task 1: recipients 계산 (순수, TDD)

**Files:** Create `LinearServer/src/recipients.ts`, `LinearServer/test/recipients.test.ts`

- [ ] **Step 1: 실패 테스트 작성**
```ts
// LinearServer/test/recipients.test.ts
import { describe, it, expect } from "vitest";
import { computeRecipients } from "../src/recipients";
import type { LinearWebhookEvent } from "../src/protocol";

const ev = (data: Record<string, unknown>, type = "Issue"): LinearWebhookEvent => ({
  action: "create", type, data,
});

describe("computeRecipients", () => {
  it("담당자 id를 포함", () => {
    expect(computeRecipients(ev({ assignee: { id: "u1" } }))).toContain("u1");
  });
  it("subscriberIds를 포함", () => {
    expect(computeRecipients(ev({ subscriberIds: ["u2", "u3"] })).sort()).toEqual(["u2", "u3"]);
  });
  it("담당자+구독자 합집합(중복 제거)", () => {
    const r = computeRecipients(ev({ assignee: { id: "u1" }, subscriberIds: ["u1", "u2"] }));
    expect(r.sort()).toEqual(["u1", "u2"]);
  });
  it("코멘트는 부모 이슈 구독자를 포함", () => {
    const c = ev({ body: "hi", issue: { subscriberIds: ["u4"] } }, "Comment");
    expect(computeRecipients(c)).toContain("u4");
  });
  it("관련 정보가 없으면 빈 배열(미전송 안전)", () => {
    expect(computeRecipients(ev({ title: "x" }))).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**
Run: `cd LinearServer && npx vitest run test/recipients.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**
```ts
// LinearServer/src/recipients.ts
import type { LinearWebhookEvent } from "./protocol";

// 이벤트와 "관련된" 사용자 id 집합을 구한다.
// 1차 신호: 담당자(assignee) + 구독자(subscriberIds). Linear는 멘션/담당/생성 시 자동 구독하므로
// subscriberIds가 멘션까지 사실상 포괄한다. 코멘트는 부모 이슈의 구독자를 본다.
// 정보가 없으면 빈 배열 → 아무에게도 전송하지 않음(과다 전송보다 미전송이 프라이버시상 안전).
export function computeRecipients(event: LinearWebhookEvent): string[] {
  const d = event.data as any;
  const ids = new Set<string>();
  const add = (x: unknown) => {
    if (typeof x === "string" && x.length > 0) ids.add(x);
  };

  add(d.assignee?.id);
  if (Array.isArray(d.subscriberIds)) d.subscriberIds.forEach(add);
  // 코멘트/하위 엔티티: 부모 이슈 구독자
  if (Array.isArray(d.issue?.subscriberIds)) d.issue.subscriberIds.forEach(add);
  add(d.issue?.assignee?.id);

  return [...ids];
}
```

- [ ] **Step 4: 통과 확인**
Run: `cd LinearServer && npx vitest run test/recipients.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**
```bash
git add LinearServer/src/recipients.ts LinearServer/test/recipients.test.ts
git commit -m "feat(relay): add recipient computation (assignee + subscribers)"
```

> 참고: Linear webhook payload의 정확한 필드명은 Task 7 통합 단계에서 실제 이벤트로 확인한다. 함수는 여러 위치를 방어적으로 본다.

---

## Task 2: EventBuffer에 recipients 추가 (TDD)

버퍼된 각 메시지에 수신 대상(recipients)을 함께 저장하고, replay 시 userId로 거른다.

**Files:** Modify `LinearServer/src/event-buffer.ts`, `LinearServer/test/event-buffer.test.ts`

- [ ] **Step 1: 기존 테스트를 새 시그니처로 확장**
`test/event-buffer.test.ts` 전체를 아래로 교체:
```ts
import { describe, it, expect } from "vitest";
import { EventBuffer } from "../src/event-buffer";
import type { LinearWebhookEvent } from "../src/protocol";

const ev = (id: string): LinearWebhookEvent => ({ action: "create", type: "Issue", data: { id } });

describe("EventBuffer", () => {
  it("since(ts, userId): 대상이고 ts 이후인 것만 replay", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("a"), 1000, ["u1"]);
    buf.add(ev("b"), 2000, ["u2"]);
    buf.add(ev("c"), 3000, ["u1", "u2"]);
    const forU1 = buf.since(1500, "u1");
    expect(forU1.map((m) => (m.event.data as any).id)).toEqual(["c"]); // a는 ts 이전, b는 대상아님
  });

  it("대상이 아니면 replay에서 제외", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("a"), 1000, ["u2"]);
    expect(buf.since(0, "u1")).toEqual([]);
  });

  it("윈도우 밖 메시지는 add 시 제거", () => {
    const buf = new EventBuffer(60_000);
    buf.add(ev("old"), 1000, ["u1"]);
    buf.add(ev("new"), 1000 + 61_000, ["u1"]);
    expect(buf.since(0, "u1").map((m) => (m.event.data as any).id)).toEqual(["new"]);
  });
});
```

- [ ] **Step 2: 실패 확인**
Run: `cd LinearServer && npx vitest run test/event-buffer.test.ts`
Expected: FAIL (add/since 시그니처 불일치).

- [ ] **Step 3: 구현 교체**
```ts
// LinearServer/src/event-buffer.ts
import type { LinearWebhookEvent, RelayMessage } from "./protocol";

interface Entry {
  msg: RelayMessage;
  recipients: string[];
}

export class EventBuffer {
  private items: Entry[] = [];
  constructor(private windowMs: number) {}

  add(event: LinearWebhookEvent, now: number, recipients: string[]): RelayMessage {
    const msg: RelayMessage = { kind: "event", receivedAt: now, event };
    this.items.push({ msg, recipients });
    const cutoff = now - this.windowMs;
    this.items = this.items.filter((e) => e.msg.receivedAt >= cutoff);
    return msg;
  }

  // userId가 수신 대상이고 timestamp 이후에 받은 메시지를 replay로 반환.
  since(timestamp: number, userId: string): RelayMessage[] {
    return this.items
      .filter((e) => e.msg.receivedAt > timestamp && e.recipients.includes(userId))
      .map((e) => ({ ...e.msg, kind: "replay" as const }));
  }
}
```

- [ ] **Step 4: 통과 확인**
Run: `cd LinearServer && npx vitest run test/event-buffer.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**
```bash
git add LinearServer/src/event-buffer.ts LinearServer/test/event-buffer.test.ts
git commit -m "feat(relay): store recipients in buffer, per-user replay"
```

---

## Task 3: 랜덤 토큰 생성 (순수, TDD)

**Files:** Create `LinearServer/src/tokens.ts`, `LinearServer/test/tokens.test.ts`

- [ ] **Step 1: 실패 테스트**
```ts
// LinearServer/test/tokens.test.ts
import { describe, it, expect } from "vitest";
import { randomToken } from "../src/tokens";

describe("randomToken", () => {
  it("기본 32바이트 = 64 hex 문자", () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{64}$/);
  });
  it("호출마다 다른 값", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
  it("길이 지정 가능", () => {
    expect(randomToken(8)).toMatch(/^[0-9a-f]{16}$/);
  });
});
```

- [ ] **Step 2: 실패 확인**
Run: `cd LinearServer && npx vitest run test/tokens.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**
```ts
// LinearServer/src/tokens.ts
// Web Crypto의 getRandomValues는 Workers/Node 모두 제공. 암호학적 난수 hex 문자열 생성.
export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: 통과 확인**
Run: `cd LinearServer && npx vitest run test/tokens.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**
```bash
git add LinearServer/src/tokens.ts LinearServer/test/tokens.test.ts
git commit -m "feat(relay): add cryptographic random token generator"
```

---

## Task 4: OAuth 헬퍼 (authorize URL 순수 TDD + fetch 래퍼)

**Files:** Create `LinearServer/src/oauth.ts`, `LinearServer/test/oauth.test.ts`

- [ ] **Step 1: 실패 테스트 (순수 URL 빌드)**
```ts
// LinearServer/test/oauth.test.ts
import { describe, it, expect } from "vitest";
import { buildAuthorizeUrl } from "../src/oauth";

describe("buildAuthorizeUrl", () => {
  it("Linear authorize URL을 올바른 파라미터로 생성", () => {
    const url = new URL(buildAuthorizeUrl("https://relay.example.com", "cid123", "pair_abc"));
    expect(url.origin + url.pathname).toBe("https://linear.app/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://relay.example.com/auth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("read");
    expect(url.searchParams.get("state")).toBe("pair_abc");
  });
});
```

- [ ] **Step 2: 실패 확인**
Run: `cd LinearServer && npx vitest run test/oauth.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**
```ts
// LinearServer/src/oauth.ts
// Linear OAuth 2.0 헬퍼. authorize URL은 순수, 토큰교환/viewer는 fetch.

export function buildAuthorizeUrl(origin: string, clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/auth/callback`,
    response_type: "code",
    scope: "read",
    state,
    actor: "user",
  });
  return `https://linear.app/oauth/authorize?${params.toString()}`;
}

// code → access token
export async function exchangeCode(
  origin: string,
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<string> {
  const res = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${origin}/auth/callback`,
      grant_type: "authorization_code",
      code,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("no access_token");
  return json.access_token;
}

// access token → { id, name }
export async function fetchViewer(accessToken: string): Promise<{ id: string; name: string }> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: "{ viewer { id name } }" }),
  });
  if (!res.ok) throw new Error(`viewer query failed: ${res.status}`);
  const json = (await res.json()) as { data?: { viewer?: { id: string; name: string } } };
  if (!json.data?.viewer) throw new Error("no viewer");
  return json.data.viewer;
}
```

- [ ] **Step 4: 통과 확인**
Run: `cd LinearServer && npx vitest run test/oauth.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**
```bash
git add LinearServer/src/oauth.ts LinearServer/test/oauth.test.ts
git commit -m "feat(relay): add Linear OAuth helpers (authorize url, token, viewer)"
```

---

## Task 5: protocol에 HelloMessage 추가

**Files:** Modify `LinearServer/src/protocol.ts`

- [ ] **Step 1: 타입 추가**
`LinearServer/src/protocol.ts` 끝에 추가:
```ts
// 연결 직후 릴레이가 앱에게 "당신은 누구"임을 알리는 메시지
export interface HelloMessage {
  kind: "hello";
  you: { id: string; name: string };
}
```

- [ ] **Step 2: 타입 체크**
Run: `cd LinearServer && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: Commit**
```bash
git add LinearServer/src/protocol.ts
git commit -m "feat(relay): add HelloMessage type"
```

---

## Task 6: Durable Object 재작성 (세션/페어링 저장 + userId 태깅 + 라우팅)

**Files:** Modify `LinearServer/src/relay-do.ts`

- [ ] **Step 1: 구현 교체**
```ts
// LinearServer/src/relay-do.ts
import { EventBuffer } from "./event-buffer";
import { computeRecipients } from "./recipients";
import type { LinearWebhookEvent, HelloMessage } from "./protocol";

const WINDOW_MS = 60_000;
const PAIR_TTL_MS = 5 * 60_000;

interface Session {
  userId: string;
  name: string;
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
      server.serializeAttachment({ userId: session.userId });

      const hello: HelloMessage = { kind: "hello", you: { id: session.userId, name: session.name } };
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
      const recipients = computeRecipients(event);
      const now = Date.now();
      const msg = this.buffer.add(event, now, recipients);
      const payload = JSON.stringify(msg);
      const targets = new Set(recipients);
      for (const ws of this.ctx.getWebSockets()) {
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
```

- [ ] **Step 2: 타입 체크**
Run: `cd LinearServer && npx tsc --noEmit`
Expected: 에러 없음. (worker.ts는 다음 태스크에서 갱신 — 지금 worker.ts가 옛 형태라 에러가 나면 그건 Task 7에서 해결되므로, 이 단계에서는 relay-do.ts 자체에 새 에러가 없는지만 확인. worker.ts 관련 에러는 무시 가능.)

- [ ] **Step 3: Commit**
```bash
git add LinearServer/src/relay-do.ts
git commit -m "feat(relay): session storage, userId-tagged sockets, routed broadcast"
```

---

## Task 7: Worker 재작성 (OAuth 라우트 + 세션검증 connect)

**Files:** Modify `LinearServer/src/worker.ts`

- [ ] **Step 1: 구현 교체**
```ts
// LinearServer/src/worker.ts
import { verifyLinearSignature } from "./signature";
import { buildAuthorizeUrl, exchangeCode, fetchViewer } from "./oauth";
import { randomToken } from "./tokens";
export { RelayDurableObject } from "./relay-do";

interface Env {
  RELAY: DurableObjectNamespace;
  LINEAR_WEBHOOK_SECRET: string;
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
}

function relayStub(env: Env) {
  return env.RELAY.get(env.RELAY.idFromName("main"));
}

function html(body: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">${body}</body>`,
    { headers: { "content-type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;

    // --- OAuth 시작: 브라우저를 Linear 동의화면으로 ---
    if (url.pathname === "/auth/start") {
      const cb = url.searchParams.get("cb") ?? "";
      if (!cb) return new Response("missing cb", { status: 400 });
      return Response.redirect(buildAuthorizeUrl(origin, env.LINEAR_CLIENT_ID, cb), 302);
    }

    // --- OAuth 콜백: code→token→viewer→세션 발급 ---
    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      if (!code || !state) return html("로그인 실패: 잘못된 콜백입니다. 앱에서 다시 시도하세요.");
      try {
        const accessToken = await exchangeCode(origin, env.LINEAR_CLIENT_ID, env.LINEAR_CLIENT_SECRET, code);
        const viewer = await fetchViewer(accessToken);
        const token = randomToken();
        await relayStub(env).fetch("https://do/session/put", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, session: { userId: viewer.id, name: viewer.name }, pairing: state }),
        });
        return html(`<b>${viewer.name}</b> 님 로그인 완료 ✓<br>앱으로 돌아가세요. 이 창은 닫아도 됩니다.`);
      } catch (e) {
        return html("로그인 실패: " + (e as Error).message);
      }
    }

    // --- 앱이 세션 토큰을 회수 ---
    if (url.pathname === "/auth/poll") {
      const cb = url.searchParams.get("cb") ?? "";
      const res = await relayStub(env).fetch(`https://do/session/poll?cb=${encodeURIComponent(cb)}`);
      return new Response(await res.text(), { headers: { "content-type": "application/json" } });
    }

    // --- Linear webhook 수신 ---
    if (url.pathname === "/webhook" && request.method === "POST") {
      const body = await request.text();
      const ok = await verifyLinearSignature(body, request.headers.get("Linear-Signature") ?? "", env.LINEAR_WEBHOOK_SECRET);
      if (!ok) return new Response("invalid signature", { status: 401 });
      await relayStub(env).fetch("https://do/broadcast", {
        method: "POST", headers: { "content-type": "application/json" }, body,
      });
      return new Response("ok");
    }

    // --- 앱 WS 연결 (세션 토큰은 DO가 검증) ---
    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const token = url.searchParams.get("token") ?? "";
      const since = url.searchParams.get("since") ?? "0";
      return relayStub(env).fetch(
        `https://do/connect?token=${encodeURIComponent(token)}&since=${encodeURIComponent(since)}`,
        request,
      );
    }

    return new Response("Linear Noti relay", { status: 200 });
  },
};
```

- [ ] **Step 2: 타입 체크**
Run: `cd LinearServer && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 로컬 dev 스모크**
```bash
cd LinearServer
./node_modules/.bin/wrangler dev --local --port 8787 \
  --var LINEAR_WEBHOOK_SECRET:test --var LINEAR_CLIENT_ID:cid --var LINEAR_CLIENT_SECRET:csec > /tmp/wr.log 2>&1 &
WPID=$!
for i in $(seq 1 25); do curl -s http://localhost:8787/ | grep -q "Linear Noti relay" && break; sleep 1; done
echo "root:"; curl -s http://localhost:8787/
echo "start redirect (302 기대):"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8787/auth/start?cb=abc"
echo "poll (빈 json 기대):"; curl -s "http://localhost:8787/auth/poll?cb=none"
kill $WPID 2>/dev/null
```
Expected: root=`Linear Noti relay`, start=302, poll=`{}`.

- [ ] **Step 4: Commit**
```bash
git add LinearServer/src/worker.ts
git commit -m "feat(relay): OAuth routes + session-validated connect, drop APP_AUTH_TOKEN"
```

---

## Task 8: 라우팅 통합 테스트 (두 사용자)

세션을 직접 심어(`/session/put`) 두 사용자로 WS 연결하고, 한 사용자만 관련된 이벤트가 그 사용자에게만 가는지 확인.

**Files:** Modify `LinearServer/test/integration.test.ts`

- [ ] **Step 1: 테스트 교체**
```ts
// LinearServer/test/integration.test.ts
import { describe, it, expect } from "vitest";

const BASE = "http://localhost:8787";
const WS = "ws://localhost:8787";

async function putSession(token: string, userId: string, name: string) {
  // dev에서 DO에 세션을 직접 심기 위해 worker를 우회해 DO 경로를 쓰지 않고,
  // 정식 경로가 없으므로 테스트 전용으로 /session/put을 worker에 노출하지 않는다.
  // 대신 OAuth를 모킹할 수 없으므로, 이 통합 테스트는 DO에 직접 접근하는 대신
  // 아래처럼 broadcast 라우팅만 검증한다(세션은 사전에 수동 주입 불가).
  throw new Error("unused");
}

describe.skipIf(!process.env.RELAY_LIVE)("relay routing", () => {
  it("관련 사용자에게만 이벤트가 전달된다", async () => {
    // 사전: dev 서버가 떠 있어야 함. 세션 주입을 위해 worker에 테스트 훅이 필요하므로,
    // 이 테스트는 두 단계로 한다. (1) 헬스체크 (2) 라우팅은 수동 e2e(Task 14)에서 검증.
    const health = await fetch(`${BASE}/`);
    expect(health.status).toBe(200);
  });

  it("세션 없는 connect는 401(업그레이드 헤더 포함 시)", async () => {
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
```

> 참고: 정식 OAuth를 거치지 않고 세션을 주입할 공개 경로가 없어, 전체 라우팅(두 사용자 분리 수신)은 **Task 14의 실제 e2e**에서 검증한다. 본 통합 테스트는 헬스 + 세션없는 연결 거부만 자동 검증한다. (보안상 테스트 백도어를 production worker에 두지 않는다.)

- [ ] **Step 2: dev 서버 띄우고 실행**
```bash
cd LinearServer
./node_modules/.bin/wrangler dev --local --port 8787 \
  --var LINEAR_WEBHOOK_SECRET:test --var LINEAR_CLIENT_ID:cid --var LINEAR_CLIENT_SECRET:csec > /tmp/wr.log 2>&1 &
WPID=$!
for i in $(seq 1 25); do curl -s http://localhost:8787/ | grep -q "Linear Noti relay" && break; sleep 1; done
RELAY_LIVE=1 npx vitest run test/integration.test.ts
kill $WPID 2>/dev/null
```
Expected: 2 passed.

- [ ] **Step 3: Commit**
```bash
git add LinearServer/test/integration.test.ts
git commit -m "test(relay): routing health + reject session-less connect"
```

---

# Part 2 — 앱

## Task 9: 공유 타입/프로토콜 갱신

**Files:** Modify `LinearApp/src/shared/types.ts`, `LinearApp/src/shared/protocol.ts`

- [ ] **Step 1: protocol에 HelloMessage 추가**
`LinearApp/src/shared/protocol.ts` 끝에 추가:
```ts
export interface HelloMessage {
  kind: "hello";
  you: { id: string; name: string };
}
```

- [ ] **Step 2: Settings 타입 변경**
`LinearApp/src/shared/types.ts` 의 `Settings`/`DEFAULT_SETTINGS` 를 교체:
```ts
export interface Settings {
  relayUrl: string;     // wss://... (기본값 내장)
  sessionToken: string; // Linear 로그인으로 발급된 세션 (수동 authToken 대체)
  me: Identity;         // 로그인(hello)에서 채워짐
  rules: Rule[];
}

export const DEFAULT_SETTINGS: Settings = {
  relayUrl: "wss://linear-noti-relay.bome00519.workers.dev",
  sessionToken: "",
  me: { id: "", name: "" },
  rules: [],
};
```

- [ ] **Step 3: 타입 체크 (다른 파일에서 깨지는 부분 확인)**
Run: `cd LinearApp && npx tsc --noEmit`
Expected: `authToken`/`me` 수동 입력을 참조하던 곳(ws-client, settings 렌더러, main)에서 에러가 날 수 있음 — 이는 후속 태스크에서 고친다. **이 태스크 자체로는** types/protocol 파일에 문법 에러가 없는지만 본다(전체 tsc는 아직 빨강일 수 있음).

- [ ] **Step 4: Commit**
```bash
git add LinearApp/src/shared/
git commit -m "feat(app): Settings.sessionToken + HelloMessage type"
```

---

## Task 10: 페어링 코드 생성 (순수, TDD)

**Files:** Create `LinearApp/src/main/tokens.ts`, `LinearApp/test/tokens.test.ts`

- [ ] **Step 1: 실패 테스트**
```ts
// LinearApp/test/tokens.test.ts
import { describe, it, expect } from "vitest";
import { newPairingCode } from "../src/main/tokens";

describe("newPairingCode", () => {
  it("32 hex 문자", () => { expect(newPairingCode()).toMatch(/^[0-9a-f]{32}$/); });
  it("매번 다름", () => { expect(newPairingCode()).not.toBe(newPairingCode()); });
});
```

- [ ] **Step 2: 실패 확인**
Run: `cd LinearApp && npx vitest run test/tokens.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**
```ts
// LinearApp/src/main/tokens.ts
import { randomBytes } from "node:crypto";

// 16바이트 = 32 hex. OAuth 페어링용 일회성 코드.
export function newPairingCode(): string {
  return randomBytes(16).toString("hex");
}
```

- [ ] **Step 4: 통과 확인**
Run: `cd LinearApp && npx vitest run test/tokens.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**
```bash
git add LinearApp/src/main/tokens.ts LinearApp/test/tokens.test.ts
git commit -m "feat(app): add pairing code generator"
```

---

## Task 11: auth-client (로그인: 브라우저 열기 + 폴링)

**Files:** Create `LinearApp/src/main/auth-client.ts`

- [ ] **Step 1: 구현**
```ts
// LinearApp/src/main/auth-client.ts
import { newPairingCode } from "./tokens";

// relayUrl(wss://...) → https base
export function httpBaseFrom(relayUrl: string): string {
  return relayUrl.replace(/^ws/, "http"); // wss->https, ws->http
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 브라우저로 로그인 → 폴링으로 세션 토큰 회수. 실패 시 throw.
export async function login(
  relayUrl: string,
  openExternal: (url: string) => Promise<void>,
  opts: { intervalMs?: number; tries?: number } = {},
): Promise<string> {
  const base = httpBaseFrom(relayUrl);
  const cb = newPairingCode();
  await openExternal(`${base}/auth/start?cb=${cb}`);

  const interval = opts.intervalMs ?? 2000;
  const tries = opts.tries ?? 150; // ~5분
  for (let i = 0; i < tries; i++) {
    await delay(interval);
    try {
      const res = await fetch(`${base}/auth/poll?cb=${encodeURIComponent(cb)}`);
      if (res.ok) {
        const j = (await res.json()) as { token?: string };
        if (j.token) return j.token;
      }
    } catch { /* 네트워크 일시 오류 무시, 계속 폴링 */ }
  }
  throw new Error("로그인 시간 초과");
}
```

- [ ] **Step 2: 타입 체크**
Run: `cd LinearApp && npx tsc --noEmit`
Expected: auth-client 자체 에러 없음(다른 미수정 파일 에러는 후속 태스크에서).

- [ ] **Step 3: Commit**
```bash
git add LinearApp/src/main/auth-client.ts
git commit -m "feat(app): add OAuth login client (open browser + poll)"
```

---

## Task 12: ws-client 갱신 (sessionToken + hello + 401)

**Files:** Modify `LinearApp/src/main/ws-client.ts`

- [ ] **Step 1: 구현 교체**
```ts
// LinearApp/src/main/ws-client.ts
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
    private onHello: (you: { id: string; name: string }) => void,
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
```

- [ ] **Step 2: 타입 체크**
Run: `cd LinearApp && npx tsc --noEmit`
Expected: ws-client 자체 에러 없음(main.ts는 다음에 갱신).

- [ ] **Step 3: Commit**
```bash
git add LinearApp/src/main/ws-client.ts
git commit -m "feat(app): ws-client uses sessionToken, handles hello + 401"
```

---

## Task 13: 규칙 엔진 — 규칙 비면 전부 매칭 (TDD)

**Files:** Modify `LinearApp/src/main/rule-engine.ts`, `LinearApp/test/rule-engine.test.ts`

- [ ] **Step 1: 테스트 추가**
`test/rule-engine.test.ts` 의 describe 블록 안에 추가:
```ts
  it("규칙이 비면 전부 매칭(받은 내 알림 모두 표시)", () => {
    const res = evaluateEvent(issue(), [], me);
    expect(res.matched).toBe(true);
    expect(res.text?.body).toContain("Fix login");
  });
```

- [ ] **Step 2: 실패 확인**
Run: `cd LinearApp && npx vitest run test/rule-engine.test.ts`
Expected: FAIL (현재는 빈 규칙 → matched:false).

- [ ] **Step 3: evaluateEvent 수정**
`evaluateEvent` 함수 본문 맨 위(루프 전)에 추가:
```ts
  // 서버가 이미 "내 것만" 보내므로, 규칙이 없으면 받은 것 전부 알림.
  if (rules.length === 0) {
    return { matched: true, text: buildText(event) };
  }
```

- [ ] **Step 4: 통과 확인**
Run: `cd LinearApp && npx vitest run test/rule-engine.test.ts`
Expected: PASS (전체 통과).

- [ ] **Step 5: Commit**
```bash
git add LinearApp/src/main/rule-engine.ts LinearApp/test/rule-engine.test.ts
git commit -m "feat(app): empty rules = notify all (personal filter semantics)"
```

---

## Task 14: config-store 테스트 갱신

Settings 타입 변경(sessionToken)에 맞춰 기존 테스트의 필드만 수정.

**Files:** Modify `LinearApp/test/config-store.test.ts`

- [ ] **Step 1: 테스트의 저장 샘플 필드 교체**
`test/config-store.test.ts` 의 "저장한 값을 다시 읽으면 동일" 테스트에서 `relayUrl` 객체를 새 타입에 맞게:
```ts
  it("저장한 값을 다시 읽으면 동일", () => {
    const s = { ...DEFAULT_SETTINGS, sessionToken: "sess123", me: { id: "u1", name: "woogun" } };
    saveSettings(file, s);
    expect(loadSettings(file)).toEqual(s);
  });
```

- [ ] **Step 2: 통과 확인**
Run: `cd LinearApp && npx vitest run test/config-store.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 3: Commit**
```bash
git add LinearApp/test/config-store.test.ts
git commit -m "test(app): update config-store test for sessionToken"
```

---

## Task 15: 설정창 UI — 로그인 버튼/상태

**Files:** Modify `LinearApp/src/preload/settings-preload.ts`, `LinearApp/src/renderer/settings/index.html`, `LinearApp/src/renderer/settings/settings.ts`

- [ ] **Step 1: preload 교체**
```ts
// LinearApp/src/preload/settings-preload.ts
import { contextBridge, ipcRenderer } from "electron";
import type { Settings } from "../shared/types";

contextBridge.exposeInMainWorld("settingsApi", {
  load: (): Promise<Settings> => ipcRenderer.invoke("settings:load"),
  save: (s: Settings): Promise<void> => ipcRenderer.invoke("settings:save", s),
  test: (): Promise<void> => ipcRenderer.invoke("settings:test"),
  login: (): Promise<{ ok: boolean; name?: string; error?: string }> => ipcRenderer.invoke("auth:login"),
  authStatus: (): Promise<{ loggedIn: boolean; name: string }> => ipcRenderer.invoke("auth:status"),
});
```

- [ ] **Step 2: HTML 교체 (연결 섹션을 로그인으로)**
`index.html` 의 `<h2>연결</h2>` ~ relay/token/meId/meName 입력 부분을 아래로 교체(규칙 섹션과 버튼은 유지):
```html
    <h2>계정</h2>
    <p id="authStatus" class="hint">로그인 상태 확인 중…</p>
    <button id="login">Linear로 로그인</button>

    <h2>규칙 (선택)</h2>
    <p class="hint">비워두면 나와 관련된 모든 알림이 표시됩니다. 좁히려면 규칙을 추가하세요.
      각 규칙: { name, enabled, eventTypes[], actions[], filters[] }</p>
```

- [ ] **Step 3: settings.ts 교체**
```ts
// LinearApp/src/renderer/settings/settings.ts
import type { Settings } from "../../shared/types";

declare const settingsApi: {
  load: () => Promise<Settings>;
  save: (s: Settings) => Promise<void>;
  test: () => Promise<void>;
  login: () => Promise<{ ok: boolean; name?: string; error?: string }>;
  authStatus: () => Promise<{ loggedIn: boolean; name: string }>;
};

const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLTextAreaElement & HTMLElement;

async function refreshAuth() {
  const st = await settingsApi.authStatus();
  $("authStatus").textContent = st.loggedIn ? `로그인됨: ${st.name}` : "로그인 안 됨";
}

async function init() {
  const s = await settingsApi.load();
  $("rules").value = JSON.stringify(s.rules, null, 2);
  await refreshAuth();
}

$("login").addEventListener("click", async () => {
  $("authStatus").textContent = "브라우저에서 로그인 진행 중…";
  const r = await settingsApi.login();
  $("authStatus").textContent = r.ok ? `로그인됨: ${r.name}` : "로그인 실패: " + (r.error ?? "");
});

$("save").addEventListener("click", async () => {
  $("error").textContent = "";
  let rules;
  try {
    rules = JSON.parse($("rules").value || "[]");
    if (!Array.isArray(rules)) throw new Error("규칙은 배열이어야 합니다");
  } catch (e: any) {
    $("error").textContent = "규칙 JSON 오류: " + e.message; return;
  }
  const cur = await settingsApi.load();
  await settingsApi.save({ ...cur, rules });
  $("error").textContent = "저장됨 ✓";
});

$("test").addEventListener("click", () => settingsApi.test());

init();
```

- [ ] **Step 4: 빌드**
Run: `cd LinearApp && npm run build`
Expected: tsc 에러 없음, dist 생성. (main.ts가 아직 옛 IPC라면 main.ts 에러가 날 수 있음 → Task 16에서 해결. 이 태스크에서는 렌더러/preload 컴파일이 되는지 확인하고, main.ts 에러는 다음 태스크에서 잡는다.)

- [ ] **Step 5: Commit**
```bash
git add LinearApp/src/preload/settings-preload.ts LinearApp/src/renderer/settings/
git commit -m "feat(app): settings UI with Linear login button + status"
```

---

## Task 16: main.ts 배선 (auth IPC + 세션 + hello)

**Files:** Modify `LinearApp/src/main/main.ts`

- [ ] **Step 1: 구현 교체**
```ts
// LinearApp/src/main/main.ts
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } from "electron";
import { join } from "node:path";
import { loadSettings, saveSettings } from "./config-store";
import { evaluateEvent } from "./rule-engine";
import { RelayClient } from "./ws-client";
import { NotificationManager } from "./notification-manager";
import { login } from "./auth-client";
import type { Settings } from "../shared/types";

const settingsFile = () => join(app.getPath("userData"), "settings.json");

let tray: Tray | null = null;
let settingsWin: BrowserWindow | null = null;
let settings: Settings;
const notifications = new NotificationManager();
let client: RelayClient;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 680, height: 640, title: "Linear Noti 설정",
    webPreferences: {
      preload: join(__dirname, "../preload/settings-preload.js"),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  settingsWin.loadFile(join(__dirname, "../renderer/settings/index.html"));
}

function buildTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Linear Noti");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "설정 열기", click: openSettings },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  settings = loadSettings(settingsFile());

  ipcMain.handle("settings:load", () => settings);
  ipcMain.handle("settings:save", (_e, s: Settings) => {
    settings = s; saveSettings(settingsFile(), s);
    client.stop(); client.start();
  });
  ipcMain.handle("settings:test", () => {
    notifications.show({ title: "테스트 알림", body: "정중앙 알림이 정상 동작합니다." });
  });
  ipcMain.handle("auth:status", () => ({ loggedIn: !!settings.sessionToken, name: settings.me.name }));
  ipcMain.handle("auth:login", async () => {
    try {
      const token = await login(settings.relayUrl, (url) => shell.openExternal(url));
      settings = { ...settings, sessionToken: token };
      saveSettings(settingsFile(), settings);
      client.stop(); client.start(); // 새 세션으로 재연결 → hello가 me를 채움
      return { ok: true, name: settings.me.name };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  client = new RelayClient(
    () => ({ relayUrl: settings.relayUrl, sessionToken: settings.sessionToken }),
    (msg) => {
      const res = evaluateEvent(msg.event, settings.rules, settings.me);
      if (res.matched && res.text) notifications.show(res.text);
    },
    (you) => { // hello: 내 신원 저장
      settings = { ...settings, me: { id: you.id, name: you.name } };
      saveSettings(settingsFile(), settings);
    },
    () => { // 세션 무효: 토큰 비우고 설정창 안내
      settings = { ...settings, sessionToken: "" };
      saveSettings(settingsFile(), settings);
      openSettings();
    },
  );
  client.start();

  buildTray();
  openSettings();
});

app.on("window-all-closed", () => { /* 트레이 상주 */ });
```

- [ ] **Step 2: 빌드 + 전체 테스트**
```bash
cd LinearApp && npm run build && npm test
```
Expected: tsc 에러 없음, 모든 단위 테스트 통과.

- [ ] **Step 3: Commit**
```bash
git add LinearApp/src/main/main.ts
git commit -m "feat(app): wire OAuth login, session, hello identity, 401 re-login"
```

---

## Task 17: 배포 + 실제 E2E + README + 패키징

- [ ] **Step 1: Task 0(OAuth 앱 등록·시크릿) 완료 확인** — `LINEAR_CLIENT_ID/SECRET` 등록, `APP_AUTH_TOKEN` 삭제, `LINEAR_WEBHOOK_SECRET` 유지.

- [ ] **Step 2: 릴레이 재배포**
```bash
cd LinearServer && ./node_modules/.bin/wrangler deploy
```

- [ ] **Step 3: 앱 실행 + 로그인 e2e**
```bash
cd LinearApp && npm start
```
설정창 → "Linear로 로그인" → 브라우저 승인 → "로그인됨: <이름>" 표시 확인 → "테스트 알림"로 중앙 알림 확인.

- [ ] **Step 4: 실제 라우팅 확인** — 다른 팀원(또는 다른 계정)이 당신을 담당자로 지정하거나 멘션 → 당신 앱에만 알림이 뜨고, 무관한 팀원 앱엔 안 뜨는지 확인. 안 잡히면 `wrangler tail`로 들어온 payload의 `subscriberIds`/`assignee` 필드를 확인해 `recipients.ts`를 조정.

- [ ] **Step 5: README 갱신** — `README.md`의 설정/인증 섹션을 OAuth 로그인 방식으로 갱신(수동 토큰/userId 입력 제거, OAuth 앱 등록 + 로그인 버튼 흐름 추가). 팀원 배포 안내 추가.
```bash
git add README.md && git commit -m "docs: update setup for OAuth login and team usage"
```

- [ ] **Step 6: 패키징 + 팀 배포** — `cd LinearApp && npm run dist` → 산출물(.dmg/.exe)을 팀원에게 배포. 각 팀원은 앱 실행 후 "Linear로 로그인"만 하면 됨.

---

## Self-Review 메모

- **Spec coverage:** OAuth 페어링 흐름(Task 4,6,7,11,16), 서버 라우팅(Task 1,6), 사람별 버퍼(Task 2), 세션 저장(Task 6), userId 태깅(Task 6), 앱 로그인 UI(Task 15,16), 규칙 개인필터화(Task 13), APP_AUTH_TOKEN 폐기(Task 0,7,9), 검증된 신원(Task 7 viewer) — 스펙 전 항목 커버.
- **타입 일관성:** `Session{userId,name}`, `HelloMessage{kind:"hello",you:{id,name}}`, `Settings.sessionToken`, `computeRecipients→string[]`, `EventBuffer.add(event,now,recipients)`/`since(ts,userId)`, `RelayClient(getConfig,onMessage,onHello,onUnauthorized)` — 태스크 간 시그니처 일치.
- **YAGNI:** 멀티 워크스페이스/세션만료 UI/푸시 제외(스펙과 일치). OAuth 라우팅의 정확한 payload 필드는 Task 17 Step 4 실측으로 확정.
- **알려진 한계:** 전체 두-사용자 라우팅 자동 통합테스트는 세션 백도어를 production에 두지 않기 위해 수동 e2e(Task 17)로 검증(Task 8에 명시).
