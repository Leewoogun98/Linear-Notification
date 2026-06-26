import type { LinearWebhookEvent } from "./protocol";

export interface ConnectedUser {
  userId: string;
  displayName: string;
}

// 이벤트와 "관련된" 사용자 id 집합.
// 1) 이벤트 내재 신호: 담당자(assignee), 구독자(subscriberIds), 부모 이슈 구독자, 프로젝트 멤버(memberIds),
//    프로젝트 리드(leadId), 프로젝트 생성자(creatorId),
//    코멘트가 달린 프로젝트 업데이트의 작성자(projectUpdate.userId).
// 2) 멘션: 본문(title/description/body)에 연결된 사용자의 @displayName 이 있으면 그 사용자.
//    (코멘트 payload엔 구독자 정보가 없어 본문 멘션 파싱이 유일한 신호다.)
export function computeRecipients(event: LinearWebhookEvent, connected: ConnectedUser[]): string[] {
  const d = event.data as any;
  const ids = new Set<string>();
  const add = (x: unknown) => { if (typeof x === "string" && x.length > 0) ids.add(x); };

  add(d.assignee?.id);
  if (Array.isArray(d.subscriberIds)) d.subscriberIds.forEach(add);
  if (Array.isArray(d.memberIds)) d.memberIds.forEach(add);
  add(d.leadId);
  add(d.creatorId);
  // 코멘트가 달린 프로젝트 업데이트의 작성자에게 전달 (내가 올린 업데이트에 달린 코멘트 알림)
  // 리액션(Reaction) 이벤트에서도 projectUpdate.userId = 업데이트 작성자라 그대로 활용된다.
  add(d.projectUpdate?.userId);
  add(d.projectUpdate?.user?.id);
  // 리액션 대상이 코멘트면 그 코멘트 작성자에게 전달 (내 코멘트에 달린 리액션 알림).
  // Reaction payload는 data.comment.userId 에 원 코멘트 작성자를 담는다.
  add(d.comment?.userId);
  add(d.comment?.user?.id);
  if (Array.isArray(d.issue?.subscriberIds)) d.issue.subscriberIds.forEach(add);
  add(d.issue?.assignee?.id);

  const body = [d.title, d.description, d.body].filter(Boolean).join(" ").toLowerCase();
  for (const u of connected) {
    if (u.displayName && body.includes(`@${u.displayName.toLowerCase()}`)) ids.add(u.userId);
  }
  return [...ids];
}
