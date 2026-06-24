import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("notiApi", {
  onContent: (cb: (data: { title: string; body: string; accent?: string }) => void) =>
    ipcRenderer.on("noti:content", (_e, data) => cb(data)),
  dismiss: () => ipcRenderer.send("noti:dismiss"),
});
