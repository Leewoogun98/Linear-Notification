import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } from "electron";
import { join } from "node:path";
import { loadSettings, saveSettings } from "./config-store";
import { categorize, representativeCategory, formatNotification, shouldNotify } from "./categorize";
import { NotificationStore } from "./notification-store";
import { RelayClient } from "./ws-client";
import { NotificationManager } from "./notification-manager";
import { login } from "./auth-client";
import type { Settings, Category } from "../shared/types";

const settingsFile = () => join(app.getPath("userData"), "settings.json");
const notiFile = () => join(app.getPath("userData"), "notifications.json");

const ACCENT: Record<Category, string> = {
  mention: "#b9a7ff", comment: "#7fc8e0", assigned: "#f0c674", projectUpdate: "#7fe0c0",
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
}

function updateBadge() {
  const n = store.unreadCount();
  if (app.dock) app.dock.setBadge(n > 0 ? String(n) : "");
  if (tray) tray.setToolTip(n > 0 ? `Linear Noti — 안읽음 ${n}` : "Linear Noti");
}

function pushNotiUpdate() {
  if (win && !win.isDestroyed()) win.webContents.send("noti:updated");
  updateBadge();
}

function buildTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Linear Noti");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "열기", click: openWindow },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]));
  tray.on("click", openWindow);
}

app.whenReady().then(() => {
  settings = loadSettings(settingsFile());
  store = new NotificationStore(notiFile());

  ipcMain.handle("auth:status", () => ({ loggedIn: !!settings.sessionToken, name: settings.me.name }));
  ipcMain.handle("auth:login", async () => {
    try {
      const token = await login(settings.relayUrl, (url) => shell.openExternal(url));
      settings = { ...settings, sessionToken: token };
      saveSettings(settingsFile(), settings);
      client.stop(); client.start();
      return { ok: true, name: settings.me.name };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle("auth:logout", () => {
    settings = { ...settings, sessionToken: "", me: { id: "", name: "" } };
    saveSettings(settingsFile(), settings);
    client.stop();
  });

  ipcMain.handle("noti:list", () => store.list());
  ipcMain.handle("noti:unread", () => store.unreadCount());
  ipcMain.handle("noti:markRead", (_e, id: string) => { store.markRead(id); updateBadge(); });
  ipcMain.handle("noti:clearAll", () => { store.clearAll(); pushNotiUpdate(); });

  ipcMain.handle("cat:get", () => settings.enabledCategories);
  ipcMain.handle("cat:set", (_e, c: Category[]) => {
    settings = { ...settings, enabledCategories: c };
    saveSettings(settingsFile(), settings);
  });

  ipcMain.handle("issue:open", (_e, url: string) => { if (url) shell.openExternal(url); });
  ipcMain.handle("settings:test", () => {
    notifications.show({ title: "테스트 알림", body: "정중앙 알림이 정상 동작합니다.", accent: ACCENT.mention });
  });

  client = new RelayClient(
    () => ({ relayUrl: settings.relayUrl, sessionToken: settings.sessionToken }),
    (msg) => {
      const cats = categorize(msg.event, settings.me);
      if (!shouldNotify(cats, settings.enabledCategories)) return;
      const rep = representativeCategory(cats)!;
      const c = formatNotification(msg.event);
      store.add({ category: rep, title: c.title, body: c.body, issueUrl: c.issueUrl, identifier: c.identifier, receivedAt: msg.receivedAt });
      notifications.show({ title: c.title, body: c.body, accent: ACCENT[rep] });
      pushNotiUpdate();
    },
    (you) => {
      settings = { ...settings, me: { id: you.id, name: you.name } };
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

  buildTray();
  updateBadge();
  openWindow();
});

app.on("window-all-closed", () => { /* 트레이 상주 */ });
