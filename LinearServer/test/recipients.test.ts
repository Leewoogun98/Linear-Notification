import { describe, it, expect } from "vitest";
import { computeRecipients } from "../src/recipients";
import type { LinearWebhookEvent } from "../src/protocol";

const ev = (data: Record<string, unknown>, type = "Issue"): LinearWebhookEvent => ({ action: "create", type, data });

describe("computeRecipients", () => {
  it("담당자 id 포함 (연결 무관)", () => {
    expect(computeRecipients(ev({ assignee: { id: "u1" } }), [])).toContain("u1");
  });
  it("subscriberIds 포함", () => {
    expect(computeRecipients(ev({ subscriberIds: ["u2", "u3"] }), []).sort()).toEqual(["u2", "u3"]);
  });
  it("코멘트 본문 @displayName 멘션 → 그 연결 사용자", () => {
    const c = ev({ body: "@wglee 코멘트" }, "Comment");
    const r = computeRecipients(c, [{ userId: "u_me", displayName: "wglee" }]);
    expect(r).toContain("u_me");
  });
  it("멘션돼도 연결 안 된 사용자는 알 수 없어 제외", () => {
    const c = ev({ body: "@someone 코멘트" }, "Comment");
    expect(computeRecipients(c, [{ userId: "u_me", displayName: "wglee" }])).toEqual([]);
  });
  it("프로젝트 memberIds 포함 (연결 무관)", () => {
    const p = ev({ name: "New Project", memberIds: ["u_me", "u_other"] }, "Project");
    expect(computeRecipients(p, []).sort()).toEqual(["u_me", "u_other"]);
  });
  it("프로젝트 leadId / creatorId 포함", () => {
    const p = ev({ name: "P", leadId: "u_lead", creatorId: "u_creator" }, "Project");
    expect(computeRecipients(p, []).sort()).toEqual(["u_creator", "u_lead"]);
  });
  it("프로젝트 업데이트 코멘트 → 업데이트 작성자 포함", () => {
    const c = ev({ body: "good", projectUpdateId: "pu1", projectUpdate: { id: "pu1", userId: "u_author", project: { url: "x" } } }, "Comment");
    expect(computeRecipients(c, [])).toContain("u_author");
  });
  it("관련 정보 없으면 빈 배열", () => {
    expect(computeRecipients(ev({ title: "x" }), [])).toEqual([]);
  });
  it("리액션(코멘트) → 코멘트 작성자 포함", () => {
    const r = ev({ emoji: "+1", comment: { id: "c1", userId: "u_author" }, userId: "u_reactor" }, "Reaction");
    expect(computeRecipients(r, [])).toContain("u_author");
  });
  it("리액션(프로젝트 업데이트) → 업데이트 작성자 포함", () => {
    const r = ev({ emoji: "+1", projectUpdate: { id: "pu1", userId: "u_author" }, userId: "u_reactor" }, "Reaction");
    expect(computeRecipients(r, [])).toContain("u_author");
  });
});
