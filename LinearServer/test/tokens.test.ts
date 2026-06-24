import { describe, it, expect } from "vitest";
import { randomToken } from "../src/tokens";

describe("randomToken", () => {
  it("기본 32바이트 = 64 hex 문자", () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{64}$/);
  });
  it("호출마다 다른 값", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
  it("길이 지정 가능", () => {
    expect(randomToken(8)).toMatch(/^[0-9a-f]{16}$/);
  });
});
