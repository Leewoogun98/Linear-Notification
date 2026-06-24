type Category = "mention" | "projectUpdate";
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
  settings: { getCategories: () => Promise<Category[]>; setCategories: (c: Category[]) => Promise<void> };
  openIssue: (url: string) => Promise<void>;
  test: () => Promise<void>;
};

const $ = (id: string) => document.getElementById(id)!;
const views = { login: $("view-login"), home: $("view-home"), settings: $("view-settings") };
function show(v: keyof typeof views) {
  for (const k of Object.keys(views) as (keyof typeof views)[]) (views[k] as HTMLElement).hidden = k !== v;
}

const CAT_META: Record<Category, { icon: string; label: string; tagBg: string; iconColor: string }> = {
  mention: { icon: "@", label: "나를 멘션", tagBg: "#3a3170", iconColor: "#b9a7ff" },
  projectUpdate: { icon: "▤", label: "프로젝트 업데이트", tagBg: "#143a30", iconColor: "#7fe0c0" },
};
const ALL: Category[] = ["mention", "projectUpdate"];

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

async function renderHome() {
  const items = await api.notifications.list();
  const unread = await api.notifications.unread();
  const pill = $("unreadPill");
  if (unread > 0) { pill.textContent = `${unread} 안읽음`; pill.hidden = false; } else { pill.hidden = true; }
  ($("empty") as HTMLElement).hidden = items.length > 0;
  const list = $("list");
  list.innerHTML = "";
  for (const n of items) {
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
