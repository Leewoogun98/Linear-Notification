// Linear OAuth 2.0 헬퍼. authorize URL은 순수, 토큰교환/viewer는 fetch.

export function buildAuthorizeUrl(origin: string, clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/auth/callback`,
    response_type: "code",
    scope: "read",
    state,
    actor: "user",
  });
  return `https://linear.app/oauth/authorize?${params.toString()}`;
}

// code → access token
export async function exchangeCode(
  origin: string,
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<string> {
  const res = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${origin}/auth/callback`,
      grant_type: "authorization_code",
      code,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("no access_token");
  return json.access_token;
}

// access token → { id, name }
export async function fetchViewer(accessToken: string): Promise<{ id: string; name: string }> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: "{ viewer { id name } }" }),
  });
  if (!res.ok) throw new Error(`viewer query failed: ${res.status}`);
  const json = (await res.json()) as { data?: { viewer?: { id: string; name: string } } };
  if (!json.data?.viewer) throw new Error("no viewer");
  return json.data.viewer;
}
