import { describe, it, expect } from "vitest";
import { categorize, representativeCategory, formatNotification, shouldNotify, projectChanges } from "../src/main/categorize";
import type { Identity } from "../src/shared/types";
import type { LinearWebhookEvent } from "../src/shared/protocol";

const me: Identity = { id: "user_me", name: "이우건", displayName: "wglee" };

const issue = (over: Partial<LinearWebhookEvent> = {}): LinearWebhookEvent => ({
  action: "create", type: "Issue",
  data: { identifier: "ENG-1", title: "Fix login", description: "broken",
          assignee: { id: "user_me" }, url: "https://linear.app/x/issue/ENG-1" },
  actor: { id: "ux", name: "Alice" }, ...over,
});

describe("categorize", () => {
  it("본문에 내 멘션 → mention", () => {
    const e = issue({ data: { title: "hey @wglee 봐줘", assignee: { id: "other" } } });
    expect(categorize(e, me)).toContain("mention");
  });
  it("ProjectUpdate → projectUpdate", () => {
    const p: LinearWebhookEvent = { action: "create", type: "ProjectUpdate", data: { body: "이번주 업데이트" } };
    expect(categorize(p, me)).toContain("projectUpdate");
  });
  it("멘션한 코멘트는 mention 카테고리", () => {
    const c: LinearWebhookEvent = { action: "create", type: "Comment",
      data: { body: "@wglee 확인", issue: { title: "t" }, user: { name: "Bob" } } };
    const cats = categorize(c, me);
    expect(cats).toContain("mention");
    expect(cats).not.toContain("comment");
  });
  it("프로젝트 업데이트 코멘트 → projectUpdate 카테고리", () => {
    const c: LinearWebhookEvent = { action: "create", type: "Comment",
      data: { body: "good", projectUpdateId: "pu1", projectUpdate: { project: { name: "P", url: "https://linear.app/x/project/p" } }, user: { name: "Bob" } } };
    expect(categorize(c, me)).toContain("projectUpdate");
  });
  it("리액션 추가 → reaction 카테고리", () => {
    const r: LinearWebhookEvent = { action: "create", type: "Reaction",
      data: { emoji: "+1", comment: { body: "코멘트33", userId: "user_me" }, user: { name: "Bob" } },
      actor: { id: "bob", name: "Bob" } };
    expect(categorize(r, me)).toContain("reaction");
  });
  it("리액션 제거(remove)는 알림하지 않음", () => {
    const r: LinearWebhookEvent = { action: "remove", type: "Reaction",
      data: { emoji: "+1", comment: { body: "코멘트33", userId: "user_me" } },
      actor: { id: "bob", name: "Bob" } };
    expect(categorize(r, me)).not.toContain("reaction");
  });
});

describe("representativeCategory", () => {
  it("우선순위 mention > projectUpdate", () => {
    expect(representativeCategory(["projectUpdate", "mention"])).toBe("mention");
    expect(representativeCategory(["projectUpdate"])).toBe("projectUpdate");
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
  it("리액션: 행위자 + 이모지 + 대상 코멘트 본문", () => {
    const r: LinearWebhookEvent = { action: "create", type: "Reaction",
      data: { emoji: "+1", comment: { body: "코멘트33", userId: "user_me" }, user: { name: "Bob" } },
      actor: { id: "bob", name: "Bob" } };
    const out = formatNotification(r);
    expect(out.title).toContain("Bob");
    expect(out.title).toContain("👍");
    expect(out.body).toContain("코멘트33");
  });
  it("코멘트: 부모 이슈 url을 issueUrl로 사용", () => {
    const c: LinearWebhookEvent = { action: "create", type: "Comment",
      data: { body: "hi", issue: { title: "t", identifier: "ENG-1", url: "https://linear.app/x/issue/ENG-1" }, user: { name: "Bob" } } };
    expect(formatNotification(c).issueUrl).toBe("https://linear.app/x/issue/ENG-1");
  });
  it("이슈: top-level event.url을 우선 사용", () => {
    const e: LinearWebhookEvent = {
      action: "create", type: "Issue", url: "https://linear.app/top/ENG-9",
      data: { identifier: "ENG-9", title: "x", assignee: { id: "user_me" } },
      actor: { id: "ux", name: "Alice" },
    };
    expect(formatNotification(e).issueUrl).toBe("https://linear.app/top/ENG-9");
  });
  it("프로젝트 업데이트 코멘트의 url은 프로젝트 url", () => {
    const c: LinearWebhookEvent = { action: "create", type: "Comment",
      data: { body: "good", projectUpdateId: "pu1", projectUpdate: { project: { name: "P", url: "https://linear.app/x/project/p" } }, user: { name: "Bob" } } };
    expect(formatNotification(c).issueUrl).toBe("https://linear.app/x/project/p");
  });
});

const projectEvent = (over: Partial<LinearWebhookEvent> = {}): LinearWebhookEvent => ({
  action: "update", type: "Project",
  data: { name: "New Project", url: "https://linear.app/x/project/p", status: { name: "완료" } },
  updatedFrom: { statusId: "old", updatedAt: "t" },
  ...over,
});

describe("project changes", () => {
  it("상태 변경 → projectUpdate 카테고리", () => {
    expect(categorize(projectEvent(), me)).toContain("projectUpdate");
  });
  it("상태 변경 → 본문에 '상태: 완료'", () => {
    expect(formatNotification(projectEvent()).body).toContain("상태: 완료");
  });
  it("정렬/타임스탬프만 바뀐 업데이트는 projectUpdate 아님(노이즈 억제)", () => {
    const e = projectEvent({ updatedFrom: { sortOrder: 1, updatedAt: "t" } });
    expect(categorize(e, me)).not.toContain("projectUpdate");
  });
  it("프로젝트 생성은 updatedFrom 없어도 항상 projectUpdate", () => {
    const e = projectEvent({ action: "create", updatedFrom: undefined });
    expect(categorize(e, me)).toContain("projectUpdate");
  });
  it("새 업데이트 게시(lastUpdateId 변경) → 안내 문구", () => {
    const e = projectEvent({ updatedFrom: { lastUpdateId: "x", healthUpdatedAt: "t" } });
    expect(formatNotification(e).body).toContain("새 프로젝트 업데이트 게시됨");
  });
});
