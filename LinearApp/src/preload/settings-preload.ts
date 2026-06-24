import { contextBridge, ipcRenderer } from "electron";
import type { Settings } from "../shared/types";

contextBridge.exposeInMainWorld("settingsApi", {
  load: (): Promise<Settings> => ipcRenderer.invoke("settings:load"),
  save: (s: Settings): Promise<void> => ipcRenderer.invoke("settings:save", s),
  test: (): Promise<void> => ipcRenderer.invoke("settings:test"), // 테스트 알림 한 번 띄우기
});
