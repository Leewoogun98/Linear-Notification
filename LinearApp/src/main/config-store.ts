import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_SETTINGS, type Settings } from "../shared/types";

export function loadSettings(file: string): Settings {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
}
