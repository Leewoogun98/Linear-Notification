// Web Crypto(subtle)로 HMAC-SHA256 hex 서명을 계산한다. Workers/Node 모두 globalThis.crypto 제공.
export async function computeSignature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 상수시간 비교(길이 다르면 즉시 false).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyLinearSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;
  const expected = await computeSignature(body, secret);
  return timingSafeEqual(signature, expected);
}
