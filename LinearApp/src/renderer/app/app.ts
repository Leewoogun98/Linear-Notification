type Category = "mention" | "projectUpdate" | "reaction";
interface StoredNotification {
  id: string;
  category: Category;
  title: string;
  body: string;
  issueUrl?: string;
  identifier?: string;
  receivedAt: number;
  read: boolean;
}

declare const api: {
  auth: {
    status: () => Promise<{ loggedIn: boolean; name: string }>;
    login: () => Promise<{ ok: boolean; name?: string; error?: string }>;
    logout: () => Promise<void>;
    onChanged: (cb: (s: { loggedIn: boolean; name: string }) => void) => void;
  };
  notifications: {
    list: () => Promise<StoredNotification[]>;
    unread: () => Promise<number>;
    markRead: (id: string) => Promise<void>;
    clearAll: () => Promise<void>;
    onUpdate: (cb: () => void) => void;
  };
  settings: { getCategories: () => Promise<Category[]>; setCategories: (c: Category[]) => Promise<void>; getMuteOwn: () => Promise<boolean>; setMuteOwn: (v: boolean) => Promise<void>; getPosition: () => Promise<string>; setPosition: (p: string) => Promise<void> };
  openIssue: (url: string) => Promise<void>;
  test: () => Promise<void>;
  appVersion: () => Promise<string>;
};

const $ = (id: string) => document.getElementById(id)!;
const views = { login: $("view-login"), home: $("view-home"), settings: $("view-settings") };
function show(v: keyof typeof views) {
  for (const k of Object.keys(views) as (keyof typeof views)[]) (views[k] as HTMLElement).hidden = k !== v;
}

const CAT_META: Record<Category, { icon: string; label: string; tagBg: string; iconColor: string }> = {
  mention: { icon: "@", label: "나를 멘션", tagBg: "#3a3170", iconColor: "#b9a7ff" },
  projectUpdate: { icon: "▤", label: "프로젝트 업데이트", tagBg: "#143a30", iconColor: "#7fe0c0" },
  reaction: { icon: "♥", label: "내 글에 리액션", tagBg: "#4a3a14", iconColor: "#ffcc66" },
};
const ALL: Category[] = ["mention", "projectUpdate", "reaction"];
const CAT_SHORT: Record<Category, string> = { mention: "멘션", projectUpdate: "프로젝트", reaction: "리액션" };

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

let homeFilter: Category | "all" = "all";

async function renderHome() {
  const items = await api.notifications.list();
  const unread = await api.notifications.unread();
  const pill = $("unreadPill");
  if (unread > 0) { pill.textContent = `${unread} 안읽음`; pill.hidden = false; } else { pill.hidden = true; }

  // 카테고리별 개수
  const counts: Record<string, number> = { all: items.length, mention: 0, projectUpdate: 0, reaction: 0 };
  for (const n of items) counts[n.category] = (counts[n.category] ?? 0) + 1;

  // 상단 필터 칩 (전체 + 3 카테고리)
  const chipDefs: { key: Category | "all"; icon: string; label: string; color: string }[] = [
    { key: "all", icon: "전체", label: "전체", color: "var(--accent)" },
    ...ALL.map((c) => ({ key: c, icon: CAT_SHORT[c], label: CAT_META[c].label, color: CAT_META[c].iconColor })),
  ];
  const filters = $("filters");
  filters.innerHTML = "";
  for (const c of chipDefs) {
    const active = homeFilter === c.key;
    const chip = document.createElement("button");
    chip.className = "chip" + (active ? " active" : "");
    chip.title = c.label;
    if (active) { chip.style.color = c.color; chip.style.borderColor = c.color; }
    chip.innerHTML = `<span class="ci">${c.icon}</span><span class="cnt">${counts[c.key] ?? 0}</span>`;
    chip.addEventListener("click", () => { homeFilter = c.key; renderHome(); });
    filters.appendChild(chip);
  }

  const shown = homeFilter === "all" ? items : items.filter((n) => n.category === homeFilter);
  const emptyEl = $("empty") as HTMLElement;
  emptyEl.hidden = shown.length > 0;
  emptyEl.textContent = items.length === 0 ? "아직 받은 알림이 없어요" : "이 분류에 알림이 없어요";
  const list = $("list");
  list.innerHTML = "";
  for (const n of shown) {
    const m = CAT_META[n.category as Category] ?? CAT_META.mention;
    const card = document.createElement("div");
    card.className = "ncard" + (n.read ? "" : " unread");
    card.innerHTML =
      `<div class="tag" style="background:${m.tagBg};color:${m.iconColor}">${m.icon}</div>` +
      `<div class="body"><div class="h"></div><div class="sub"></div>` +
      `<div class="meta">${n.identifier ? n.identifier + " · " : ""}${relTime(n.receivedAt)}</div></div>` +
      (n.read ? "" : `<div class="udot"></div>`);
    (card.querySelector(".h") as HTMLElement).textContent = n.title;
    (card.querySelector(".sub") as HTMLElement).textContent = n.body;
    card.addEventListener("click", async () => {
      await api.notifications.markRead(n.id);
      if (n.issueUrl) await api.openIssue(n.issueUrl);
      renderHome();
    });
    list.appendChild(card);
  }
}

async function renderSettings() {
  const st = await api.auth.status();
  ($("acctName") as HTMLElement).textContent = st.name || "(이름 불러오는 중)";
  ($("acctHandle") as HTMLElement).textContent = st.name;
  ($("avatar") as HTMLElement).textContent = (st.name || "?").slice(0, 1);
  const enabled = await api.settings.getCategories();
  const cats = $("cats");
  cats.innerHTML = "";
  for (const c of ALL) {
    const on = enabled.includes(c);
    const row = document.createElement("div");
    row.className = "cat " + (on ? "on" : "off");
    row.innerHTML = `<div class="chk">${on ? "✓" : ""}</div><div class="lbl">${CAT_META[c].label}</div>`;
    row.addEventListener("click", async () => {
      const cur = await api.settings.getCategories();
      const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
      await api.settings.setCategories(next);
      renderSettings();
    });
    cats.appendChild(row);
  }

  ($("verLabel") as HTMLElement).textContent = `버전 ${await api.appVersion()}`;

  const mute = await api.settings.getMuteOwn();
  const muteRow = $("muteRow");
  muteRow.className = "cat " + (mute ? "on" : "off");
  (muteRow.querySelector(".chk") as HTMLElement).textContent = mute ? "✓" : "";
  muteRow.onclick = async () => { await api.settings.setMuteOwn(!mute); renderSettings(); };

  const LABELS: Record<string, string> = {
    "center": "정중앙", "top-right": "우측 상단", "top-left": "좌측 상단",
    "bottom-right": "우측 하단", "bottom-left": "좌측 하단",
  };
  const curPos = await api.settings.getPosition();
  ($("posLabel") as HTMLElement).textContent = LABELS[curPos] ?? curPos;
  $("posPicker").querySelectorAll<HTMLElement>(".slot").forEach((el) => {
    const p = el.dataset.pos as string;
    el.classList.toggle("on", p === curPos);
    el.onclick = async () => {
      await api.settings.setPosition(p);
      await api.test();
      renderSettings();
    };
  });
}

$("loginBtn").addEventListener("click", async () => {
  ($("loginBtn") as HTMLButtonElement).textContent = "브라우저에서 로그인 중…";
  const hint = document.querySelector("#view-login .login-hint") as HTMLElement | null;
  try {
    const r = await api.auth.login();
    ($("loginBtn") as HTMLButtonElement).textContent = "Linear로 로그인";
    if (r.ok) { show("home"); renderHome(); }
    else if (hint) { hint.textContent = "로그인 실패: " + (r.error ?? "알 수 없는 오류"); hint.style.color = "#ff9eb5"; }
  } catch (e) {
    ($("loginBtn") as HTMLButtonElement).textContent = "Linear로 로그인";
    if (hint) { hint.textContent = "오류(api 미연결?): " + (e as Error).message; hint.style.color = "#ff9eb5"; }
  }
});
$("gearBtn").addEventListener("click", () => { show("settings"); renderSettings(); });
$("backBtn").addEventListener("click", () => { show("home"); renderHome(); });
$("clearAll").addEventListener("click", () => { api.notifications.clearAll(); });
$("logoutBtn").addEventListener("click", async () => { await api.auth.logout(); show("login"); });
$("testBtn").addEventListener("click", () => api.test());

api.notifications.onUpdate(() => { if (!(views.home as HTMLElement).hidden) renderHome(); });
api.auth.onChanged((s) => {
  if (s.loggedIn) {
    if ((views.login as HTMLElement).hidden === false) { show("home"); renderHome(); }
  } else {
    show("login");
  }
});

(async function init() {
  const st = await api.auth.status();
  if (st.loggedIn) { show("home"); renderHome(); } else { show("login"); }
})();
