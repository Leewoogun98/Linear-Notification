// Web Crypto의 getRandomValues는 Workers/Node 모두 제공. 암호학적 난수 hex 문자열 생성.
export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}
