import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/**
 * Handles the /authorize endpoint — shows a login form where users enter their BPS API key.
 * After validation, completes the OAuth authorization and redirects back to the client.
 */
export async function handleAuthorize(
  request: Request,
  oauthHelpers: OAuthHelpers
): Promise<Response> {
  if (request.method === "GET") {
    const authRequest = await oauthHelpers.parseAuthRequest(request);
    return renderLoginPage(authRequest);
  }

  if (request.method === "POST") {
    const formData = await request.formData();
    const apiKey = formData.get("api_key") as string;

    // Reconstruct auth request from hidden form fields
    const authRequest: AuthRequest = {
      responseType: formData.get("response_type") as string || "code",
      clientId: formData.get("client_id") as string || "",
      redirectUri: formData.get("redirect_uri") as string || "",
      scope: (formData.get("scope") as string || "").split(" ").filter(Boolean),
      state: formData.get("state") as string || "",
      codeChallenge: formData.get("code_challenge") as string || undefined,
      codeChallengeMethod: formData.get("code_challenge_method") as string || undefined,
    };

    if (!apiKey || apiKey.length < 20) {
      return renderLoginPage(authRequest, "API key tidak valid. Minimal 20 karakter.");
    }

    // Validate the API key against BPS API
    const valid = await validateBpsApiKey(apiKey);
    if (!valid) {
      return renderLoginPage(authRequest, "API key BPS tidak valid. Pastikan key Anda benar.");
    }

    try {
      // Complete authorization — store BPS API key in props
      const { redirectTo } = await oauthHelpers.completeAuthorization({
        request: authRequest,
        userId: `bps_${hashKey(apiKey)}`,
        metadata: { createdAt: Date.now() },
        scope: authRequest.scope,
        props: { bpsApiKey: apiKey },
      });

      return Response.redirect(redirectTo, 302);
    } catch (error) {
      const isKvLimit = error instanceof Error && 
        (error.message.includes("limit") || error.message.includes("quota") || error.message.includes("429"));
      
      const errorMsg = isKvLimit
        ? "Gagal melakukan otorisasi karena batas penyimpanan (Cloudflare Workers KV) harian telah terlampaui. Silakan hubungi administrator."
        : `Gagal menyimpan otorisasi OAuth: ${error instanceof Error ? error.message : String(error)}`;
      
      return renderLoginPage(authRequest, errorMsg);
    }
  }

  return new Response("Method not allowed", { status: 405 });
}

async function validateBpsApiKey(apiKey: string): Promise<boolean> {
  try {
    const url = `https://webapi.bps.go.id/v1/api/domain/type/all/key/${apiKey}/`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    // If BPS API is down or blocks us, allow through (validate later on actual use)
    if (!res.ok) return true;
    const text = await res.text();
    try {
      const data = JSON.parse(text) as { status?: string; "data-availability"?: string };
      // Only reject if BPS explicitly says the key is invalid
      if (data.status === "400" || data["data-availability"] === "list-not-available") return false;
    } catch {
      // Non-JSON response (HTML error page) — allow through
    }
    return true;
  } catch {
    return true;
  }
}

function hashKey(key: string): string {
  // Simple hash for user ID — not for security, just uniqueness
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function renderLoginPage(authRequest: AuthRequest, error?: string): Response {
  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BPS MCP Server — Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 1rem; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); padding: 2rem; max-width: 420px; width: 100%; }
    h1 { font-size: 1.4rem; margin-bottom: 0.5rem; color: #1a1a1a; }
    .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
    label { display: block; font-weight: 500; margin-bottom: 0.4rem; color: #333; font-size: 0.9rem; }
    input[type="text"] { width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem; margin-bottom: 1rem; }
    input[type="text"]:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    button { width: 100%; padding: 0.75rem; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 500; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .error { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 0.7rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem; }
    .info { background: #f0f9ff; border: 1px solid #bae6fd; padding: 0.7rem; border-radius: 8px; margin-top: 1rem; font-size: 0.8rem; color: #0369a1; }
    .info a { color: #0369a1; }
    .client { color: #666; font-size: 0.8rem; margin-bottom: 1rem; padding: 0.5rem; background: #f9fafb; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🇮🇩 BPS MCP Server</h1>
    <p class="subtitle">Masukkan API key BPS Anda untuk mengotorisasi akses data statistik Indonesia.</p>
    
    <div class="client">Mengotorisasi untuk: <strong>${authRequest.clientId}</strong></div>
    
    ${error ? `<div class="error">${error}</div>` : ""}
    
    <form method="POST">
      <input type="hidden" name="response_type" value="${authRequest.responseType}">
      <input type="hidden" name="client_id" value="${authRequest.clientId}">
      <input type="hidden" name="redirect_uri" value="${authRequest.redirectUri}">
      <input type="hidden" name="scope" value="${authRequest.scope.join(" ")}">
      <input type="hidden" name="state" value="${authRequest.state}">
      ${authRequest.codeChallenge ? `<input type="hidden" name="code_challenge" value="${authRequest.codeChallenge}">` : ""}
      ${authRequest.codeChallengeMethod ? `<input type="hidden" name="code_challenge_method" value="${authRequest.codeChallengeMethod}">` : ""}
      
      <label for="api_key">BPS API Key</label>
      <input type="text" id="api_key" name="api_key" placeholder="Masukkan API key BPS Anda" required autocomplete="off">
      
      <button type="submit">Otorisasi</button>
    </form>
    
    <div class="info">
      Belum punya API key? <a href="https://webapi.bps.go.id" target="_blank">Daftar gratis di webapi.bps.go.id</a>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
