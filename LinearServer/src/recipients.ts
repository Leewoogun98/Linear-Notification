import type { LinearWebhookEvent } from "./protocol";

export interface ConnectedUser {
  userId: string;
  displayName: string;
}

// 이벤트와 "관련된" 사용자 id 집합.
// 1) 이벤트 내재 신호: 담당자(assignee), 구독자(subscriberIds), 부모 이슈 구독자, 프로젝트 멤버(memberIds).
// 2) 멘션: 본문(title/description/body)에 연결된 사용자의 @displayName 이 있으면 그 사용자.
//    (코멘트 payload엔 구독자 정보가 없어 본문 멘션 파싱이 유일한 신호다.)
export function computeRecipients(event: LinearWebhookEvent, connected: ConnectedUser[]): string[] {
  const d = event.data as any;
  const ids = new Set<string>();
  const add = (x: unknown) => { if (typeof x === "string" && x.length > 0) ids.add(x); };

  add(d.assignee?.id);
  if (Array.isArray(d.subscriberIds)) d.subscriberIds.forEach(add);
  if (Array.isArray(d.memberIds)) d.memberIds.forEach(add);
  if (Array.isArray(d.issue?.subscriberIds)) d.issue.subscriberIds.forEach(add);
  add(d.issue?.assignee?.id);

  const body = [d.title, d.description, d.body].filter(Boolean).join(" ").toLowerCase();
  for (const u of connected) {
    if (u.displayName && body.includes(`@${u.displayName.toLowerCase()}`)) ids.add(u.userId);
  }
  return [...ids];
}
