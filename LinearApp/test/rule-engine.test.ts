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

  it("빈 value의 team 필터는 매칭하지 않는다", () => {
    const r = rule({ eventTypes: ["Issue"], filters: [{ kind: "team", value: "" }] });
    // team이 없는 이벤트
    const noTeam = issue({ data: { id: "I2", title: "x" } });
    expect(evaluateEvent(noTeam, [r], me).matched).toBe(false);
  });

  it("team 필터는 name으로도 매칭된다", () => {
    const r = rule({ eventTypes: ["Issue"], filters: [{ kind: "team", value: "Engineering" }] });
    expect(evaluateEvent(issue(), [r], me).matched).toBe(true);
  });

  it("assignee가 내가 아니면 매칭 안 됨", () => {
    const other = issue({ data: { id: "I3", title: "x", assignee: { id: "user_other", name: "Bob" } } });
    const r = rule({ eventTypes: ["Issue"], filters: [{ kind: "assignee" }] });
    expect(evaluateEvent(other, [r], me).matched).toBe(false);
  });

  it("mentionsMe: 내 핸들이 없으면 매칭 안 됨", () => {
    const comment: LinearWebhookEvent = {
      action: "create", type: "Comment",
      data: { id: "C2", body: "general note", issue: { title: "Fix login" }, user: { name: "Alice" } },
    };
    const r = rule({ eventTypes: ["Comment"], filters: [{ kind: "mentionsMe" }] });
    expect(evaluateEvent(comment, [r], me).matched).toBe(false);
  });

  it("규칙이 비면 전부 매칭(받은 내 알림 모두 표시)", () => {
    const res = evaluateEvent(issue(), [], me);
    expect(res.matched).toBe(true);
    expect(res.text?.body).toContain("Fix login");
  });

  it("여러 규칙 중 첫 매칭 규칙이 반환된다", () => {
    const r1 = rule({ id: "first", name: "first", eventTypes: ["Issue"], filters: [{ kind: "label", value: "urgent" }] });
    const r2 = rule({ id: "second", name: "second", eventTypes: ["Issue"] });
    const res = evaluateEvent(issue(), [r1, r2], me);
    expect(res.matched).toBe(true);
    expect(res.rule?.id).toBe("first");
  });
});
