import { contextBridge, ipcRenderer } from "electron";
import type { StoredNotification, Category } from "../shared/types";

contextBridge.exposeInMainWorld("api", {
  auth: {
    status: (): Promise<{ loggedIn: boolean; name: string }> => ipcRenderer.invoke("auth:status"),
    login: (): Promise<{ ok: boolean; name?: string; error?: string }> => ipcRenderer.invoke("auth:login"),
    logout: (): Promise<void> => ipcRenderer.invoke("auth:logout"),
    onChanged: (cb: (s: { loggedIn: boolean; name: string }) => void) =>
      ipcRenderer.on("auth:changed", (_e, s) => cb(s)),
  },
  notifications: {
    list: (): Promise<StoredNotification[]> => ipcRenderer.invoke("noti:list"),
    unread: (): Promise<number> => ipcRenderer.invoke("noti:unread"),
    markRead: (id: string): Promise<void> => ipcRenderer.invoke("noti:markRead", id),
    clearAll: (): Promise<void> => ipcRenderer.invoke("noti:clearAll"),
    onUpdate: (cb: () => void) => ipcRenderer.on("noti:updated", () => cb()),
  },
  settings: {
    getCategories: (): Promise<Category[]> => ipcRenderer.invoke("cat:get"),
    setCategories: (c: Category[]): Promise<void> => ipcRenderer.invoke("cat:set", c),
  },
  openIssue: (url: string): Promise<void> => ipcRenderer.invoke("issue:open", url),
  test: (): Promise<void> => ipcRenderer.invoke("settings:test"),
});
