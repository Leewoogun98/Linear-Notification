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
  // 주의: 서버가 보낸 이벤트가 4개 카테고리(멘션/코멘트/담당/프로젝트업데이트) 중 어디에도
  // 안 걸리면 빈 배열을 반환한다(예: 구독만 하고 담당/멘션 아닌 이슈 변경). 이는 설계상 의도된
  // 동작으로, 그런 이벤트는 알림하지 않는다.
  const text = [d.title, d.description, d.body].filter(Boolean).join(" ").toLowerCase();
  const handle = (me.displayName || me.name || "").toLowerCase();
  const mentioned =
    (handle !== "" && text.includes(`@${handle}`)) ||
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
