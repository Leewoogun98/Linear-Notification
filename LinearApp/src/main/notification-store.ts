import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { StoredNotification, Category } from "../shared/types";

const CAP = 100;

export interface NewNotification {
  category: Category;
  title: string;
  body: string;
  issueUrl?: string;
  identifier?: string;
  receivedAt: number;
}

export class NotificationStore {
  private items: StoredNotification[] = [];
  constructor(private file: string) {
    this.load();
  }

  private load() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      this.items = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.items = [];
    }
  }

  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.items, null, 2), "utf8");
  }

  add(n: NewNotification): StoredNotification {
    const item: StoredNotification = { id: randomUUID(), read: false, ...n };
    this.items.unshift(item);
    if (this.items.length > CAP) this.items = this.items.slice(0, CAP);
    this.persist();
    return item;
  }

  list(): StoredNotification[] {
    return this.items;
  }

  markRead(id: string): void {
    const it = this.items.find((x) => x.id === id);
    if (it && !it.read) {
      it.read = true;
      this.persist();
    }
  }

  clearAll(): void {
    this.items = [];
    this.persist();
  }

  unreadCount(): number {
    return this.items.filter((x) => !x.read).length;
  }
}
