# 앱 UI 재디자인 (3화면 + 알림 인박스) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron 앱을 로그인·홈(알림 인박스)·설정 3화면 구조로 재디자인하고, 받은 알림을 저장·열람하는 인박스와 카테고리 체크박스 설정을 추가한다. 다크·둥근 테마.

**Architecture:** 릴레이는 변경 없음. 앱만 개편. 규칙(JSON) 모델을 카테고리 분류(`categorize`)로 대체하고, 받은 알림을 파일에 저장하는 `NotificationStore`를 추가한다. 단일 메인 창(`renderer/app`)이 인증 상태에 따라 3개 뷰를 전환한다. 알림 수신 시 중앙 팝업(기존) + 저장소 추가 + 홈/트레이 뱃지 갱신.

**Tech Stack:** Electron + TypeScript (vanilla 렌더러), node:crypto, vitest.

설계 문서: `docs/superpowers/specs/2026-06-24-app-ui-redesign-design.md`

---

## File Structure (LinearApp)

- `src/shared/types.ts` — 수정: `Category`/`ALL_CATEGORIES`/`StoredNotification` 추가, `Settings.rules`→`enabledCategories`, `Rule`/`FilterCondition` 제거
- `src/main/categorize.ts` — 신규: `categorize`/`representativeCategory`/`formatNotification`/`shouldNotify` (순수)
- `src/main/notification-store.ts` — 신규: 파일 기반 알림 저장소 (cap 100, 읽음/안읽음)
- `src/main/rule-engine.ts` — **삭제** (categorize로 대체), `test/rule-engine.test.ts` 삭제
- `src/preload/app-preload.ts` — 신규: 메인 창 IPC 브리지
- `src/renderer/app/index.html` + `app.css` + `app.ts` — 신규: 3뷰 메인 창
- `src/main/notification-manager.ts` — 수정: 다크 테마 + 카테고리 accent
- `src/renderer/notification/notification.css` — 수정: 다크 팔레트 + accent
- `src/preload/notification-preload.ts` — 수정: accent 전달(content에 포함)
- `src/main/main.ts` — 수정: 저장소·분류·뱃지·IPC·메인창·로그아웃 배선
- 삭제: `src/preload/settings-preload.ts`, `src/renderer/settings/*`
- `test/categorize.test.ts`, `test/notification-store.test.ts` — 신규

---

## Task 1: 타입 갱신 (Category / StoredNotification / Settings)

**Files:** Modify `LinearApp/src/shared/types.ts`

- [ ] **Step 1: types.ts 전체 교체**
```ts
export type Category = "mention" | "comment" | "assigned" | "projectUpdate";
export const ALL_CATEGORIES: Category[] = ["mention", "comment", "assigned", "projectUpdate"];

export interface Identity {
  id: string;
  name: string;
}

export interface Settings {
  relayUrl: string;
  sessionToken: string;
  me: Identity;
  enabledCategories: Category[];
}

export const DEFAULT_SETTINGS: Settings = {
  relayUrl: "wss://linear-noti-relay.bome00519.workers.dev",
  sessionToken: "",
  me: { id: "", name: "" },
  enabledCategories: ["mention", "comment", "assigned", "projectUpdate"],
};

export interface StoredNotification {
  id: string;
  category: Category;
  title: string;
  body: string;
  issueUrl?: string;
  identifier?: string;
  receivedAt: number;
  read: boolean;
}
```

- [ ] **Step 2: 변경 파일 타입 체크**
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npx tsc --noEmit 2>&1 | grep -E "shared/types\.ts" || echo "types clean"`
Expected: `types clean`. (rule-engine.ts/main.ts/settings 렌더러가 옛 `rules`/`Rule`을 참조해 전체 tsc는 빨강 — 정상. 후속 태스크에서 제거/교체.)

- [ ] **Step 3: Commit**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti
git add LinearApp/src/shared/types.ts
git commit -m "feat(app): category model types (replace rules with enabledCategories)"
```

## Context
규칙(JSON) 모델을 카테고리 체크박스로 대체한다. `enabledCategories`에 체크된 종류만 알림. `StoredNotification`은 홈 인박스에 저장되는 알림 항목. `Rule`/`FilterCondition`은 제거.

---

## Task 2: categorize (순수, TDD)

**Files:** Create `LinearApp/src/main/categorize.ts`, `LinearApp/test/categorize.test.ts`. Delete `LinearApp/src/main/rule-engine.ts`, `LinearApp/test/rule-engine.test.ts`.

- [ ] **Step 1: 실패 테스트 작성 `LinearApp/test/categorize.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { categorize, representativeCategory, formatNotification, shouldNotify } from "../src/main/categorize";
import type { Identity } from "../src/shared/types";
import type { LinearWebhookEvent } from "../src/shared/protocol";

const me: Identity = { id: "user_me", name: "wglee" };

const issue = (over: Partial<LinearWebhookEvent> = {}): LinearWebhookEvent => ({
  action: "create", type: "Issue",
  data: { identifier: "ENG-1", title: "Fix login", description: "broken",
          assignee: { id: "user_me" }, url: "https://linear.app/x/issue/ENG-1" },
  actor: { id: "ux", name: "Alice" }, ...over,
});

describe("categorize", () => {
  it("담당 이슈 → assigned", () => {
    expect(categorize(issue(), me)).toContain("assigned");
  });
  it("담당자가 내가 아니면 assigned 아님", () => {
    const e = issue({ data: { identifier: "ENG-2", title: "x", assignee: { id: "other" } } });
    expect(categorize(e, me)).not.toContain("assigned");
  });
  it("본문에 내 멘션 → mention", () => {
    const e = issue({ data: { title: "hey @wglee 봐줘", assignee: { id: "other" } } });
    expect(categorize(e, me)).toContain("mention");
  });
  it("코멘트 → comment", () => {
    const c: LinearWebhookEvent = { action: "create", type: "Comment",
      data: { body: "확인했어요", issue: { title: "Fix login", identifier: "ENG-1" }, user: { name: "Bob" } } };
    expect(categorize(c, me)).toContain("comment");
  });
  it("ProjectUpdate → projectUpdate", () => {
    const p: LinearWebhookEvent = { action: "create", type: "ProjectUpdate", data: { body: "이번주 업데이트" } };
    expect(categorize(p, me)).toContain("projectUpdate");
  });
  it("멘션한 코멘트는 두 카테고리", () => {
    const c: LinearWebhookEvent = { action: "create", type: "Comment",
      data: { body: "@wglee 확인", issue: { title: "t" }, user: { name: "Bob" } } };
    const cats = categorize(c, me);
    expect(cats).toContain("mention");
    expect(cats).toContain("comment");
  });
});

describe("representativeCategory", () => {
  it("우선순위 mention > assigned > comment > projectUpdate", () => {
    expect(representativeCategory(["comment", "mention"])).toBe("mention");
    expect(representativeCategory(["comment", "assigned"])).toBe("assigned");
    expect(representativeCategory([])).toBe(null);
  });
});

describe("shouldNotify", () => {
  it("교집합 있으면 true", () => {
    expect(shouldNotify(["comment"], ["mention", "comment"])).toBe(true);
  });
  it("교집합 없으면 false", () => {
    expect(shouldNotify(["projectUpdate"], ["mention", "comment"])).toBe(false);
  });
});

describe("formatNotification", () => {
  it("이슈: 제목/본문/식별자/URL", () => {
    const r = formatNotification(issue());
    expect(r.title).toContain("ENG-1");
    expect(r.body).toContain("Fix login");
    expect(r.identifier).toBe("ENG-1");
    expect(r.issueUrl).toBe("https://linear.app/x/issue/ENG-1");
  });
  it("코멘트: 행위자 + 본문", () => {
    const c: LinearWebhookEvent = { action: "create", type: "Comment",
      data: { body: "looks good", issue: { title: "Fix login", identifier: "ENG-1" }, user: { name: "Bob" } } };
    const r = formatNotification(c);
    expect(r.title).toContain("Bob");
    expect(r.body).toContain("looks good");
  });
});
```

- [ ] **Step 2: 실패 확인**
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npx vitest run test/categorize.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: 구현 `LinearApp/src/main/categorize.ts`**
```ts
import type { Identity, Category } from "../shared/types";
import type { LinearWebhookEvent } from "../shared/protocol";

export interface NotificationContent {
  title: string;
  body: string;
  issueUrl?: string;
  identifier?: string;
}

export function categorize(event: LinearWebhookEvent, me: Identity): Category[] {
  const d = event.data as any;
  const cats: Category[] = [];
  const text = [d.title, d.description, d.body].filter(Boolean).join(" ").toLowerCase();
  const mentioned =
    (me.name !== "" && text.includes(`@${me.name.toLowerCase()}`)) ||
    (me.id !== "" && text.includes(me.id.toLowerCase()));
  if (mentioned) cats.push("mention");
  if (event.type === "Comment") cats.push("comment");
  if (event.type === "Issue" && me.id !== "" && String(d.assignee?.id ?? "") === me.id) cats.push("assigned");
  if (event.type === "ProjectUpdate" || event.type === "Project") cats.push("projectUpdate");
  return cats;
}

const PRIORITY: Category[] = ["mention", "assigned", "comment", "projectUpdate"];
export function representativeCategory(cats: Category[]): Category | null {
  for (const c of PRIORITY) if (cats.includes(c)) return c;
  return null;
}

export function shouldNotify(cats: Category[], enabled: Category[]): boolean {
  return cats.some((c) => enabled.includes(c));
}

export function formatNotification(event: LinearWebhookEvent): NotificationContent {
  const d = event.data as any;
  const actor = event.actor?.name ?? d.user?.name ?? "Someone";
  const issueUrl =
    (typeof event.url === "string" ? event.url : undefined) ??
    (typeof d.url === "string" ? d.url : undefined);
  if (event.type === "Comment") {
    const issueTitle = d.issue?.title ? ` on "${d.issue.title}"` : "";
    return {
      title: `${actor} commented${issueTitle}`,
      body: String(d.body ?? ""),
      issueUrl,
      identifier: d.issue?.identifier,
    };
  }
  const ident = d.identifier ?? d.issue?.identifier;
  const verb = event.action === "create" ? "created" : event.action === "remove" ? "removed" : "updated";
  return {
    title: `${actor} ${verb} ${event.type} ${ident ?? ""}`.trim(),
    body: [d.title, d.name, d.description].filter(Boolean).join("\n"),
    issueUrl,
    identifier: ident,
  };
}
```

- [ ] **Step 4: 통과 확인**
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npx vitest run test/categorize.test.ts`
Expected: PASS (전체 통과).

- [ ] **Step 5: 옛 rule-engine 삭제**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti
git rm LinearApp/src/main/rule-engine.ts LinearApp/test/rule-engine.test.ts
```

- [ ] **Step 6: Commit**
```bash
git add LinearApp/src/main/categorize.ts LinearApp/test/categorize.test.ts
git commit -m "feat(app): add categorize/formatNotification, remove rule-engine"
```

## Context
규칙 엔진을 대체. `categorize`는 이벤트가 어떤 알림 종류에 해당하는지 계산(서버가 이미 "내 것만" 보냄). `shouldNotify`로 설정 체크박스와 교집합 판단. `formatNotification`은 팝업·저장소에 쓸 제목/본문/이슈URL/식별자 생성. 모두 순수.

---

## Task 3: NotificationStore (TDD)

**Files:** Create `LinearApp/src/main/notification-store.ts`, `LinearApp/test/notification-store.test.ts`

- [ ] **Step 1: 실패 테스트 작성**
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotificationStore } from "../src/main/notification-store";

let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "noti-")); file = join(dir, "notifications.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sample = (over = {}) => ({
  category: "comment" as const, title: "t", body: "b", receivedAt: 1000, ...over,
});

describe("NotificationStore", () => {
  it("add 후 list에 최신순으로 들어가고 안읽음", () => {
    const s = new NotificationStore(file);
    s.add(sample({ title: "first", receivedAt: 1 }));
    s.add(sample({ title: "second", receivedAt: 2 }));
    const list = s.list();
    expect(list.map((n) => n.title)).toEqual(["second", "first"]);
    expect(s.unreadCount()).toBe(2);
  });

  it("최근 100개만 보관", () => {
    const s = new NotificationStore(file);
    for (let i = 0; i < 105; i++) s.add(sample({ title: `n${i}`, receivedAt: i }));
    expect(s.list().length).toBe(100);
    expect(s.list()[0].title).toBe("n104"); // 최신
  });

  it("markRead로 읽음 처리 + unreadCount 감소", () => {
    const s = new NotificationStore(file);
    const a = s.add(sample());
    s.markRead(a.id);
    expect(s.unreadCount()).toBe(0);
  });

  it("clearAll 후 비워짐", () => {
    const s = new NotificationStore(file);
    s.add(sample());
    s.clearAll();
    expect(s.list()).toEqual([]);
  });

  it("디스크에 영속(새 인스턴스가 읽음)", () => {
    const s1 = new NotificationStore(file);
    s1.add(sample({ title: "persisted" }));
    const s2 = new NotificationStore(file);
    expect(s2.list()[0].title).toBe("persisted");
  });

  it("손상 파일이면 빈 목록", () => {
    require("node:fs").writeFileSync(file, "{ not json");
    const s = new NotificationStore(file);
    expect(s.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npx vitest run test/notification-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현 `LinearApp/src/main/notification-store.ts`**
```ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { StoredNotification, Category } from "../shared/types";

const CAP = 100;

export interface NewNotification {
  category: Category;
  title: string;
  body: string;
  issueUrl?: string;
  identifier?: string;
  receivedAt: number;
}

export class NotificationStore {
  private items: StoredNotification[] = [];
  constructor(private file: string) {
    this.load();
  }

  private load() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      this.items = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.items = [];
    }
  }

  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.items, null, 2), "utf8");
  }

  add(n: NewNotification): StoredNotification {
    const item: StoredNotification = { id: randomUUID(), read: false, ...n };
    this.items.unshift(item); // 최신이 앞
    if (this.items.length > CAP) this.items = this.items.slice(0, CAP);
    this.persist();
    return item;
  }

  list(): StoredNotification[] {
    return this.items;
  }

  markRead(id: string): void {
    const it = this.items.find((x) => x.id === id);
    if (it && !it.read) {
      it.read = true;
      this.persist();
    }
  }

  clearAll(): void {
    this.items = [];
    this.persist();
  }

  unreadCount(): number {
    return this.items.filter((x) => !x.read).length;
  }
}
```

- [ ] **Step 4: 통과 확인**
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npx vitest run test/notification-store.test.ts`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti
git add LinearApp/src/main/notification-store.ts LinearApp/test/notification-store.test.ts
git commit -m "feat(app): add file-backed notification store (cap 100, read state)"
```

## Context
홈 인박스의 데이터 계층. 메인 프로세스가 소유, 앱 userData의 `notifications.json`에 영속. 최신순, 최근 100개, 읽음/안읽음. 손상 파일은 빈 목록으로 시작(config-store와 동일 패턴).

---

## Task 4: 메인 창 preload

**Files:** Create `LinearApp/src/preload/app-preload.ts`

- [ ] **Step 1: 구현**
```ts
import { contextBridge, ipcRenderer } from "electron";
import type { StoredNotification, Category } from "../shared/types";

contextBridge.exposeInMainWorld("api", {
  auth: {
    status: (): Promise<{ loggedIn: boolean; name: string }> => ipcRenderer.invoke("auth:status"),
    login: (): Promise<{ ok: boolean; name?: string; error?: string }> => ipcRenderer.invoke("auth:login"),
    logout: (): Promise<void> => ipcRenderer.invoke("auth:logout"),
    onChanged: (cb: (s: { loggedIn: boolean; name: string }) => void) =>
      ipcRenderer.on("auth:changed", (_e, s) => cb(s)),
  },
  notifications: {
    list: (): Promise<StoredNotification[]> => ipcRenderer.invoke("noti:list"),
    unread: (): Promise<number> => ipcRenderer.invoke("noti:unread"),
    markRead: (id: string): Promise<void> => ipcRenderer.invoke("noti:markRead", id),
    clearAll: (): Promise<void> => ipcRenderer.invoke("noti:clearAll"),
    onUpdate: (cb: () => void) => ipcRenderer.on("noti:updated", () => cb()),
  },
  settings: {
    getCategories: (): Promise<Category[]> => ipcRenderer.invoke("cat:get"),
    setCategories: (c: Category[]): Promise<void> => ipcRenderer.invoke("cat:set", c),
  },
  openIssue: (url: string): Promise<void> => ipcRenderer.invoke("issue:open", url),
  test: (): Promise<void> => ipcRenderer.invoke("settings:test"),
});
```

- [ ] **Step 2: 타입 체크**
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npx tsc --noEmit 2>&1 | grep -E "app-preload\.ts" || echo "app-preload clean"`
Expected: `app-preload clean`.

- [ ] **Step 3: Commit**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti
git add LinearApp/src/preload/app-preload.ts
git commit -m "feat(app): add main-window preload bridge"
```

## Context
단일 메인 창과 메인 프로세스 사이의 안전한 IPC 다리. 인증(상태/로그인/로그아웃/변경 push), 알림(목록/안읽음/읽음/모두지우기/갱신 push), 설정 카테고리, 이슈 열기, 테스트 알림.

---

## Task 5: 메인 창 UI (구조 + 다크 테마)

**Files:** Create `LinearApp/src/renderer/app/index.html`, `LinearApp/src/renderer/app/app.css`

- [ ] **Step 1: `index.html` 작성**
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="app.css" />
  </head>
  <body>
    <!-- 로그인 -->
    <section id="view-login" class="view">
      <div class="login-box">
        <div class="app-icon">🔔</div>
        <div class="app-name">Linear Noti</div>
        <button id="loginBtn" class="btn-primary">Linear로 로그인</button>
        <div class="login-hint">로그인하면 브라우저에서 Linear 인증이 열려요</div>
      </div>
    </section>

    <!-- 홈 -->
    <section id="view-home" class="view" hidden>
      <header class="topbar">
        <div class="title-wrap"><span class="title">알림</span><span id="unreadPill" class="pill" hidden></span></div>
        <button id="gearBtn" class="icon-btn" title="설정">⚙</button>
      </header>
      <div id="list" class="list"></div>
      <div id="empty" class="empty" hidden>아직 받은 알림이 없어요</div>
      <footer class="home-foot"><span id="clearAll" class="link">모두 지우기</span></footer>
    </section>

    <!-- 설정 -->
    <section id="view-settings" class="view" hidden>
      <header class="topbar">
        <button id="backBtn" class="icon-btn" title="뒤로">←</button>
        <span class="title">설정</span>
      </header>
      <div class="account">
        <div id="avatar" class="avatar"></div>
        <div class="acct-info"><div id="acctName" class="acct-name"></div><div id="acctHandle" class="acct-handle"></div></div>
        <span id="logoutBtn" class="logout">로그아웃</span>
      </div>
      <div class="section-label">받을 알림 종류</div>
      <div id="cats" class="cats"></div>
      <div class="settings-foot"><button id="testBtn" class="btn-ghost">테스트 알림</button></div>
    </section>

    <script src="app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: `app.css` 작성 (다크·둥근 테마)**
```css
:root{
  --bg:#20222e; --bar:#191b24; --surface:#2a2d3d; --surface2:#30334a;
  --text:#eceefb; --muted:#9a9db5; --dim:#6f7288;
  --accent:#8b7bf0; --coral:#ff9eb5;
}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);
  font-family:-apple-system,"Segoe UI",sans-serif;font-size:13px;}
.view{padding:0;}
.view[hidden]{display:none;}

/* 로그인 */
#view-login{height:100vh;display:flex;align-items:center;justify-content:center;}
.login-box{display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px;width:280px;}
.app-icon{width:76px;height:76px;border-radius:24px;background:var(--accent);
  display:flex;align-items:center;justify-content:center;font-size:38px;margin-bottom:18px;}
.app-name{font-size:21px;font-weight:600;margin-bottom:28px;}
.btn-primary{width:100%;padding:14px;font-size:15px;font-weight:600;border:none;border-radius:999px;
  background:var(--accent);color:#fff;cursor:pointer;}
.login-hint{font-size:11px;color:var(--dim);margin-top:16px;line-height:1.5;}

/* 공통 상단바 */
.topbar{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:16px;border-bottom:0.5px solid #34374a;}
.title-wrap{display:flex;align-items:center;gap:9px;}
.title{font-size:18px;font-weight:600;}
.pill{border-radius:999px;background:var(--coral);color:#3a1622;font-size:11px;font-weight:600;padding:3px 9px;}
.icon-btn{background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:4px;}

/* 홈 리스트 */
.list{display:flex;flex-direction:column;gap:9px;padding:14px 16px;overflow-y:auto;}
.ncard{background:var(--surface);border-radius:18px;padding:12px 14px;display:flex;gap:11px;
  align-items:flex-start;cursor:pointer;}
.ncard.unread{background:var(--surface2);}
.tag{width:34px;height:34px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  font-size:17px;flex-shrink:0;}
.ncard .body{flex:1;min-width:0;}
.ncard .h{font-size:13px;font-weight:600;}
.ncard .sub{font-size:12px;color:#b6b9d0;line-height:1.4;margin-top:2px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ncard .meta{font-size:11px;color:var(--dim);margin-top:5px;}
.ncard .udot{width:8px;height:8px;border-radius:50%;background:var(--coral);margin-top:4px;flex-shrink:0;}
.empty{color:var(--muted);text-align:center;padding:60px 20px;font-size:13px;}
.home-foot{text-align:center;padding:12px;}
.link{font-size:12px;color:#7f8298;cursor:pointer;}

/* 설정 */
.account{display:flex;align-items:center;gap:11px;background:var(--surface);border-radius:16px;
  padding:12px 14px;margin:16px;}
.avatar{width:38px;height:38px;border-radius:50%;background:var(--accent);
  display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;}
.acct-info{flex:1;}.acct-name{font-size:13px;font-weight:600;}.acct-handle{font-size:11px;color:var(--muted);}
.logout{font-size:11px;color:var(--coral);border:1px solid #5a3a45;border-radius:999px;padding:4px 11px;cursor:pointer;}
.section-label{font-size:12px;color:#7f8298;margin:6px 16px 10px;}
.cats{display:flex;flex-direction:column;gap:8px;padding:0 16px;}
.cat{display:flex;align-items:center;gap:11px;background:var(--surface);border-radius:14px;
  padding:11px 13px;cursor:pointer;}
.cat .chk{width:22px;height:22px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  font-size:14px;color:#fff;border:1.5px solid #4a4d63;background:transparent;}
.cat.on .chk{background:var(--accent);border-color:var(--accent);}
.cat .lbl{flex:1;}
.cat.off .lbl{color:var(--muted);}
.settings-foot{padding:18px 16px;}
.btn-ghost{padding:9px 16px;font-size:13px;border-radius:12px;background:var(--surface);
  border:0.5px solid #3a3d52;color:var(--text);cursor:pointer;}
```

- [ ] **Step 3: copy-assets가 app 폴더도 복사하는지 확인**
`package.json`의 `copy-assets`는 이미 `renderer/*` 하위 모든 폴더의 .html/.css를 복사하도록 일반화돼 있다(notification/settings 처리 시 만든 로직). `app` 폴더도 자동 포함되는지 확인만:
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && grep -o "readdirSync('src/renderer/'+d)" package.json && echo "generic copy OK"`
만약 `copy-assets`가 `['notification','settings']` 처럼 폴더명을 하드코딩하고 있다면, `package.json`의 `copy-assets`를 아래로 교체(모든 renderer 하위 폴더 순회):
```json
    "copy-assets": "node -e \"const fs=require('fs');const base='src/renderer';for(const d of fs.readdirSync(base)){const p=base+'/'+d;if(!fs.statSync(p).isDirectory())continue;fs.mkdirSync('dist/renderer/'+d,{recursive:true});for(const f of fs.readdirSync(p)){if(f.endsWith('.html')||f.endsWith('.css'))fs.copyFileSync(p+'/'+f,'dist/renderer/'+d+'/'+f);}}\"",
```

- [ ] **Step 4: Commit**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti
git add LinearApp/src/renderer/app/index.html LinearApp/src/renderer/app/app.css LinearApp/package.json
git commit -m "feat(app): main window markup + dark rounded theme"
```

## Context
3개 뷰(로그인/홈/설정)를 한 HTML에 두고 JS로 전환. 다크 슬레이트 + 라벤더 + 코랄 팔레트, 둥근 모서리. 앱 아이콘은 임시로 벨 이모지(추후 실제 아이콘 자산으로 교체 가능). `copy-assets`가 `app` 폴더의 html/css를 dist로 복사해야 렌더러가 로드된다.

---

## Task 6: 메인 창 로직 (라우팅 + 렌더링)

**Files:** Create `LinearApp/src/renderer/app/app.ts`

- [ ] **Step 1: 구현**
```ts
import type { StoredNotification, Category } from "../../shared/types";

declare const api: {
  auth: {
    status: () => Promise<{ loggedIn: boolean; name: string }>;
    login: () => Promise<{ ok: boolean; name?: string; error?: string }>;
    logout: () => Promise<void>;
    onChanged: (cb: (s: { loggedIn: boolean; name: string }) => void) => void;
  };
  notifications: {
    list: () => Promise<StoredNotification[]>;
    unread: () => Promise<number>;
    markRead: (id: string) => Promise<void>;
    clearAll: () => Promise<void>;
    onUpdate: (cb: () => void) => void;
  };
  settings: { getCategories: () => Promise<Category[]>; setCategories: (c: Category[]) => Promise<void> };
  openIssue: (url: string) => Promise<void>;
  test: () => Promise<void>;
};

const $ = (id: string) => document.getElementById(id)!;
const views = { login: $("view-login"), home: $("view-home"), settings: $("view-settings") };
function show(v: keyof typeof views) {
  for (const k of Object.keys(views) as (keyof typeof views)[]) (views[k] as HTMLElement).hidden = k !== v;
}

const CAT_META: Record<Category, { icon: string; label: string; tagBg: string; iconColor: string }> = {
  mention: { icon: "@", label: "나를 멘션", tagBg: "#3a3170", iconColor: "#b9a7ff" },
  comment: { icon: "💬", label: "코멘트", tagBg: "#173a4a", iconColor: "#7fc8e0" },
  assigned: { icon: "◎", label: "담당 이슈 변경", tagBg: "#3a3115", iconColor: "#f0c674" },
  projectUpdate: { icon: "▤", label: "프로젝트 업데이트", tagBg: "#143a30", iconColor: "#7fe0c0" },
};
const ALL: Category[] = ["mention", "comment", "assigned", "projectUpdate"];

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

async function renderHome() {
  const items = await api.notifications.list();
  const unread = await api.notifications.unread();
  const pill = $("unreadPill");
  if (unread > 0) { pill.textContent = `${unread} 안읽음`; pill.hidden = false; } else { pill.hidden = true; }
  ($("empty") as HTMLElement).hidden = items.length > 0;
  const list = $("list");
  list.innerHTML = "";
  for (const n of items) {
    const m = CAT_META[n.category];
    const card = document.createElement("div");
    card.className = "ncard" + (n.read ? "" : " unread");
    card.innerHTML =
      `<div class="tag" style="background:${m.tagBg};color:${m.iconColor}">${m.icon}</div>` +
      `<div class="body"><div class="h"></div><div class="sub"></div>` +
      `<div class="meta">${n.identifier ? n.identifier + " · " : ""}${relTime(n.receivedAt)}</div></div>` +
      (n.read ? "" : `<div class="udot"></div>`);
    (card.querySelector(".h") as HTMLElement).textContent = n.title;
    (card.querySelector(".sub") as HTMLElement).textContent = n.body;
    card.addEventListener("click", async () => {
      await api.notifications.markRead(n.id);
      if (n.issueUrl) await api.openIssue(n.issueUrl);
      renderHome();
    });
    list.appendChild(card);
  }
}

async function renderSettings() {
  const st = await api.auth.status();
  ($("acctName") as HTMLElement).textContent = st.name || "(이름 불러오는 중)";
  ($("acctHandle") as HTMLElement).textContent = st.name;
  ($("avatar") as HTMLElement).textContent = (st.name || "?").slice(0, 1);
  const enabled = await api.settings.getCategories();
  const cats = $("cats");
  cats.innerHTML = "";
  for (const c of ALL) {
    const on = enabled.includes(c);
    const row = document.createElement("div");
    row.className = "cat " + (on ? "on" : "off");
    row.innerHTML = `<div class="chk">${on ? "✓" : ""}</div><div class="lbl">${CAT_META[c].label}</div>`;
    row.addEventListener("click", async () => {
      const cur = await api.settings.getCategories();
      const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
      await api.settings.setCategories(next);
      renderSettings();
    });
    cats.appendChild(row);
  }
}

$("loginBtn").addEventListener("click", async () => {
  ($("loginBtn") as HTMLButtonElement).textContent = "브라우저에서 로그인 중…";
  const r = await api.auth.login();
  ($("loginBtn") as HTMLButtonElement).textContent = "Linear로 로그인";
  if (r.ok) { show("home"); renderHome(); }
});
$("gearBtn").addEventListener("click", () => { show("settings"); renderSettings(); });
$("backBtn").addEventListener("click", () => { show("home"); renderHome(); });
$("clearAll").addEventListener("click", async () => { await api.notifications.clearAll(); renderHome(); });
$("logoutBtn").addEventListener("click", async () => { await api.auth.logout(); show("login"); });
$("testBtn").addEventListener("click", () => api.test());

api.notifications.onUpdate(() => { if (!(views.home as HTMLElement).hidden) renderHome(); });
api.auth.onChanged((s) => { if (s.loggedIn && (views.login as HTMLElement).hidden === false) { show("home"); renderHome(); } });

(async function init() {
  const st = await api.auth.status();
  if (st.loggedIn) { show("home"); renderHome(); } else { show("login"); }
})();
```

- [ ] **Step 2: 빌드**
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npm run build 2>&1 | tail -5`
Expected: 렌더러 컴파일됨. main.ts가 아직 옛 배선이면 main.ts 에러가 날 수 있음(Task 8에서 해결). 이 태스크는 app.ts 자체가 컴파일되는지 확인:
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npx tsc --noEmit 2>&1 | grep -E "renderer/app/app\.ts" || echo "app.ts clean"`
Expected: `app.ts clean`.

- [ ] **Step 3: Commit**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti
git add LinearApp/src/renderer/app/app.ts
git commit -m "feat(app): main window view routing + home/settings rendering"
```

## Context
3뷰 전환 + 데이터 렌더링. 홈은 저장소 목록을 카드로(안읽음 강조), 클릭 시 읽음+이슈 열기. 설정은 계정 + 카테고리 체크박스(토글 즉시 저장). 자동 로그인: init에서 status 확인 후 로그인됨이면 홈으로. 아이콘은 임시 텍스트/이모지(추후 교체).

---

## Task 7: 중앙 팝업 다크 테마 + 카테고리 accent

**Files:** Modify `LinearApp/src/renderer/notification/notification.css`, `LinearApp/src/preload/notification-preload.ts`, `LinearApp/src/renderer/notification/notification.ts`, `LinearApp/src/renderer/notification/index.html`, `LinearApp/src/main/notification-manager.ts`

- [ ] **Step 1: `notification.css` 교체 (새 팔레트 + 좌측 accent 바)**
```css
html, body { margin: 0; background: transparent; overflow: hidden; font-family: -apple-system, "Segoe UI", sans-serif; }
#card {
  margin: 8px; padding: 16px 18px; border-radius: 18px;
  background: #2a2d3d; color: #eceefb; cursor: pointer;
  border: 1px solid #3a3d52; border-left: 4px solid var(--accent, #8b7bf0);
  box-shadow: 0 10px 30px rgba(0,0,0,0.45);
}
#title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
#body { font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word;
  max-height: 160px; overflow: hidden; color: #b6b9d0; }
```

- [ ] **Step 2: `index.html` (notification) — accent용 CSS 변수 적용 지점 확인**
기존 `#card`가 `var(--accent)`를 쓰므로, 렌더러에서 `document.documentElement.style.setProperty('--accent', color)`로 설정한다. `notification.ts`를 아래로 교체:
```ts
declare const notiApi: {
  onContent: (cb: (d: { title: string; body: string; accent?: string }) => void) => void;
  dismiss: () => void;
};

notiApi.onContent((d) => {
  document.getElementById("title")!.textContent = d.title;
  document.getElementById("body")!.textContent = d.body;
  if (d.accent) document.documentElement.style.setProperty("--accent", d.accent);
});
document.getElementById("card")!.addEventListener("click", () => notiApi.dismiss());
```
(`notification-preload.ts`는 content를 그대로 전달하므로 변경 불필요 — `onContent` 콜백 타입에 accent가 추가될 뿐. 확인만 하고, 타입 불일치 없으면 그대로 둔다.)

- [ ] **Step 3: `notification-manager.ts` — show가 accent를 받도록**
`show(text: NotificationText)` 시그니처를 `show(text: { title: string; body: string; accent?: string })`로 바꾸고, `win.webContents.send("noti:content", text)`가 accent까지 전달하도록 한다(이미 text 객체를 통째로 보내므로, 타입만 확장). 파일 상단 import에서 `NotificationText`를 쓰고 있다면 로컬 타입으로 대체:
```ts
export interface PopupContent { title: string; body: string; accent?: string; }
```
그리고 `show(text: PopupContent)`로 변경. 본문 로직은 그대로.

- [ ] **Step 4: 빌드 확인**
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npx tsc --noEmit 2>&1 | grep -E "notification" || echo "notification files clean"`
Expected: `notification files clean` (main.ts가 show를 옛 시그니처로 부르면 main.ts 에러 — Task 8에서 해결).

- [ ] **Step 5: Commit**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti
git add LinearApp/src/renderer/notification/ LinearApp/src/main/notification-manager.ts LinearApp/src/preload/notification-preload.ts
git commit -m "feat(app): dark themed center popup with category accent"
```

## Context
중앙 팝업을 새 팔레트(#2a2d3d, 라벤더 좌측 바)로 맞춤. main이 알림의 대표 카테고리 색을 `accent`로 전달해 팝업 좌측 바 색이 종류별로 달라진다.

---

## Task 8: main.ts 배선 (저장소·분류·뱃지·IPC·메인창·로그아웃)

**Files:** Modify `LinearApp/src/main/main.ts`

- [ ] **Step 1: 전체 교체**
```ts
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } from "electron";
import { join } from "node:path";
import { loadSettings, saveSettings } from "./config-store";
import { categorize, representativeCategory, formatNotification, shouldNotify } from "./categorize";
import { NotificationStore } from "./notification-store";
import { RelayClient } from "./ws-client";
import { NotificationManager } from "./notification-manager";
import { login } from "./auth-client";
import type { Settings, Category } from "../shared/types";

const settingsFile = () => join(app.getPath("userData"), "settings.json");
const notiFile = () => join(app.getPath("userData"), "notifications.json");

const ACCENT: Record<Category, string> = {
  mention: "#b9a7ff", comment: "#7fc8e0", assigned: "#f0c674", projectUpdate: "#7fe0c0",
};

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let settings: Settings;
let store: NotificationStore;
const notifications = new NotificationManager();
let client: RelayClient;

function openWindow() {
  if (win && !win.isDestroyed()) { win.focus(); return; }
  win = new BrowserWindow({
    width: 380, height: 620, title: "Linear Noti",
    webPreferences: {
      preload: join(__dirname, "../preload/app-preload.js"),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "../renderer/app/index.html"));
}

function updateBadge() {
  const n = store.unreadCount();
  if (app.dock) app.dock.setBadge(n > 0 ? String(n) : "");
  if (tray) tray.setToolTip(n > 0 ? `Linear Noti — 안읽음 ${n}` : "Linear Noti");
}

function pushNotiUpdate() {
  if (win && !win.isDestroyed()) win.webContents.send("noti:updated");
  updateBadge();
}

function buildTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Linear Noti");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "열기", click: openWindow },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]));
  tray.on("click", openWindow);
}

app.whenReady().then(() => {
  settings = loadSettings(settingsFile());
  store = new NotificationStore(notiFile());

  ipcMain.handle("auth:status", () => ({ loggedIn: !!settings.sessionToken, name: settings.me.name }));
  ipcMain.handle("auth:login", async () => {
    try {
      const token = await login(settings.relayUrl, (url) => shell.openExternal(url));
      settings = { ...settings, sessionToken: token };
      saveSettings(settingsFile(), settings);
      client.stop(); client.start();
      return { ok: true, name: settings.me.name };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle("auth:logout", () => {
    settings = { ...settings, sessionToken: "", me: { id: "", name: "" } };
    saveSettings(settingsFile(), settings);
    client.stop();
  });

  ipcMain.handle("noti:list", () => store.list());
  ipcMain.handle("noti:unread", () => store.unreadCount());
  ipcMain.handle("noti:markRead", (_e, id: string) => { store.markRead(id); updateBadge(); });
  ipcMain.handle("noti:clearAll", () => { store.clearAll(); pushNotiUpdate(); });

  ipcMain.handle("cat:get", () => settings.enabledCategories);
  ipcMain.handle("cat:set", (_e, c: Category[]) => {
    settings = { ...settings, enabledCategories: c };
    saveSettings(settingsFile(), settings);
  });

  ipcMain.handle("issue:open", (_e, url: string) => { if (url) shell.openExternal(url); });
  ipcMain.handle("settings:test", () => {
    notifications.show({ title: "테스트 알림", body: "정중앙 알림이 정상 동작합니다.", accent: ACCENT.mention });
  });

  client = new RelayClient(
    () => ({ relayUrl: settings.relayUrl, sessionToken: settings.sessionToken }),
    (msg) => {
      const cats = categorize(msg.event, settings.me);
      if (!shouldNotify(cats, settings.enabledCategories)) return;
      const rep = representativeCategory(cats)!;
      const c = formatNotification(msg.event);
      store.add({ category: rep, title: c.title, body: c.body, issueUrl: c.issueUrl, identifier: c.identifier, receivedAt: msg.receivedAt });
      notifications.show({ title: c.title, body: c.body, accent: ACCENT[rep] });
      pushNotiUpdate();
    },
    (you) => {
      settings = { ...settings, me: { id: you.id, name: you.name } };
      saveSettings(settingsFile(), settings);
      if (win && !win.isDestroyed()) win.webContents.send("auth:changed", { loggedIn: true, name: you.name });
    },
    () => {
      settings = { ...settings, sessionToken: "" };
      saveSettings(settingsFile(), settings);
      if (win && !win.isDestroyed()) win.webContents.send("auth:changed", { loggedIn: false, name: "" });
      openWindow();
    },
  );
  client.start();

  buildTray();
  updateBadge();
  openWindow();
});

app.on("window-all-closed", () => { /* 트레이 상주 */ });
```

- [ ] **Step 2: 빌드 + 전체 테스트**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npm run build && npm test 2>&1 | tail -8
```
Expected: tsc 0 에러; 모든 단위 테스트 통과(categorize + notification-store + backoff + tokens + auth-client + config-store).

- [ ] **Step 3: dist 엔트리 확인**
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && ls dist/main/main.js dist/main/notification-store.js dist/main/categorize.js dist/preload/app-preload.js dist/renderer/app/index.html dist/renderer/app/app.js dist/renderer/app/app.css`
Expected: 전부 존재.

- [ ] **Step 4: Commit**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti
git add LinearApp/src/main/main.ts
git commit -m "feat(app): wire store, categorize, badge, IPC, main window, logout"
```

## Context
모든 조각을 연결. 이벤트 수신 → categorize → enabledCategories와 교집합 있으면 → 저장소 add + 중앙 팝업(대표 카테고리 색) + 홈/뱃지 갱신. 자동 로그인(저장된 세션이면 바로 연결, hello가 신원 채움). 로그아웃은 세션·신원 비우고 클라이언트 정지. 트레이 안읽음 뱃지(macOS dock).

---

## Task 9: 옛 설정창 제거 + 정리

**Files:** Delete `LinearApp/src/preload/settings-preload.ts`, `LinearApp/src/renderer/settings/`

- [ ] **Step 1: 옛 설정 렌더러/프리로드 삭제**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti
git rm LinearApp/src/preload/settings-preload.ts
git rm -r LinearApp/src/renderer/settings
```

- [ ] **Step 2: dist 잔여 정리 후 클린 빌드 + 테스트**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && rm -rf dist && npm run build && npm test 2>&1 | tail -8
```
Expected: tsc 0 에러, 모든 테스트 통과, `dist/renderer/settings` 없음(`ls dist/renderer` 로 확인 → app, notification 만).

- [ ] **Step 3: 참조 잔재 확인**
Run: `cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && grep -rn "settings-preload\|renderer/settings\|rule-engine\|enabledCategories\|\\brules\\b" src | grep -v "enabledCategories" || echo "no stale refs"`
Expected: 옛 `settings-preload`/`renderer/settings`/`rule-engine`/`rules` 참조가 없어야 함(있으면 제거). `enabledCategories`는 정상.

- [ ] **Step 4: Commit**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti
git commit -m "chore(app): remove old settings window (replaced by main app window)"
```

## Context
단일 설정창을 새 3뷰 메인 창이 대체하므로 옛 파일 제거. 빌드 산출물에 잔재가 없어야 함.

---

## Task 10: E2E + 패키징

- [ ] **Step 1: 앱 실행**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npm start
```
화면 확인: 처음엔 **로그인 화면**(아이콘+이름+버튼+안내문). "Linear로 로그인" → 브라우저 승인 → **홈**으로 전환. 톱니 → 설정(계정+체크박스). "테스트 알림" → 중앙 팝업(다크, 라벤더 바). 트레이 안읽음 뱃지.

- [ ] **Step 2: 실제 알림 인박스 확인**
다른 계정이 당신을 멘션/담당 지정 → 중앙 팝업 + **홈 리스트에 항목 추가**(안읽음 코랄 점) → 클릭 시 이슈 열림 + 읽음 처리 + 뱃지 감소. 설정에서 특정 종류 체크 해제 → 그 종류는 더 이상 안 옴.

- [ ] **Step 3: 자동 로그인 확인**
앱 종료 후 재실행 → 로그인 화면 없이 **바로 홈**(저장된 세션). 

- [ ] **Step 4: 패키징**
```bash
cd /Users/hwamulman/woogunProject/LinearNoti/LinearApp && npm run dist
```
macOS `.dmg` / Windows `.exe` 생성(각 OS에서).

- [ ] **Step 5: README 갱신 + 커밋**
`README.md`의 앱 사용/설정 섹션을 3화면(로그인/홈/설정)·카테고리 체크박스·인박스 기준으로 갱신.
```bash
git add README.md && git commit -m "docs: update app usage for 3-screen UI and inbox"
```

---

## Self-Review 메모

- **Spec coverage:** 3화면(Task 5,6), 로그인(2-1→Task5,6,8), 홈 인박스+클릭열기+읽음+모두지우기(Task3,6,8), 설정 체크박스(Task1,6,8), 자동 로그인(Task6,8 init/status), 중앙팝업 유지+재스타일(Task7), 트레이 뱃지(Task8), 카테고리 분류(Task2), 알림 저장소(Task3), 비주얼 시스템(Task5), 로그아웃(Task6,8) — 스펙 전 항목 커버.
- **타입 일관성:** `Category`/`StoredNotification`/`Settings.enabledCategories`(Task1) → categorize 반환/`shouldNotify`(Task2) → store `NewNotification`/`add`(Task3) → preload/IPC 채널명(Task4) ↔ renderer api(Task6) ↔ main 핸들러(Task8) 모두 동일 채널·시그니처. 팝업 `PopupContent{title,body,accent?}`(Task7) ↔ main `notifications.show`(Task8) 일치.
- **YAGNI:** 라이트모드/검색/스누즈/멀티워크스페이스 제외(스펙과 일치). 아이콘은 임시 이모지/텍스트(실제 자산 교체는 후속).
- **알려진 한계:** 구독만 하고 담당/멘션 아닌 이슈 변경은 4종 카테고리 미해당 시 알림 안 됨(설계 합의). 렌더러 UI는 헤드리스 자동테스트 불가 → Task 10 수동 e2e.
```
