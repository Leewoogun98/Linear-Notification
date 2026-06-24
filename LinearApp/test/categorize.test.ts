import { describe, it, expect } from "vitest";
import { categorize, representativeCategory, formatNotification, shouldNotify } from "../src/main/categorize";
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
  it("이슈: top-level event.url을 우선 사용", () => {
    const e: LinearWebhookEvent = {
      action: "create", type: "Issue", url: "https://linear.app/top/ENG-9",
      data: { identifier: "ENG-9", title: "x", assignee: { id: "user_me" } },
      actor: { id: "ux", name: "Alice" },
    };
    expect(formatNotification(e).issueUrl).toBe("https://linear.app/top/ENG-9");
  });
});
