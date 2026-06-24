import { describe, it, expect } from "vitest";
import { buildAuthorizeUrl } from "../src/oauth";

describe("buildAuthorizeUrl", () => {
  it("Linear authorize URL을 올바른 파라미터로 생성", () => {
    const url = new URL(buildAuthorizeUrl("https://relay.example.com", "cid123", "pair_abc"));
    expect(url.origin + url.pathname).toBe("https://linear.app/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://relay.example.com/auth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("read");
    expect(url.searchParams.get("state")).toBe("pair_abc");
  });
});
