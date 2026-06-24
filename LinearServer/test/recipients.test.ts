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
