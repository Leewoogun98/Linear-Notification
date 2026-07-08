import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, powerMonitor, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { join } from "node:path";
import { loadSettings, saveSettings } from "./config-store";
import { categorize, representativeCategory, formatNotification, shouldNotify } from "./categorize";
import { NotificationStore } from "./notification-store";
import { RelayClient } from "./ws-client";
import { NotificationManager } from "./notification-manager";
import { login } from "./auth-client";
import type { Settings, Category, PopupPosition } from "../shared/types";

app.setName("Linear Noti");

const settingsFile = () => join(app.getPath("userData"), "settings.json");
const notiFile = () => join(app.getPath("userData"), "notifications.json");

const ACCENT: Record<Category, string> = {
  mention: "#b9a7ff", projectUpdate: "#7fe0c0", reaction: "#ffcc66",
};

const HEADING: Record<Category, string> = {
  mention: "멘션이용^^",
  projectUpdate: "프로젝트용^^",
  reaction: "리액션이용^^",
};

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let settings: Settings;
let store: NotificationStore;
const notifications = new NotificationManager();
let client: RelayClient;

function openWindow() {
  if (win && !win.isDestroyed()) { win.focus(); return; }
  win = new BrowserWindow({
    width: 380, height: 620, title: "Linear Noti",
    webPreferences: {
      preload: join(__dirname, "../preload/app-preload.js"),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "../renderer/app/index.html"));
  // 새 창에는 작업표시줄 오버레이를 다시 적용해야 한다(오버레이는 창 단위).
  updateBadge();
}

// 빌드 때 생성한 안읽음 배지 PNG(dist/badges/)를 캐시해서 로드.
const badgeDir = join(__dirname, "../badges");
const imgCache = new Map<string, ReturnType<typeof nativeImage.createFromPath>>();
function badgeImg(file: string) {
  let img = imgCache.get(file);
  if (!img) { img = nativeImage.createFromPath(join(badgeDir, file)); imgCache.set(file, img); }
  return img;
}
const trayKey = (n: number) => (n <= 0 ? "tray-base" : n <= 9 ? `tray-${n}` : "tray-9plus");
const overlayKey = (n: number) => (n <= 9 ? `overlay-${n}` : "overlay-9plus");

function updateBadge() {
  const n = store.unreadCount();
  if (process.platform === "darwin") {
    // macOS: dock 아이콘 텍스트 배지
    if (app.dock) app.dock.setBadge(n > 0 ? String(n) : "");
  } else if (process.platform === "win32") {
    // Windows: 트레이 아이콘에 숫자를 구워넣고(항상 보임), 창이 있으면 작업표시줄 오버레이도 표시
    if (tray) tray.setImage(badgeImg(`${trayKey(n)}.png`));
    if (win && !win.isDestroyed()) {
      win.setOverlayIcon(n > 0 ? badgeImg(`${overlayKey(n)}.png`) : null, n > 0 ? `안읽음 ${n}개` : "");
    }
  }
  if (tray) tray.setToolTip(n > 0 ? `Linear Noti — 안읽음 ${n}` : "Linear Noti");
}

function pushNotiUpdate() {
  if (win && !win.isDestroyed()) win.webContents.send("noti:updated");
  updateBadge();
}

// 앱을 켤 때 한 번 GitHub Release에서 새 버전을 확인하고, 받아지면 알림을 띄운 뒤
// 다음 종료 시 자동 적용한다. 현재는 Windows 전용 — 맥은 ad-hoc 서명이라
// Squirrel.Mac이 업데이트 적용을 거부하므로 정식 코드 서명을 갖추기 전까지 제외한다.
function initAutoUpdate() {
  if (!app.isPackaged || process.platform !== "win32") return;
  autoUpdater.on("error", (err) => console.error("[autoUpdater]", err));

  // 다운로드 완료 시 앱 실행 중에 다이얼로그를 띄운다("지금 재시작 / 나중에").
  // 버전별로 1회만 물어본다(더 새 버전이 오면 다시 물어봄). "나중에"는 다음 완전 종료 시 자동 적용.
  let promptedVersion: string | null = null;
  autoUpdater.on("update-downloaded", (info) => {
    if (promptedVersion === info.version) return;
    promptedVersion = info.version;
    dialog.showMessageBox({
      type: "info",
      buttons: ["지금 재시작", "나중에"],
      defaultId: 0,
      cancelId: 1,
      title: "업데이트 준비 완료",
      message: `새 버전 ${info.version} 이(가) 준비됐어요.`,
      detail: "지금 재시작하면 바로 적용됩니다. '나중에'를 누르면 앱을 완전히 종료할 때 적용돼요.",
    }).then((r) => {
      if (r.response === 0) autoUpdater.quitAndInstall();
    }).catch((err) => console.error("[autoUpdater]", err));
  });

  // 켤 때 1회 + 이후 4시간마다 확인 (재시작 없이도 새 버전을 감지).
  const check = () => autoUpdater.checkForUpdates().catch((err) => console.error("[autoUpdater]", err));
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

function buildTray() {
  // Windows는 실제 트레이 아이콘이 필요하다(이후 updateBadge가 안읽음 수에 따라 교체).
  const initial = process.platform === "win32" ? badgeImg("tray-base.png") : nativeImage.createEmpty();
  tray = new Tray(initial);
  tray.setToolTip("Linear Noti");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "열기", click: openWindow },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]));
  tray.on("click", openWindow);
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock && !app.isPackaged) {
    try { app.dock.setIcon(join(__dirname, "../../build/icon.png")); } catch { /* dev 전용 */ }
  }
  settings = loadSettings(settingsFile());
  notifications.setPosition(settings.popupPosition);
  store = new NotificationStore(notiFile());

  ipcMain.handle("auth:status", () => ({ loggedIn: !!settings.sessionToken, name: settings.me.name }));
  ipcMain.handle("auth:login", async () => {
    try {
      const token = await login(settings.relayUrl, (url) => shell.openExternal(url));
      settings = { ...settings, sessionToken: token };
      saveSettings(settingsFile(), settings);
      client.stop(); client.start();
      return { ok: true, name: settings.me.name };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle("auth:logout", () => {
    settings = { ...settings, sessionToken: "", me: { id: "", name: "", displayName: "" } };
    saveSettings(settingsFile(), settings);
    client.stop();
  });

  ipcMain.handle("noti:list", () => store.list());
  ipcMain.handle("noti:unread", () => store.unreadCount());
  ipcMain.handle("noti:markRead", (_e, id: string) => { store.markRead(id); updateBadge(); });
  ipcMain.handle("noti:markAllRead", () => { store.markAllRead(); pushNotiUpdate(); });
  ipcMain.handle("noti:clearAll", () => { store.clearAll(); pushNotiUpdate(); });

  ipcMain.handle("cat:get", () => settings.enabledCategories);
  ipcMain.handle("cat:set", (_e, c: Category[]) => {
    settings = { ...settings, enabledCategories: c };
    saveSettings(settingsFile(), settings);
  });

  ipcMain.handle("mute:get", () => settings.muteOwnChanges);
  ipcMain.handle("mute:set", (_e, v: boolean) => {
    settings = { ...settings, muteOwnChanges: !!v };
    saveSettings(settingsFile(), settings);
  });

  ipcMain.handle("pos:get", () => settings.popupPosition);
  ipcMain.handle("pos:set", (_e, p: PopupPosition) => {
    settings = { ...settings, popupPosition: p };
    saveSettings(settingsFile(), settings);
    notifications.setPosition(p);
  });

  ipcMain.handle("issue:open", async (_e, url: string) => {
    if (!url || typeof url !== "string") return;
    if (url.startsWith("https://linear.app/")) {
      const deep = url.replace("https://linear.app/", "linear://");
      try { await shell.openExternal(deep); return; } catch { /* 앱 없음 → 브라우저 폴백 */ }
    }
    await shell.openExternal(url);
  });
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("settings:test", () => {
    notifications.show({ heading: "테스트^^", title: "테스트 알림", body: "정중앙 알림이 정상 동작합니다. 본문 글씨가 이만큼 커졌어요!", accent: ACCENT.mention });
  });

  client = new RelayClient(
    () => ({ relayUrl: settings.relayUrl, sessionToken: settings.sessionToken }),
    (msg) => {
      if (settings.muteOwnChanges && msg.event.actor?.id && msg.event.actor.id === settings.me.id) {
        return;
      }
      const cats = categorize(msg.event, settings.me);
      if (!shouldNotify(cats, settings.enabledCategories)) return;
      const rep = representativeCategory(cats);
      if (!rep) return;
      const c = formatNotification(msg.event);
      store.add({ category: rep, title: c.title, body: c.body, issueUrl: c.issueUrl, identifier: c.identifier, receivedAt: msg.receivedAt });
      notifications.show({ heading: HEADING[rep], title: c.title, body: c.body, accent: ACCENT[rep] });
      pushNotiUpdate();
    },
    (you) => {
      settings = { ...settings, me: { id: you.id, name: you.name, displayName: you.displayName } };
      saveSettings(settingsFile(), settings);
      if (win && !win.isDestroyed()) win.webContents.send("auth:changed", { loggedIn: true, name: you.name });
    },
    () => {
      settings = { ...settings, sessionToken: "" };
      saveSettings(settingsFile(), settings);
      if (win && !win.isDestroyed()) win.webContents.send("auth:changed", { loggedIn: false, name: "" });
      openWindow();
    },
  );
  client.start();

  // 절전에서 깨어나거나 화면 잠금을 풀면 즉시 재연결한다(좀비 소켓 방지).
  // 하트비트(ws-client)가 안전망이고, 이건 더 빠른 트리거다. 맥·윈도우 공통 동작.
  powerMonitor.on("resume", () => client.reconnect());
  powerMonitor.on("unlock-screen", () => client.reconnect());

  buildTray();
  updateBadge();
  openWindow();
  initAutoUpdate();
});

app.on("window-all-closed", () => { /* 트레이 상주 */ });

// macOS: 창을 닫아도 앱은 살아있고, dock 아이콘을 다시 누르면 창을 다시 연다.
app.on("activate", () => openWindow());
