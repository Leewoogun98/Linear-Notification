import { verifyLinearSignature } from "./signature";
export { RelayDurableObject } from "./relay-do";

interface Env {
  RELAY: DurableObjectNamespace;
  LINEAR_WEBHOOK_SECRET: string;
  APP_AUTH_TOKEN: string;
}

function relayStub(env: Env) {
  return env.RELAY.get(env.RELAY.idFromName("main"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1) Linear webhook 수신
    if (url.pathname === "/webhook" && request.method === "POST") {
      const body = await request.text();
      const signature = request.headers.get("Linear-Signature") ?? "";
      const ok = await verifyLinearSignature(body, signature, env.LINEAR_WEBHOOK_SECRET);
      if (!ok) return new Response("invalid signature", { status: 401 });

      // 검증된 본문을 DO로 내부 전달
      const stub = relayStub(env);
      await stub.fetch("https://do/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      return new Response("ok");
    }

    // 2) 데스크탑 앱 WS 연결
    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const token = url.searchParams.get("token") ?? "";
      if (token !== env.APP_AUTH_TOKEN) {
        return new Response("unauthorized", { status: 401 });
      }
      const since = url.searchParams.get("since") ?? "0";
      const stub = relayStub(env);
      return stub.fetch(`https://do/connect?since=${encodeURIComponent(since)}`, request);
    }

    return new Response("Linear Noti relay", { status: 200 });
  },
};
