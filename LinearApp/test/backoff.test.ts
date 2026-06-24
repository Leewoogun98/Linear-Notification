import { describe, it, expect } from "vitest";
import { nextBackoff } from "../src/main/backoff";

describe("nextBackoff", () => {
  it("시도 횟수에 따라 지수적으로 증가", () => {
    expect(nextBackoff(0)).toBe(1000);
    expect(nextBackoff(1)).toBe(2000);
    expect(nextBackoff(2)).toBe(4000);
  });
  it("최대값 30초로 제한", () => {
    expect(nextBackoff(10)).toBe(30000);
  });
});
