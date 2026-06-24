import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, saveSettings } from "../src/main/config-store";
import { DEFAULT_SETTINGS } from "../src/shared/types";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "linearnoti-"));
  file = join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("config-store", () => {
  it("파일 없으면 기본값 반환", () => {
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
  });

  it("저장한 값을 다시 읽으면 동일", () => {
    const s = { ...DEFAULT_SETTINGS, relayUrl: "wss://x", me: { id: "u1", name: "woogun" } };
    saveSettings(file, s);
    expect(loadSettings(file)).toEqual(s);
  });

  it("손상된 JSON이면 기본값 반환", () => {
    saveSettings(file, DEFAULT_SETTINGS);
    writeFileSync(file, "{ not json");
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
  });
});
