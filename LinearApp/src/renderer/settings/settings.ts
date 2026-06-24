import type { Settings } from "../../shared/types";

declare const settingsApi: {
  load: () => Promise<Settings>;
  save: (s: Settings) => Promise<void>;
  test: () => Promise<void>;
};

const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLTextAreaElement;

async function init() {
  const s = await settingsApi.load();
  $("relayUrl").value = s.relayUrl;
  $("authToken").value = s.authToken;
  $("meId").value = s.me.id;
  $("meName").value = s.me.name;
  $("rules").value = JSON.stringify(s.rules, null, 2);
}

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
  const s: Settings = {
    relayUrl: $("relayUrl").value.trim(),
    authToken: $("authToken").value.trim(),
    me: { id: $("meId").value.trim(), name: $("meName").value.trim() },
    rules,
  };
  await settingsApi.save(s);
  $("error").textContent = "저장됨 ✓";
});

$("test").addEventListener("click", () => settingsApi.test());

init();
