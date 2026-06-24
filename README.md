# LinearNoti

Linear 이벤트를 화면 **정중앙**에 크게 띄워주는 커스텀 알림 데스크탑 앱.
직접 설정한 규칙에 맞는 알림만 표시하고, 5초 자동 사라짐 / 클릭 해제 / 소리 재생 / 스택 표시를 지원한다.
Electron 기반으로 macOS 및 Windows 모두 배포 가능하며, 단일 사용자(개인 워크스페이스)를 위한 MVP다.

---

## 1. 개요

Linear 기본 알림은 우상단에 작게 떠서 놓치기 쉽다. 이 앱은:

- **규칙 기반 필터링** — 설정한 규칙(이벤트 타입 + 조건)에 매칭되는 이벤트만 중앙 알림으로 표시한다.
- **화면 정중앙 알림** — 5초 자동 사라짐, 클릭하면 즉시 닫힘, 소리 재생, 동시 도착 시 스택 표시.
- **실시간 webhook** — 폴링 없이 Linear webhook → Cloudflare Worker relay → WebSocket → 앱으로 실시간 전달.
- **단일 사용자** — 나 혼자 쓰는 개인 워크스페이스 용도.

---

## 2. 구조

프로젝트는 두 부분으로 구성된다.

| 디렉터리 | 역할 |
|---|---|
| `LinearServer/` | Cloudflare Workers + Durable Object 릴레이 (TypeScript) |
| `LinearApp/` | Electron 데스크탑 앱 (TypeScript) |

```
Linear 워크스페이스
    │
    │  서명된 webhook POST (Linear-Signature)
    ▼
Worker  POST /webhook
    │  서명(HMAC-SHA256) 검증 후 DO로 전달
    ▼
Relay Durable Object   ← 최근 ~60초 이벤트 버퍼 보관
    │
    │  WebSocket push (GET /connect?token=...)
    ▼
Electron 앱 (WS 클라이언트, 자동 재연결)
    │
    ▼
규칙 엔진 (rule-engine.ts)   ← 규칙 평가는 앱에서 수행 (릴레이 불관여)
    │
    ▼  매칭 시
화면 정중앙 알림창
```

> **핵심 설계**: 규칙 평가는 Cloudflare가 아니라 **데스크탑 앱**에서 수행한다. 규칙을 바꿔도 서버를 재배포할 필요가 없다.

---

## 3. 사전 준비

| 항목 | 비고 |
|---|---|
| Node.js 20 이상 | 앱 및 릴레이 빌드용. 통합 테스트(`integration.test.ts`)는 전역 WebSocket이 필요해 **Node 22** 이상 권장 |
| Cloudflare 계정 | Workers + Durable Objects 사용 (무료 플랜 가능) |
| Linear 워크스페이스 관리자 권한 | Webhook 등록용 |

---

## 4. 릴레이 배포 (LinearServer)

### 4-1. 설치 및 시크릿 등록

```bash
cd LinearServer
npm install
```

먼저 Cloudflare에 로그인한다(브라우저에서 직접 승인 필요).

```bash
npx wrangler login
```

**앱 인증 토큰**(`APP_AUTH_TOKEN`)을 등록한다. 이 값은 **Linear와 무관하게 우리가 정하는** 임의의 강한 문자열이다(예: `openssl rand -hex 24`로 생성). 데스크탑 앱 설정창의 Auth Token에도 **같은 값**을 넣게 된다.

```bash
npx wrangler secret put APP_AUTH_TOKEN
```

> ⚠️ `LINEAR_WEBHOOK_SECRET`은 여기서 정하는 값이 **아니다**. 이건 **Linear가 webhook을 만들 때 발급하는 Signing secret**이다. 그래서 등록 순서가 **배포(4-2) → Linear webhook 생성(5) → 서명 시크릿 등록(6)** 이 된다. 5단계에서 Linear가 보여주는 secret을 복사해 6단계에서 `npx wrangler secret put LINEAR_WEBHOOK_SECRET`로 등록한다(시크릿은 재배포 없이 즉시 반영됨).

### 4-2. 배포

```bash
npx wrangler deploy
```

배포 완료 후 출력되는 URL을 메모한다.

```
https://linear-noti-relay.<account>.workers.dev
```

### 4-3. 엔드포인트

| 경로 | 용도 |
|---|---|
| `POST /webhook` | Linear가 이벤트를 POST하는 엔드포인트 |
| `GET /connect?token=...&since=...` | 데스크탑 앱이 WebSocket으로 업그레이드하는 엔드포인트. `since`는 재연결 시 놓친 이벤트 replay 기준 타임스탬프 |

### 4-4. 테스트

**단위 테스트** (서명 검증, 이벤트 버퍼 등):

```bash
npm test
```

**통합 테스트** (실제 Worker + WS 흐름): 기본 `npm test`에서는 자동으로 **건너뛴다**(라이브 서버 필요). 명시적으로 돌리려면 별도 터미널에서 로컬 dev 서버를 먼저 실행한다.

```bash
npx wrangler dev --local --port 8787 \
  --var LINEAR_WEBHOOK_SECRET:test-secret \
  --var APP_AUTH_TOKEN:test-token
```

그 다음 통합 테스트를 실행한다(`RELAY_LIVE` 플래그로 게이팅됨).

```bash
npm run test:integration
```

> 통합 테스트(`test/integration.test.ts`)는 전역 `WebSocket`을 사용하므로 **Node 22 이상**이 필요하다.

---

## 5. Linear Webhook 등록

1. Linear → **Settings** → **API** → **Webhooks** → **New webhook** 클릭
2. **URL**: `https://linear-noti-relay.<account>.workers.dev/webhook` (4-2에서 배포해 얻은 주소 + `/webhook`)
3. 구독할 이벤트 선택: Issues, Comments, Projects 등 원하는 항목 체크
4. 저장하면 Linear가 **Signing secret**을 생성해 보여준다 → **이 값을 복사**한다.

## 6. 서명 시크릿 등록 (LINEAR_WEBHOOK_SECRET)

5단계에서 복사한 Linear의 Signing secret을 Cloudflare에 등록한다(재배포 불필요, 즉시 반영).

```bash
cd LinearServer
npx wrangler secret put LINEAR_WEBHOOK_SECRET   # 붙여넣기: Linear가 보여준 Signing secret
```

---

## 7. 데스크탑 앱 (LinearApp)

### 6-1. 설치 및 실행

```bash
cd LinearApp
npm install
npm start        # TypeScript 컴파일 → 렌더러 에셋 복사 → Electron 실행
```

### 6-2. 최초 설정

첫 실행 시 설정 창이 열린다. 아래 항목을 입력한다.

| 항목 | 설명 |
|---|---|
| Relay URL | `wss://linear-noti-relay.<account>.workers.dev` (반드시 `wss://`, `https://` 아님) |
| Auth Token | `APP_AUTH_TOKEN`에 등록한 값 |
| 내 Linear User ID | `me.id` — assignee 필터 및 멘션 판별에 사용 |
| 내 멘션 핸들(이름) | `me.name` — `@핸들` 형태로 본문에서 멘션 여부를 탐지 |
| 규칙 JSON | 아래 섹션 참고 |

**"테스트 알림"** 버튼을 눌러 화면 중앙에 알림이 뜨는지 확인한다.

---

## 8. 규칙(Rule) 작성법

규칙은 설정 창의 규칙 JSON 필드에 **배열 형태**로 입력한다.

### Rule 스키마

```ts
interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  eventTypes: string[];       // 예: ["Issue","Comment"] — 비어있으면 모든 타입
  actions: string[];          // 예: ["create","update"] — 비어있으면 모든 액션
  filters: FilterCondition[]; // 모두 만족해야 매칭 (AND)
}

interface FilterCondition {
  kind: "team" | "project" | "label" | "assignee" | "mentionsMe" | "keyword";
  value?: string; // assignee, mentionsMe는 value 불필요
}
```

### FilterCondition kind 설명

| kind | 매칭 기준 | value |
|---|---|---|
| `team` | 이벤트의 팀 key 또는 name (대소문자 무시) | 팀 key 또는 이름 |
| `project` | 이벤트의 프로젝트 name (대소문자 무시) | 프로젝트 이름 |
| `label` | 이슈에 해당 라벨이 붙어있는지 (대소문자 무시) | 라벨 이름 |
| `assignee` | 나(`me.id`)에게 할당된 이벤트인지 | 불필요 |
| `mentionsMe` | 본문/제목에 `@me.name` 또는 `me.id`가 포함되는지 | 불필요 |
| `keyword` | 제목·설명·본문에 해당 키워드가 포함되는지 (대소문자 무시) | 키워드 |

### 예시

**예시 1 — 코멘트에서 나를 멘션하면 알림**

```json
[
  {
    "id": "r1",
    "name": "mentions",
    "enabled": true,
    "eventTypes": ["Comment"],
    "actions": [],
    "filters": [{ "kind": "mentionsMe" }]
  }
]
```

**예시 2 — ENG 팀의 urgent 라벨 이슈 생성·수정 시 알림**

```json
[
  {
    "id": "r2",
    "name": "urgent",
    "enabled": true,
    "eventTypes": ["Issue"],
    "actions": ["create", "update"],
    "filters": [
      { "kind": "label", "value": "urgent" },
      { "kind": "team", "value": "ENG" }
    ]
  }
]
```

**복합 예시 — 두 규칙 동시 사용**

```json
[
  {
    "id": "r1",
    "name": "mentions",
    "enabled": true,
    "eventTypes": ["Comment"],
    "actions": [],
    "filters": [{ "kind": "mentionsMe" }]
  },
  {
    "id": "r2",
    "name": "urgent",
    "enabled": true,
    "eventTypes": ["Issue"],
    "actions": ["create", "update"],
    "filters": [
      { "kind": "label", "value": "urgent" },
      { "kind": "team", "value": "ENG" }
    ]
  }
]
```

---

## 9. 패키징 (배포용 인스톨러 빌드)

```bash
cd LinearApp
npm run dist
```

electron-builder가 실행되며 플랫폼별 인스톨러를 생성한다.

| 플랫폼 | 결과물 |
|---|---|
| macOS | `.dmg` |
| Windows | `.exe` (NSIS 인스톨러) |

> 크로스 플랫폼 빌드는 각 OS에서 직접 실행하거나 CI 환경을 구성해야 한다 (예: macOS 빌드는 macOS 러너, Windows 빌드는 Windows 러너).

---

## 10. 참고 및 제약

- **단일 사용자 MVP**: 멀티유저·멀티워크스페이스는 지원하지 않는다.
- **오프라인 중 이벤트 유실**: 앱이 완전히 꺼져 있을 때 발생한 이벤트는 복구되지 않는다. Durable Object의 버퍼는 **약 60초** 이내의 짧은 끊김만 커버한다.
- **알림 클릭 = 닫기**: 클릭해도 Linear가 열리지 않는다. 클릭은 "확인했음" 의미만 갖는다.
- **Linear API 토큰 불필요**: webhook payload만으로 알림 내용을 표시하며, 추가 API 조회는 하지 않는다.
- **규칙의 `assignee` filter**: `value` 필드를 무시하고 항상 설정된 `me.id`와 비교한다. 다른 사람의 assignee를 필터하려면 `keyword` 또는 다른 조건을 활용한다.
