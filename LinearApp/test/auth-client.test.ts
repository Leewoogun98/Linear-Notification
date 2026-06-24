import { describe, it, expect } from "vitest";
import { httpBaseFrom } from "../src/main/auth-client";

describe("httpBaseFrom", () => {
  it("wss → https", () => {
    expect(httpBaseFrom("wss://relay.example.com")).toBe("https://relay.example.com");
  });
  it("ws → http", () => {
    expect(httpBaseFrom("ws://localhost:8787")).toBe("http://localhost:8787");
  });
});
