import { newPairingCode } from "./tokens";

// relayUrl(wss://...) → https base
export function httpBaseFrom(relayUrl: string): string {
  return relayUrl.replace(/^ws/, "http"); // wss->https, ws->http
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 브라우저로 로그인 → 폴링으로 세션 토큰 회수. 실패 시 throw.
export async function login(
  relayUrl: string,
  openExternal: (url: string) => Promise<void>,
  opts: { intervalMs?: number; tries?: number } = {},
): Promise<string> {
  const base = httpBaseFrom(relayUrl);
  const cb = newPairingCode();
  await openExternal(`${base}/auth/start?cb=${cb}`);

  const interval = opts.intervalMs ?? 2000;
  const tries = opts.tries ?? 150; // ~5분
  for (let i = 0; i < tries; i++) {
    await delay(interval);
    try {
      const res = await fetch(`${base}/auth/poll?cb=${encodeURIComponent(cb)}`);
      if (res.ok) {
        const j = (await res.json()) as { token?: string };
        if (j.token) return j.token;
      }
    } catch { /* 네트워크 일시 오류 무시, 계속 폴링 */ }
  }
  throw new Error("로그인 시간 초과");
}
