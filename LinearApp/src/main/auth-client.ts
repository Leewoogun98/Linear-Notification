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
      const text = await res.text();
      console.log(`[poll ${i}] GET ${base}/auth/poll?cb=${cb} -> ${res.status} body=${text}`);
      if (res.ok) {
        let j: { token?: string } = {};
        try { j = JSON.parse(text); } catch (e) { console.log("[poll] JSON parse error", e); }
        if (j.token) { console.log("[poll] GOT TOKEN, resolving login"); return j.token; }
      }
    } catch (e) {
      console.log(`[poll ${i}] fetch error:`, (e as Error).message);
    }
  }
  console.log("[poll] timed out after", tries, "tries");
  throw new Error("로그인 시간 초과");
}
