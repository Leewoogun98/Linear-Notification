# 팀 다중 사용자 + Linear OAuth + 서버측 라우팅 — 설계 문서

작성일: 2026-06-24
기반: `2026-06-24-linear-noti-design.md` (단일 사용자 버전, 이미 구현·배포됨)

## 1. 목적 / 배경

단일 사용자용으로 만든 Linear 중앙 알림 앱을 **팀원 여러 명이 함께 쓰도록** 확장한다.
핵심 제약은 **프라이버시**: 각 팀원의 앱은 **자신과 관련된 이벤트만** 수신해야 하며,
관련 없는 이벤트는 그 사람 컴퓨터로 **전송 자체가 되지 않아야** 한다(단순 클라이언트
필터링이 아니라 서버측 라우팅).

신원은 **Linear OAuth 로그인**으로 검증한다. 임의로 발급/공유하던 `APP_AUTH_TOKEN`은
폐기하고, Linear가 보증하는 사용자 신원에 기반한 세션으로 대체한다.

전제: 모든 팀원은 **동일한 Linear 워크스페이스**에 속한다(단일 워크스페이스, 단일 webhook).

## 2. 현재(단일 사용자) → 목표(팀) 델타

| 영역 | 현재 | 변경 후 |
|---|---|---|
| 인증 | 공유 `APP_AUTH_TOKEN` 1개 | **Linear OAuth → 사용자별 세션 토큰** |
| 신원 | 앱 설정에 user id/이름 수동 입력 | **로그인 세션에서 자동 확정** (수동 입력 제거) |
| 라우팅 | 모든 연결에 broadcast | **관련된 사용자에게만 전송** (서버 판단) |
| 릴레이 연결 | 익명 WS | **userId로 태깅된 WS** |
| 규칙 역할 | 어떤 이벤트를 알림할지 결정 | **"내 알림 중" 무엇을 띄울지** 좁히는 개인 취향 필터 |
| 버퍼/replay | 단일 큐 | **수신 대상별** replay |

그대로 유지: Electron 앱 골격, 중앙 알림 UI(5초 자동/클릭 닫힘/소리/스택), 규칙 엔진
모듈(개인 필터로 재활용), webhook 서명 검증(`LINEAR_WEBHOOK_SECRET`), Cloudflare
Workers + Durable Object + WebSocket 골격.

## 3. 인증 흐름 — Linear OAuth (릴레이 중개 + 페어링 코드)

데스크탑 앱은 OAuth 리다이렉트 수신이 까다로우므로, **공개 릴레이가 콜백을 호스팅**하고
앱은 **페어링 코드로 결과를 회수**한다(로컬 서버/커스텀 프로토콜 불필요).

```
1. 앱: 임의 pairing_code 생성 → 시스템 브라우저로 열기
       https://<relay>/auth/start?cb=<pairing_code>
2. 릴레이: Linear authorize로 리다이렉트 (state에 pairing_code 인코딩)
3. 사용자: Linear 승인 화면에서 Allow
4. Linear → 릴레이 /auth/callback?code=...&state=<pairing_code>
5. 릴레이: code를 Linear access token으로 교환 (client_secret 사용)
          → Linear GraphQL `viewer` 조회 → { id, name } 확정
          → session_token 생성, 저장: session_token → { userId, name }
          → 저장: pairing_code → session_token (짧은 TTL, 1회용)
          → access token은 폐기 (라우팅에 불필요)
6. 브라우저: "로그인 완료, 앱으로 돌아가세요" 표시
7. 앱: https://<relay>/auth/poll?cb=<pairing_code> 폴링
       → session_token 수신 → 로컬(config)에 저장
8. 앱: WS 연결 시 ?token=<session_token>
       → 릴레이가 세션 조회 → 연결을 userId로 태깅
```

- **폐기**: `APP_AUTH_TOKEN`(및 앱의 수동 토큰/userId 입력 필드).
- **신규 사전작업(admin = 사용자)**: Linear에 **OAuth 애플리케이션 등록** →
  `client_id`/`client_secret`/redirect URI(`https://<relay>/auth/callback`) 확보.
  `client_id`, `client_secret`은 릴레이 시크릿으로 보관.
- **보안**: Linear access token은 저장하지 않는다(viewer 확인 직후 폐기). 릴레이가
  지속 저장하는 것은 `session_token → {userId, name}`뿐.

## 4. 라우팅 — "내 알림만" 서버측 판정

릴레이(Durable Object)는 연결을 **userId별로** 보관한다.

webhook 이벤트 1건마다:
1. **관련 사용자 id 집합(recipients)** 계산:
   - `data.assignee.id` (담당자)
   - `data.subscriberIds[]` (구독자 — Linear는 멘션/담당/생성/코멘트 시 자동 구독)
   - 코멘트의 경우: 본문에 멘션된 사용자 id + 부모 이슈의 구독자
2. recipients에 속한 **userId로 태깅된 연결에만** 메시지 전송.
3. recipients가 비면 아무에게도 전송하지 않음.

> 구현 시 확정할 항목: Linear webhook payload의 정확한 필드(`subscriberIds`, 멘션
> 표현 형식)는 **실제 이벤트 1건을 받아 확인**한 뒤 추출 로직을 확정한다. 1차 신호는
> `subscriberIds` + `assignee.id`이며, 멘션은 본문에서 user id를 보조 추출한다.
> (단일 사용자 버전에서도 멘션 형식은 실측으로 확정하기로 했던 것과 동일한 접근.)

## 5. 상태 / 저장소

단일 워크스페이스이므로 고정 단일 Durable Object 인스턴스(`"main"`)가 다음을 보유:
- **연결 레지스트리**: WebSocket ↔ userId (메모리; hibernation 시 attachment로 보존)
- **세션 저장소**: `session_token → {userId, name}` (DO storage, 영속)
- **페어링 코드**: `pairing_code → session_token` (DO storage, 짧은 TTL, 1회 소비)
- **버퍼**: 최근 60초 메시지 + 각 메시지의 recipients (사람별 replay용)

세션 만료 정책: 세션 토큰은 장기 유효(데스크탑 앱 상시 사용). 무효화가 필요하면
사용자가 재로그인 또는 admin이 세션 삭제(후속 과제, MVP는 단순 영속).

## 6. 앱 변경

- **설정창 개편**: relayUrl(고정값 내장 또는 유지) + **"Linear로 로그인" 버튼** +
  로그인 상태/내 이름 표시. **userId·토큰 수동 입력 필드 제거.**
- **신원**: 로그인 세션에서 확정. WS 연결 시 릴레이가 "당신은 <name>"을 통지(선택),
  앱은 이를 표시.
- **규칙 재활용**: 규칙 엔진(`rule-engine.ts`)은 그대로 두되 역할이 **개인 취향 필터**로
  바뀐다 — 서버가 이미 "내 것만" 보내므로, 규칙은 *"내 알림 중 무엇을 중앙에 띄울지"*
  (예: 멘션만, 특정 팀 음소거)를 정한다. **규칙이 비면 받은 것 전부 알림**(기본값).
- **인증 흐름**: 로그인 버튼 → 브라우저 열기 → 폴링 → 세션 저장 → WS (재)연결.

## 7. 에러 처리

- **OAuth 실패/취소**: 콜백에 error → 브라우저에 안내, 앱 폴링은 타임아웃 후 "로그인
  실패" 표시. 세션 미발급.
- **세션 만료/무효**: WS 연결 시 릴레이가 401 → 앱이 "다시 로그인" 표시.
- **WS 끊김**: 기존과 동일(지수 백오프 재연결). 재연결 시 `since`로 사람별 버퍼 replay.
- **webhook 서명 검증 실패**: 기존과 동일(401, 무시).
- **recipients 계산 실패/필드 누락**: 안전하게 빈 집합(=아무에게도 안 보냄)으로 처리하고
  로깅. 과다 전송보다 미전송이 프라이버시상 안전.

## 8. 테스트 전략

- **순수 단위**: recipients 계산 함수(이벤트 → user id 집합) — payload 샘플로 TDD.
  세션/페어링 코드 저장 로직(순수 부분). 개인 필터(규칙 엔진, 기존 테스트 유지).
- **OAuth 흐름**: 토큰 교환·viewer 조회는 통합 테스트(모킹 또는 실제). 콜백/폴링
  엔드포인트는 wrangler dev 대상 통합 테스트.
- **라우팅 통합**: 서로 다른 userId로 두 WS 연결 → 한 사람만 관련된 이벤트 전송 →
  관련된 연결만 수신하는지 검증(wrangler dev).

## 9. 범위에서 제외 (YAGNI)

- 멀티 워크스페이스(여전히 단일 워크스페이스 전제)
- 세션 만료/회전·admin 세션 관리 UI(후속)
- 팀원별 권한/역할 구분
- 푸시 알림(앱이 꺼져 있을 때) — 여전히 상시 실행 전제, 60초 버퍼만
- Linear access token 영속 저장(viewer 확인 후 폐기)

## 10. 마이그레이션 메모

- 기존 단일 사용자 코드를 **이어서 개조**(별도 버전 분리 없음).
- 배포된 릴레이에 OAuth 엔드포인트/세션 저장 추가 후 재배포. `APP_AUTH_TOKEN` 시크릿
  제거, `LINEAR_CLIENT_ID`/`LINEAR_CLIENT_SECRET` 추가.
- 앱은 패키징(`npm run dist`)하여 팀원에게 배포.
