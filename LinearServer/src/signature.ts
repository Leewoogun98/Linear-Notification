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

// 상수시간 비교(길이가 달라도 조기 반환하지 않음).
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  if (len === 0) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
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
