import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } from "electron";
import { join } from "node:path";
import { loadSettings, saveSettings } from "./config-store";
import { evaluateEvent } from "./rule-engine";
import { RelayClient } from "./ws-client";
import { NotificationManager } from "./notification-manager";
import { login } from "./auth-client";
import type { Settings } from "../shared/types";

const settingsFile = () => join(app.getPath("userData"), "settings.json");

let tray: Tray | null = null;
let settingsWin: BrowserWindow | null = null;
let settings: Settings;
const notifications = new NotificationManager();
let client: RelayClient;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 680, height: 640, title: "Linear Noti 설정",
    webPreferences: {
      preload: join(__dirname, "../preload/settings-preload.js"),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  settingsWin.loadFile(join(__dirname, "../renderer/settings/index.html"));
}

function buildTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Linear Noti");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "설정 열기", click: openSettings },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  settings = loadSettings(settingsFile());

  ipcMain.handle("settings:load", () => settings);
  ipcMain.handle("settings:save", (_e, s: Settings) => {
    settings = s; saveSettings(settingsFile(), s);
    client.stop(); client.start();
  });
  ipcMain.handle("settings:test", () => {
    notifications.show({ title: "테스트 알림", body: "정중앙 알림이 정상 동작합니다." });
  });
  ipcMain.handle("auth:status", () => ({ loggedIn: !!settings.sessionToken, name: settings.me.name }));
  ipcMain.handle("auth:login", async () => {
    try {
      const token = await login(settings.relayUrl, (url) => shell.openExternal(url));
      settings = { ...settings, sessionToken: token };
      saveSettings(settingsFile(), settings);
      client.stop(); client.start(); // 새 세션으로 재연결 → hello가 me를 채움
      return { ok: true, name: settings.me.name };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  client = new RelayClient(
    () => ({ relayUrl: settings.relayUrl, sessionToken: settings.sessionToken }),
    (msg) => {
      const res = evaluateEvent(msg.event, settings.rules, settings.me);
      if (res.matched && res.text) notifications.show(res.text);
    },
    (you) => {
      settings = { ...settings, me: { id: you.id, name: you.name } };
      saveSettings(settingsFile(), settings);
    },
    () => {
      settings = { ...settings, sessionToken: "" };
      saveSettings(settingsFile(), settings);
      openSettings();
    },
  );
  client.start();

  buildTray();
  openSettings();
});

app.on("window-all-closed", () => { /* 트레이 상주 */ });
