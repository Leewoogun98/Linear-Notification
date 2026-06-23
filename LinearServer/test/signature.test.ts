import { describe, it, expect } from "vitest";
import { verifyLinearSignature, computeSignature } from "../src/signature";

const SECRET = "test-secret";

describe("verifyLinearSignature", () => {
  it("유효한 서명이면 true", async () => {
    const body = JSON.stringify({ action: "create", type: "Issue" });
    const sig = await computeSignature(body, SECRET);
    expect(await verifyLinearSignature(body, sig, SECRET)).toBe(true);
  });

  it("본문이 변조되면 false", async () => {
    const body = JSON.stringify({ action: "create", type: "Issue" });
    const sig = await computeSignature(body, SECRET);
    expect(await verifyLinearSignature(body + "x", sig, SECRET)).toBe(false);
  });

  it("서명 헤더가 비어 있으면 false", async () => {
    expect(await verifyLinearSignature("{}", "", SECRET)).toBe(false);
  });
});
