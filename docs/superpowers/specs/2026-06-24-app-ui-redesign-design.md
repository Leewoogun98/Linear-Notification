# 앱 UI 재디자인 — 3화면(로그인·홈·설정) + 알림 인박스 설계 문서

작성일: 2026-06-24
기반: 팀 다중사용자 버전(`2026-06-24-team-multiuser-design.md`, 구현 완료). 릴레이는 변경 없음 — **데스크탑 앱(`LinearApp`)만** 개편.

## 1. 목적

기능만 동작하던 단일 설정창을, **세 개의 독립 화면(로그인·홈·설정)** 을 가진 제대로 된 앱으로 재디자인한다. 핵심 신규 기능은 **홈 = 받은 알림 인박스**(받은 알림을 저장·열람). 테마는 **어둡지만 가시성 높고, 둥글둥글 귀여운** 느낌.

## 2. 화면 구성 / 네비게이션

한 개의 메인 창 안에서 상태에 따라 뷰를 전환한다(별도 창 아님).

- **로그인 안 됨** → 로그인 화면
- **로그인됨** → 홈(기본)
- 홈 우상단 **톱니** → 설정
- 설정 좌상단 **뒤로(←)** → 홈
- 하단 탭바 없음

중앙 팝업 알림창은 기존처럼 **별도의 작은 창**으로 유지(재스타일).

### 2-1. 로그인 화면
- 둥근 사각(squircle) 앱 아이콘(벨) + 앱 이름 "Linear Noti"
- **"Linear로 로그인"** 버튼(라벤더, pill)
- 하단 안내문: "로그인하면 브라우저에서 Linear 인증이 열려요" (유지)
- (설명 부제는 두지 않음)

### 2-2. 홈 화면 (알림 인박스)
- 상단: "알림" 제목 + **안읽음 N개** 코랄 pill + 우상단 톱니
- 알림 리스트(시간 역순): 각 항목 = 타입 색 아이콘 태그 + 제목 + 본문(요약) + 식별자·상대시간 + 안읽음 코랄 점
- 항목 **클릭** → 해당 Linear 이슈를 브라우저에서 열기(`shell.openExternal`) + 읽음 처리
- 하단: **"모두 지우기"**
- 빈 상태: 친절한 빈 메시지(예: "아직 받은 알림이 없어요")

### 2-3. 설정 화면
- 상단: 뒤로(←) + "설정"
- 계정 카드: 아바타(이니셜) + 이름/핸들 + **로그아웃**
- "받을 알림 종류" **체크박스 4종**(기본 전부 ON):
  - `나를 멘션` · `코멘트` · `담당 이슈 변경` · `프로젝트 업데이트`
- 체크 변경 시 즉시 저장

## 3. 비주얼 디자인 시스템

- 배경: `#20222e`(짙은 슬레이트, 순흑 아님 — 가시성), 창 타이틀바 `#191b24`
- 카드/표면: `#2a2d3d`, 강조 표면 `#30334a`
- 포인트(primary): 라벤더 `#8b7bf0`
- 안읽음/알림 강조: 코랄 `#ff9eb5`
- 텍스트: 기본 `#eceefb`, 보조 `#9a9db5`, 흐림 `#6f7288`
- 타입별 아이콘 색: 멘션=라벤더 / 코멘트=블루 / 담당=앰버 / 프로젝트=틸 계열
- 모서리: 카드 16–18px, 창 24px, 버튼 pill(999px), 체크박스 8px
- 폰트: 시스템 sans, 11px 이상. 아이콘: Tabler outline 류(벨/at/메시지/체크박스/톱니/화살표)
- 다크 단일 테마(라이트 모드 미지원 — YAGNI)

## 4. 알림 저장소 (신규)

- 데이터: `StoredNotification { id, category, title, body, issueUrl?, identifier?, receivedAt, read }`
- 저장 위치: 앱 userData의 별도 JSON 파일(`notifications.json`) — 설정과 분리
- 정책: 최신순, **최근 100개만 보관**(초과 시 오래된 것 제거), 읽음/안읽음 상태 보존
- 동작: `add`, `list`, `markRead(id)`, `clearAll`, `unreadCount()`
- 메인 프로세스가 소유, 렌더러는 IPC로 조회/변경. 변경 시 렌더러에 push로 갱신.

## 5. 데이터 흐름

알림 이벤트 1건 수신 시(릴레이는 이미 "내 것만" 전송):
1. `categorize(event, me)` → 이 이벤트의 카테고리 집합 계산
2. 설정의 **enabledCategories와 교집합이 있으면** 알림 진행, 없으면 무시
3. 알림이면: ① 중앙 팝업 표시(기존) + ② 저장소 `add` + ③ 홈 리스트/안읽음 뱃지 갱신 + ④ 트레이 뱃지 갱신
4. 홈에서 항목 클릭 → 이슈 열기 + `markRead`

## 6. 카테고리 분류 (규칙 엔진 대체)

기존 `rule-engine.ts`(JSON 규칙/필터)를 **카테고리 분류 + 설정 체크박스**로 대체한다.

- `categorize(event, me): Category[]`, `Category = "mention" | "comment" | "assigned" | "projectUpdate"`
  - `mention`: 본문(title/description/body)에 내 멘션(`@<me.name>` 또는 내 id) 포함
  - `comment`: `event.type === "Comment"`
  - `assigned`: `event.type === "Issue"` && `data.assignee?.id === me.id`
  - `projectUpdate`: `event.type === "ProjectUpdate"` (또는 `Project`)
- 표시 결정: `categorize(event,me) ∩ settings.enabledCategories ≠ ∅`
- 알림 텍스트 생성기 `formatNotification(event): { title, body, issueUrl?, identifier? }` (기존 buildText 로직 재활용)
- 한 이벤트가 여러 카테고리에 해당하면(예: 나를 멘션한 코멘트) 그중 하나라도 켜져 있으면 표시. 대표 카테고리(아이콘 색)는 우선순위 `mention > assigned > comment > projectUpdate`.

## 7. 트레이 / 로그아웃

- 트레이: 안읽음 개수 뱃지(macOS `app.setBadgeCount` 또는 트레이 타이틀/아이콘). 메뉴(설정 열기/종료) 유지.
- 로그아웃: 세션 토큰 비우고, 클라이언트 정지, 메인 창을 로그인 뷰로 전환.

## 8. 컴포넌트 / 파일 구조 (앱)

- `src/main/notification-store.ts` — 알림 저장소(순수 로직 + 파일 I/O 주입)
- `src/main/categorize.ts` — 순수 분류 + 표시 텍스트(`categorize`, `formatNotification`)
- `src/main/main.ts` — 배선 갱신(저장소·분류·뱃지·IPC·로그아웃)
- `src/preload/app-preload.ts` — 단일 메인 창용 브리지(auth/notifications/settings)
- `src/renderer/app/index.html` + `app.ts` + `app.css` — 3뷰 라우팅 메인 창
- `src/main/notification-manager.ts` + `src/renderer/notification/*` — 중앙 팝업(다크 테마로 재스타일)
- `src/shared/types.ts` — `Settings`에 `enabledCategories: Category[]` 추가, `rules`/`FilterCondition` 제거; `StoredNotification`/`Category` 추가
- 제거: `rule-engine.ts`(및 단위 테스트) — 카테고리 모델로 대체

## 9. 에러 처리

- 알림 저장소 파일 손상 → 빈 목록으로 시작(설정 저장소와 동일 패턴)
- 이슈 URL 없음(payload에 url 부재) → 클릭 시 열기 동작만 생략, 읽음 처리는 수행
- 로그인 실패/세션 만료(401) → 로그인 뷰로 전환(기존 onUnauthorized 재사용)
- 분류 중 필드 누락 → 안전하게 빈 카테고리(표시 안 함)

## 10. 테스트 전략

- `categorize`/`formatNotification`: 순수 → 다양한 이벤트로 단위 테스트(TDD)
- `notification-store`: add/cap100/markRead/clearAll/unreadCount → 임시 파일로 단위 테스트(TDD)
- 렌더러 3뷰/중앙 팝업/트레이 뱃지: 빌드 + 수동 e2e(헤드리스 불가)

## 11. 범위에서 제외 (YAGNI)

- 라이트 모드
- 알림 검색/필터/그룹화(인박스는 단순 시간순)
- 알림별 세부 액션(스누즈 등)
- 멀티 워크스페이스(기존과 동일)
- 푸시(앱 꺼져 있을 때) — 여전히 상시 실행 전제

## 12. 마이그레이션 메모

- 릴레이 변경 없음. 앱만 개편.
- `Settings`에서 `rules` 제거 → `enabledCategories` 추가. config-store의 기본값 병합으로 구버전 settings.json은 안전하게 기본값(전부 ON)으로 이행.
- 기존 단일 설정창(`renderer/settings`, `settings-preload`)은 새 메인 창(`renderer/app`, `app-preload`)으로 대체.
