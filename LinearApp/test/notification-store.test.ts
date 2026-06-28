import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotificationStore } from "../src/main/notification-store";

let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "noti-")); file = join(dir, "notifications.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sample = (over = {}) => ({
  category: "comment" as const, title: "t", body: "b", receivedAt: 1000, ...over,
});

describe("NotificationStore", () => {
  it("add 후 list에 최신순으로 들어가고 안읽음", () => {
    const s = new NotificationStore(file);
    s.add(sample({ title: "first", receivedAt: 1 }));
    s.add(sample({ title: "second", receivedAt: 2 }));
    const list = s.list();
    expect(list.map((n) => n.title)).toEqual(["second", "first"]);
    expect(s.unreadCount()).toBe(2);
  });

  it("최근 100개만 보관", () => {
    const s = new NotificationStore(file);
    for (let i = 0; i < 105; i++) s.add(sample({ title: `n${i}`, receivedAt: i }));
    expect(s.list().length).toBe(100);
    expect(s.list()[0].title).toBe("n104");
  });

  it("markRead로 읽음 처리 + unreadCount 감소", () => {
    const s = new NotificationStore(file);
    const a = s.add(sample());
    s.markRead(a.id);
    expect(s.unreadCount()).toBe(0);
  });

  it("markAllRead로 모두 읽음 처리 (목록은 유지, unreadCount 0)", () => {
    const s = new NotificationStore(file);
    s.add(sample({ title: "a" }));
    s.add(sample({ title: "b" }));
    s.markAllRead();
    expect(s.unreadCount()).toBe(0);
    expect(s.list().length).toBe(2);
  });

  it("clearAll 후 비워짐", () => {
    const s = new NotificationStore(file);
    s.add(sample());
    s.clearAll();
    expect(s.list()).toEqual([]);
  });

  it("디스크에 영속(새 인스턴스가 읽음)", () => {
    const s1 = new NotificationStore(file);
    s1.add(sample({ title: "persisted" }));
    const s2 = new NotificationStore(file);
    expect(s2.list()[0].title).toBe("persisted");
  });

  it("손상 파일이면 빈 목록", () => {
    writeFileSync(file, "{ not json");
    const s = new NotificationStore(file);
    expect(s.list()).toEqual([]);
  });
});
