import { describe, it, expect } from "vitest";
import { newPairingCode } from "../src/main/tokens";

describe("newPairingCode", () => {
  it("32 hex 문자", () => { expect(newPairingCode()).toMatch(/^[0-9a-f]{32}$/); });
  it("매번 다름", () => { expect(newPairingCode()).not.toBe(newPairingCode()); });
});
