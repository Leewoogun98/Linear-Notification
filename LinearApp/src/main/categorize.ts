import type { Identity, Category } from "../shared/types";
import type { LinearWebhookEvent } from "../shared/protocol";

export interface NotificationContent {
  title: string;
  body: string;
  issueUrl?: string;
  identifier?: string;
}

// Project/ProjectUpdate 업데이트에서 "의미 있는" 변경 필드만 사람이 읽을 문구로.
// updatedFrom 에 들어온 키 = 바뀐 필드. sortOrder/updatedAt 등 노이즈는 매핑에 없으므로 무시된다.
const PROJECT_FIELD_LABELS: Record<string, (d: any) => string> = {
  name: (d) => `이름: ${d.name ?? ""}`,
  statusId: (d) => `상태: ${d.status?.name ?? "변경됨"}`,
  health: (d) => `상태(health): ${d.health ?? "변경됨"}`,
  targetDate: (d) => `마감일: ${d.targetDate ?? "없음"}`,
  startDate: (d) => `시작일: ${d.startDate ?? "없음"}`,
  priority: (d) => `우선순위: ${d.priorityLabel ?? d.priority ?? "변경됨"}`,
  description: () => "설명 변경",
  lastUpdateId: () => "새 프로젝트 업데이트 게시됨",
};

export function projectChanges(event: LinearWebhookEvent): string[] {
  const uf = event.updatedFrom;
  if (!uf) return [];
  const d = event.data as any;
  const out: string[] = [];
  for (const key of Object.keys(PROJECT_FIELD_LABELS)) {
    if (key in uf) out.push(PROJECT_FIELD_LABELS[key](d));
  }
  return out;
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
  if (event.type === "ProjectUpdate" || event.type === "Project") {
    // 생성은 항상 알림, 업데이트는 의미 있는 변경이 있을 때만 (정렬/타임스탬프만 바뀐 건 무시)
    if (event.action !== "update" || projectChanges(event).length > 0) cats.push("projectUpdate");
  }
  if (event.type === "Comment" && (event.data as any).projectUpdateId) cats.push("projectUpdate");
  // 리액션: 누군가 내 코멘트/프로젝트 업데이트에 이모지를 "추가"했을 때만(제거는 제외).
  // 수신자 계산은 릴레이(recipients)가 원 글 작성자로 라우팅하므로, 여기 도착했다는 건 내 글이라는 뜻.
  if (event.type === "Reaction" && event.action === "create") cats.push("reaction");
  return cats;
}

const PRIORITY: Category[] = ["mention", "projectUpdate", "reaction"];

// Linear emoji 필드는 ":+1:" 같은 shortcode로 온다. 자주 쓰는 것만 실제 이모지로.
const EMOJI: Record<string, string> = {
  "+1": "👍", "-1": "👎", heart: "❤️", tada: "🎉", eyes: "👀",
  rocket: "🚀", fire: "🔥", joy: "😂", clap: "👏", white_check_mark: "✅",
};
function emojiText(code: unknown): string {
  const c = String(code ?? "").replace(/:/g, "");
  return EMOJI[c] ?? (c ? `:${c}:` : "👍");
}
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
    (typeof d.url === "string" ? d.url : undefined) ??
    (typeof d.issue?.url === "string" ? d.issue.url : undefined) ??
    (typeof d.comment?.issue?.url === "string" ? d.comment.issue.url : undefined) ??
    (typeof d.projectUpdate?.project?.url === "string" ? d.projectUpdate.project.url : undefined);
  if (event.type === "Reaction") {
    const e = emojiText(d.emoji);
    const target = d.comment ? "내 코멘트" : (d.projectUpdate ? "내 프로젝트 업데이트" : "내 게시물");
    const detail = d.comment
      ? String(d.comment.body ?? "")
      : (d.projectUpdate ? (d.projectUpdate.project?.name ?? String(d.projectUpdate.body ?? "")) : "");
    return {
      title: `${actor}님이 ${target}에 ${e} 리액션`,
      body: detail,
      issueUrl,
    };
  }
  if (event.type === "Comment") {
    const onWhat = d.issue?.title
      ? ` on "${d.issue.title}"`
      : (d.projectUpdate ? ` · ${d.projectUpdate.project?.name ?? "프로젝트 업데이트"}` : "");
    return {
      title: `${actor} commented${onWhat}`,
      body: String(d.body ?? ""),
      issueUrl,
      identifier: d.issue?.identifier,
    };
  }
  if (event.type === "Project" || event.type === "ProjectUpdate") {
    const changes = projectChanges(event);
    const verb = event.action === "create" ? "생성됨" : "업데이트";
    return {
      title: `프로젝트 "${d.name ?? ""}" ${verb}`.trim(),
      body: changes.length ? changes.join("\n") : (event.action === "create" ? String(d.description ?? "") : "업데이트됨"),
      issueUrl,
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
