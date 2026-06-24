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
  const text = [d.title, d.description, d.body].filter(Boolean).join(" ").toLowerCase();
  const mentioned =
    (me.name !== "" && text.includes(`@${me.name.toLowerCase()}`)) ||
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
