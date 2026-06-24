import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } from "electron";
import { join } from "node:path";
import { loadSettings, saveSettings } from "./config-store";
import { evaluateEvent } from "./rule-engine";
import { RelayClient } from "./ws-client";
import { NotificationManager } from "./notification-manager";
import type { Settings } from "../shared/types";

const settingsFile = () => join(app.getPath("userData"), "settings.json");

let tray: Tray | null = null;
let settingsWin: BrowserWindow | null = null;
let settings: Settings;
const notifications = new NotificationManager();
let client: RelayClient;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 680,
    height: 720,
    title: "Linear Noti 설정",
    webPreferences: {
      preload: join(__dirname, "../preload/settings-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(join(__dirname, "../renderer/settings/index.html"));
}

function buildTray() {
  // 빈 이미지로 트레이 생성(아이콘 자산은 추후 교체)
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Linear Noti");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "설정 열기", click: openSettings },
      { type: "separator" },
      { label: "종료", click: () => app.quit() },
    ]),
  );
}

app.whenReady().then(() => {
  settings = loadSettings(settingsFile());

  ipcMain.handle("settings:load", () => settings);
  ipcMain.handle("settings:save", (_e, s: Settings) => {
    settings = s;
    saveSettings(settingsFile(), s);
    client.stop();
    client.start(); // 새 연결 정보로 재연결
  });
  ipcMain.handle("settings:test", () => {
    notifications.show({ title: "테스트 알림", body: "정중앙 알림이 정상 동작합니다." });
  });

  client = new RelayClient(
    () => ({ relayUrl: settings.relayUrl, authToken: settings.authToken }),
    (msg) => {
      const res = evaluateEvent(msg.event, settings.rules, settings.me);
      if (res.matched && res.text) notifications.show(res.text);
    },
  );
  client.start();

  buildTray();
  openSettings(); // 최초 실행 시 설정창 표시
});

// 트레이 상주 앱: 모든 창을 닫아도 종료하지 않음
app.on("window-all-closed", () => { /* intentionally empty — tray app stays alive */ });
