import { verifyLinearSignature } from "./signature";
import { buildAuthorizeUrl, exchangeCode, fetchViewer } from "./oauth";
import { randomToken } from "./tokens";
export { RelayDurableObject } from "./relay-do";

interface Env {
  RELAY: DurableObjectNamespace;
  LINEAR_WEBHOOK_SECRET: string;
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
}

function relayStub(env: Env) {
  return env.RELAY.get(env.RELAY.idFromName("main"));
}

function html(body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">${body}</body>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;

    // --- OAuth 시작: 브라우저를 Linear 동의화면으로 ---
    if (url.pathname === "/auth/start") {
      const cb = url.searchParams.get("cb") ?? "";
      if (!cb) return new Response("missing cb", { status: 400 });
      return Response.redirect(buildAuthorizeUrl(origin, env.LINEAR_CLIENT_ID, cb), 302);
    }

    // --- OAuth 콜백: code→token→viewer→세션 발급 ---
    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      if (!code || !state) return html("로그인 실패: 잘못된 콜백입니다. 앱에서 다시 시도하세요.");
      try {
        const accessToken = await exchangeCode(origin, env.LINEAR_CLIENT_ID, env.LINEAR_CLIENT_SECRET, code);
        const viewer = await fetchViewer(accessToken);
        const token = randomToken();
        await relayStub(env).fetch("https://do/session/put", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, session: { userId: viewer.id, name: viewer.name }, pairing: state }),
        });
        return html(`<b>${viewer.name}</b> 님 로그인 완료 ✓<br>앱으로 돌아가세요. 이 창은 닫아도 됩니다.`);
      } catch (e) {
        return html("로그인 실패: " + (e as Error).message);
      }
    }

    // --- 앱이 세션 토큰을 회수 ---
    if (url.pathname === "/auth/poll") {
      const cb = url.searchParams.get("cb") ?? "";
      const res = await relayStub(env).fetch(`https://do/session/poll?cb=${encodeURIComponent(cb)}`);
      return new Response(await res.text(), { headers: { "content-type": "application/json" } });
    }

    // --- Linear webhook 수신 ---
    if (url.pathname === "/webhook" && request.method === "POST") {
      const body = await request.text();
      const ok = await verifyLinearSignature(body, request.headers.get("Linear-Signature") ?? "", env.LINEAR_WEBHOOK_SECRET);
      if (!ok) return new Response("invalid signature", { status: 401 });
      await relayStub(env).fetch("https://do/broadcast", {
        method: "POST", headers: { "content-type": "application/json" }, body,
      });
      return new Response("ok");
    }

    // --- 앱 WS 연결 (세션 토큰은 DO가 검증) ---
    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const token = url.searchParams.get("token") ?? "";
      const since = url.searchParams.get("since") ?? "0";
      return relayStub(env).fetch(
        `https://do/connect?token=${encodeURIComponent(token)}&since=${encodeURIComponent(since)}`,
        request,
      );
    }

    return new Response("Linear Noti relay", { status: 200 });
  },
};
