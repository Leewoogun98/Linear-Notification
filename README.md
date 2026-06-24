# LinearNoti

Linear 이벤트를 화면 **정중앙(또는 원하는 모서리)** 에 크게 띄워주는 커스텀 알림 데스크탑 앱.
나와 관련된 알림만 실시간으로 받고, 5초 자동 사라짐 / 클릭 닫힘 / 소리 / 인박스 보관을 지원한다.
Electron 기반으로 macOS·Windows 모두 배포 가능하며, **하나의 Linear 워크스페이스**를 함께 쓰는 팀을 위한 도구다.

---

## 1. 개요

Linear 기본 알림은 우상단에 작게 떠서 놓치기 쉽다. 이 앱은:

- **실시간 webhook 알림** — 폴링 없이 Linear webhook → Cloudflare relay → WebSocket → 앱으로 즉시 전달.
- **화면 정중앙 팝업 + 인박스** — 큰 팝업으로 즉시 알리고, 홈 화면 인박스에 최근 알림을 보관한다.
- **사용자별(per-user)** — 각자 자기 Linear 계정으로 OAuth 로그인하고, 서버가 **자기와 관련된 이벤트만** 골라 보낸다.
- **단일 워크스페이스** — 같은 Linear 워크스페이스 멤버라면 누구나 로그인해 쓸 수 있다.

프로젝트는 두 부분으로 구성된다.

| 디렉터리 | 역할 |
|---|---|
| `LinearServer/` | Cloudflare Workers + Durable Object relay (TypeScript) |
| `LinearApp/` | Electron 데스크탑 앱 (TypeScript, 바닐라 렌더러) |

---

## 2. 구조 / 데이터 흐름

```
Linear 워크스페이스
    │
    │  서명된 webhook POST (Linear-Signature)
    ▼
Worker  POST /webhook
    │  HMAC-SHA256 서명 검증 → Durable Object로 전달
    ▼
Relay Durable Object
    │  · 연결된 사용자별 "수신자(recipients)" 계산 → 관련된 사람에게만 전달
    │  · 짧은 끊김 대비 ~60초 재연결 버퍼
    │
    │  WebSocket push (GET /connect?token=...&since=...)
    ▼
Electron 앱 (WS 클라이언트, 자동 재연결)
    │  · categorize: 멘션 / 프로젝트 업데이트로 분류
    │  · 설정(알림 종류 체크박스, 내 변경 음소거)으로 필터
    ▼
화면 팝업(정중앙/모서리) + 인박스 저장 + 트레이 뱃지
```

> **설계 포인트**
> - **라우팅은 서버(Durable Object)에서** 수행한다. 워크스페이스의 모든 이벤트가 앱으로 쏟아지지 않고, 각 사용자는 자기와 관련된 이벤트만 받는다.
> - **분류·필터는 앱에서** 수행한다. "어떤 종류를 볼지", "내가 한 변경은 숨길지"는 앱 설정으로 결정된다.

---

## 3. 기술 스택

**Relay (`LinearServer/`)**
- Cloudflare Workers (`src/worker.ts`)
- Durable Object (`RelayDurableObject` — 세션·연결·이벤트 버퍼 관리)
- TypeScript, Wrangler
- Vitest (단위 + 통합 테스트)

**App (`LinearApp/`)**
- Electron 31, TypeScript
- 바닐라 렌더러(HTML/CSS/TS, 프레임워크 없음)
- `ws` (WebSocket 클라이언트)
- electron-builder (dmg / nsis 패키징)
- `sharp` (아이콘 생성), Vitest

---

## 4. 알림 수신 방식 (webhook)

### 동작

1. Linear가 워크스페이스 이벤트를 `POST /webhook`로 보낸다.
2. Worker가 `Linear-Signature` 헤더를 **HMAC-SHA256**으로 검증한다. 실패하면 401, 통과하면 Durable Object로 전달한다.
3. Durable Object가 현재 연결된 앱들에게 **WebSocket으로 브로드캐스트**한다 — 단, 그 이벤트와 관련된 사용자에게만.

### 라우팅 — 누가 받나 (`src/recipients.ts`)

연결된 사용자는 다음 중 하나에 해당할 때 이벤트를 받는다.

- 이슈 **담당자(assignee)**
- **구독자(subscriberIds)** — 본인 또는 부모 이슈의 구독자
- 프로젝트 **멤버/리드/생성자(memberIds / leadId / creatorId)**
- 본문에 **@displayName으로 멘션**된 경우 (title / description / body에 `@내표시이름` 포함)

> 코멘트(Comment) payload에는 구독자 정보가 없다. 따라서 **코멘트는 나를 @멘션했을 때만** 도착한다.

### 60초 재연결 버퍼

앱이 잠깐 끊겼다 다시 붙으면, `/connect?...&since=<타임스탬프>`로 마지막 수신 시점을 전달한다. Durable Object는 약 **60초** 동안의 최근 이벤트를 보관했다가 놓친 것을 다시 보낸다. (앱이 완전히 꺼져 있던 동안의 이벤트는 복구되지 않는다.)

---

## 5. 인증 (Linear OAuth)

각 팀원은 **자기 Linear 계정으로** 로그인한다. (반드시 같은 워크스페이스의 멤버여야 한다.)

```
앱: "Linear로 로그인" 클릭
  → 브라우저로 /auth/start 열기
  → Linear 동의 화면
  → /auth/callback (Worker가 code→access token 교환, viewer 조회[displayName 포함], 세션 토큰 발급)
앱: /auth/poll 폴링으로 세션 토큰 회수
  → 그 토큰으로 WebSocket 연결 (/connect?token=...)
```

- 세션 토큰은 로컬에 저장되며, 다음 실행 시 **자동 로그인**된다.
- `displayName`은 멘션 라우팅(`@displayName` 매칭)에 사용된다.
- 로그아웃하면 토큰과 내 정보가 지워지고 WS 연결이 끊긴다.

---

## 6. 앱 화면 / 기능

### 화면 3종

1. **로그인** — "Linear로 로그인" 버튼. 로그인 전에는 이 화면만 보인다.
2. **홈 (알림 인박스)** — 최근 **100개** 알림 목록. 읽음/안읽음 표시, 항목 클릭 시 해당 이슈 열기.
3. **설정**
   - **알림 종류** 체크박스: `나를 멘션`, `프로젝트 업데이트`
   - **"내가 한 변경은 알림 받지 않기"** 토글 (기본 켜짐) — 이벤트 actor가 나일 때 알림을 숨긴다.
   - **알림 위치** 선택: 정중앙 / 네 모서리 (시각적 picker)

### 중앙 팝업

- 5초 후 **자동 사라짐**, 클릭하면 즉시 닫힘, 표시될 때 **소리** 재생.
- 카테고리별 **제목·강조색·pop 애니메이션**.
- 동시 도착 시 선택한 위치 기준으로 **스택**되어 정렬된다.

### 알림 클릭 → 이슈 열기

- 알림(인박스 항목)을 클릭하면 **Linear 데스크탑 앱**(`linear://` 딥링크)으로 열고, 앱이 없으면 **브라우저**로 폴백한다.

### 기타

- **트레이 상주** — 창을 닫아도 백그라운드에서 계속 동작하며, 트레이 아이콘으로 다시 연다.
- **안읽음 뱃지** — Dock(macOS)·트레이 툴팁에 안읽음 개수 표시.
- **다크 테마**, 커스텀 아이콘.

---

## 7. 설정 / 배포 (개발자)

순서가 중요하다. **Linear가 webhook을 만들 때 발급하는 Signing secret**이 필요하므로, relay를 먼저 배포한 뒤 webhook을 등록하고 그 secret을 마지막에 넣는다.

### (a) Linear OAuth 앱 등록

Linear → **Settings → API → OAuth applications → 새 앱** 생성.

- **Redirect URI**: `https://<relay>/auth/callback`
- 발급된 **client id / client secret** 메모.

### (b) relay 배포

```bash
cd LinearServer
npm install
npx wrangler login
npx wrangler secret put LINEAR_CLIENT_ID       # (a)의 client id
npx wrangler secret put LINEAR_CLIENT_SECRET   # (a)의 client secret
npx wrangler deploy                            # → https://<...>.workers.dev URL 출력
```

### (c) Linear webhook 등록 + 서명 시크릿

Linear → **Settings → API → Webhooks → 새 webhook**.

- **URL**: `https://<relay>/webhook`
- **구독**: Issues / Comments / Projects 등 원하는 이벤트
- 저장하면 Linear가 **Signing secret**을 보여준다 → **복사**.

```bash
cd LinearServer
npx wrangler secret put LINEAR_WEBHOOK_SECRET   # 붙여넣기: Linear가 보여준 Signing secret
```

> 시크릿은 재배포 없이 즉시 반영된다.

### (d) 앱 실행

```bash
cd LinearApp
npm install
npm start
```

- `relayUrl`은 `src/shared/types.ts`의 `DEFAULT_SETTINGS`에 내장되어 있다.
- 현재 배포된 relay: `wss://linear-noti-relay.bome00519.workers.dev`

### 테스트

```bash
# relay 단위 테스트 (서명 검증, 라우팅, 버퍼 등)
cd LinearServer && npm test

# relay 통합 테스트 (실제 WS 흐름) — 별도 터미널에서 wrangler dev 실행 후
npx wrangler dev          # 한 터미널
RELAY_LIVE=1 npm run test:integration   # 다른 터미널

# 앱 테스트
cd LinearApp && npm test
```

---

## 8. 팀 배포 (패키징)

```bash
cd LinearApp
npm run dist
```

`release/`에 인스톨러가 생성된다.

| 플랫폼 | 결과물 | 빌드 위치 |
|---|---|---|
| macOS | `.dmg` | macOS에서 빌드 |
| Windows | `.exe` (NSIS) | Windows에서 빌드 |

> 미서명 빌드라 첫 실행 시 macOS **Gatekeeper** / Windows **SmartScreen** 경고가 뜬다 → 우클릭으로 열기(또는 "추가 정보 → 실행")로 통과한다.
>
> 팀원은 설치 후 **"Linear로 로그인"** 만 누르면 된다. 별도 설정이 필요 없다.

---

## 9. 제약 / 참고

- **단일 워크스페이스**: 하나의 Linear 워크스페이스만 지원한다.
- **오프라인 중 이벤트 유실**: 앱이 완전히 꺼져 있는 동안 발생한 이벤트는 받지 못한다. 재연결 버퍼는 약 **60초**의 짧은 끊김만 커버하며, 별도 푸시(APNs 등)는 없다.
- **세션 만료/회전 없음**: 세션 토큰은 만료되거나 자동 회전되지 않는다.
- **코멘트는 멘션돼야 옴**: 코멘트 payload에 구독자 정보가 없어, 코멘트는 나를 @멘션한 경우에만 도착한다.
