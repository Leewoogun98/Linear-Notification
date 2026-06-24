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
  const s = await settingsApi.load();
  $("rules").value = JSON.stringify(s.rules, null, 2);
  await refreshAuth();
}

$("login").addEventListener("click", async () => {
  $("authStatus").textContent = "브라우저에서 로그인 진행 중…";
  const r = await settingsApi.login();
  $("authStatus").textContent = r.ok ? `로그인됨: ${r.name}` : "로그인 실패: " + (r.error ?? "");
});

$("save").addEventListener("click", async () => {
  $("error").textContent = "";
  let rules;
  try {
    rules = JSON.parse($("rules").value || "[]");
    if (!Array.isArray(rules)) throw new Error("규칙은 배열이어야 합니다");
  } catch (e: any) {
    $("error").textContent = "규칙 JSON 오류: " + e.message;
    return;
  }
  const cur = await settingsApi.load();
  await settingsApi.save({ ...cur, rules });
  $("error").textContent = "저장됨 ✓";
});

$("test").addEventListener("click", () => settingsApi.test());

init();
