import type { LinearWebhookEvent } from "./protocol";

// 이벤트와 "관련된" 사용자 id 집합을 구한다.
// 1차 신호: 담당자(assignee) + 구독자(subscriberIds). Linear는 멘션/담당/생성 시 자동 구독하므로
// subscriberIds가 멘션까지 사실상 포괄한다. 코멘트는 부모 이슈의 구독자를 본다.
// 정보가 없으면 빈 배열 → 아무에게도 전송하지 않음(과다 전송보다 미전송이 프라이버시상 안전).
export function computeRecipients(event: LinearWebhookEvent): string[] {
  const d = event.data as any;
  const ids = new Set<string>();
  const add = (x: unknown) => {
    if (typeof x === "string" && x.length > 0) ids.add(x);
  };

  add(d.assignee?.id);
  if (Array.isArray(d.subscriberIds)) d.subscriberIds.forEach(add);
  if (Array.isArray(d.issue?.subscriberIds)) d.issue.subscriberIds.forEach(add);
  add(d.issue?.assignee?.id);

  return [...ids];
}
