import type { Settings } from "../../shared/types";

declare const settingsApi: {
  load: () => Promise<Settings>;
  save: (s: Settings) => Promise<void>;
  test: () => Promise<void>;
  login: () => Promise<{ ok: boolean; name?: string; error?: string }>;
  authStatus: () => Promise<{ loggedIn: boolean; name: string }>;
};

const $ = (id: string) =>
  document.getElementById(id) as HTMLInputElement & HTMLTextAreaElement & HTMLElement;

async function refreshAuth() {
  const st = await settingsApi.authStatus();
  $("authStatus").textContent = st.loggedIn ? `로그인됨: ${st.name}` : "로그인 안 됨";
}

async function init() {
  await refreshAuth();
}

$("login").addEventListener("click", async () => {
  $("authStatus").textContent = "브라우저에서 로그인 진행 중…";
  const r = await settingsApi.login();
  if (r.ok) {
    $("authStatus").textContent = "로그인됨 (이름 불러오는 중…)";
    setTimeout(refreshAuth, 3000); // hello가 도착해 me가 채워지면 실제 이름 표시
  } else {
    $("authStatus").textContent = "로그인 실패: " + (r.error ?? "");
  }
});

$("test").addEventListener("click", () => settingsApi.test());

init();
