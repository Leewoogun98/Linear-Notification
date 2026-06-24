import { contextBridge, ipcRenderer } from "electron";
import type { Settings } from "../shared/types";

contextBridge.exposeInMainWorld("settingsApi", {
  load: (): Promise<Settings> => ipcRenderer.invoke("settings:load"),
  save: (s: Settings): Promise<void> => ipcRenderer.invoke("settings:save", s),
  test: (): Promise<void> => ipcRenderer.invoke("settings:test"),
  login: (): Promise<{ ok: boolean; name?: string; error?: string }> => ipcRenderer.invoke("auth:login"),
  authStatus: (): Promise<{ loggedIn: boolean; name: string }> => ipcRenderer.invoke("auth:status"),
});
