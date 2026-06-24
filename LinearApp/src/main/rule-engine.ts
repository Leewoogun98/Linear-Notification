import type { Rule, Identity, FilterCondition } from "../shared/types";
import type { LinearWebhookEvent } from "../shared/protocol";

export interface NotificationText {
  title: string;
  body: string;
}

export interface EvalResult {
  matched: boolean;
  rule?: Rule;
  text?: NotificationText;
}

function labelNames(event: LinearWebhookEvent): string[] {
  const labels = event.data.labels;
  if (Array.isArray(labels)) return labels.map((l: any) => String(l?.name ?? "").toLowerCase());
  return [];
}

function bodyText(event: LinearWebhookEvent): string {
  const d = event.data;
  return [d.title, d.description, d.body].filter(Boolean).join(" ").toLowerCase();
}

function matchFilter(f: FilterCondition, event: LinearWebhookEvent, me: Identity): boolean {
  const d = event.data;
  const v = (f.value ?? "").toLowerCase();
  switch (f.kind) {
    case "team":
      return v !== "" && [d.team?.key, d.team?.name].some((x) => String(x ?? "").toLowerCase() === v);
    case "project":
      return v !== "" && String(d.project?.name ?? "").toLowerCase() === v;
    case "label":
      return labelNames(event).includes(v);
    case "assignee":
      // value는 의도적으로 무시 — "assignee"는 항상 '나'를 의미
      return String(d.assignee?.id ?? "") === me.id && me.id !== "";
    case "mentionsMe": {
      const text = bodyText(event);
      return (
        (me.name !== "" && text.includes(`@${me.name.toLowerCase()}`)) ||
        (me.id !== "" && text.includes(me.id.toLowerCase()))
      );
    }
    case "keyword":
      return v !== "" && bodyText(event).includes(v);
    default:
      return false;
  }
}

function buildText(event: LinearWebhookEvent): NotificationText {
  const d = event.data;
  const actor = event.actor?.name ?? d.user?.name ?? "Someone";
  if (event.type === "Comment") {
    const issueTitle = d.issue?.title ? ` on "${d.issue.title}"` : "";
    return { title: `${actor} commented${issueTitle}`, body: String(d.body ?? "") };
  }
  // 기본: Issue/Project 등
  const ident = d.identifier ? `${d.identifier} ` : "";
  const verb = event.action === "create" ? "created" : event.action === "remove" ? "removed" : "updated";
  return {
    title: `${actor} ${verb} ${event.type} ${ident}`.trim(),
    body: [d.title, d.name, d.description].filter(Boolean).join("\n"),
  };
}

export function evaluateEvent(event: LinearWebhookEvent, rules: Rule[], me: Identity): EvalResult {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.eventTypes.length > 0 && !rule.eventTypes.includes(event.type)) continue;
    if (rule.actions.length > 0 && !rule.actions.includes(event.action)) continue;
    if (rule.filters.every((f) => matchFilter(f, event, me))) {
      return { matched: true, rule, text: buildText(event) };
    }
  }
  return { matched: false };
}
