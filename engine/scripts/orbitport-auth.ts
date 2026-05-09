// Caches and refreshes Orbitport OAuth2 access tokens.
// Used by both the smoke test and the production KMS signer.

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cached: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  const refreshBufferMs = 5 * 60 * 1000;
  if (cached && Date.now() < cached.expiresAt - refreshBufferMs) {
    return cached.token;
  }

  const authUrl = process.env.ORBITPORT_AUTH_URL;
  const clientId = process.env.ORBITPORT_CLIENT_ID;
  const clientSecret = process.env.ORBITPORT_CLIENT_SECRET;
  if (!authUrl || !clientId || !clientSecret) {
    throw new Error(
      "Missing ORBITPORT_AUTH_URL, ORBITPORT_CLIENT_ID, or ORBITPORT_CLIENT_SECRET",
    );
  }

  const resp = await fetch(`${authUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      audience: "https://op.spacecomputer.io/api",
      grant_type: "client_credentials",
    }),
  });

  if (!resp.ok) {
    throw new Error(`Orbitport auth failed: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as TokenResponse;
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}
