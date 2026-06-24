import { BrowserWindow, screen, shell } from "electron";
import { join } from "node:path";
import type { PopupPosition } from "../shared/types";

export interface PopupContent {
  heading?: string;
  title: string;
  body: string;
  accent?: string;
}

const WIDTH = 380;
const HEIGHT = 150;
const GAP = 10;
const AUTO_MS = 5000;

export class NotificationManager {
  private windows: BrowserWindow[] = [];
  private position: PopupPosition = "center";
  setPosition(p: PopupPosition) {
    this.position = p;
    this.relayout();
  }

  show(text: PopupContent) {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, "../preload/notification-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.loadFile(join(__dirname, "../renderer/notification/index.html"));

    win.webContents.once("did-finish-load", () => {
      win.webContents.send("noti:content", text);
      win.showInactive();
      shell.beep(); // 소리
    });

    const dismiss = () => this.close(win);
    win.webContents.ipc.on("noti:dismiss", dismiss);
    const timer = setTimeout(dismiss, AUTO_MS);
    win.on("closed", () => clearTimeout(timer));

    this.windows.push(win);
    this.relayout();
  }

  private close(win: BrowserWindow) {
    const i = this.windows.indexOf(win);
    if (i >= 0) this.windows.splice(i, 1);
    if (!win.isDestroyed()) win.close();
    this.relayout();
  }

  private relayout() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const M = 16;
    const pos = this.position;
    const x =
      pos === "center" ? Math.round(width / 2 - WIDTH / 2)
      : pos.includes("left") ? M
      : width - WIDTH - M;

    if (pos === "center") {
      const totalH = this.windows.length * HEIGHT + (this.windows.length - 1) * GAP;
      let y = Math.round(height / 2 - totalH / 2);
      for (const win of this.windows) {
        if (!win.isDestroyed()) win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
        y += HEIGHT + GAP;
      }
    } else if (pos.startsWith("top")) {
      let y = M;
      for (const win of this.windows) {
        if (!win.isDestroyed()) win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
        y += HEIGHT + GAP;
      }
    } else {
      let y = height - HEIGHT - M;
      for (const win of this.windows) {
        if (!win.isDestroyed()) win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
        y -= HEIGHT + GAP;
      }
    }
  }
}
