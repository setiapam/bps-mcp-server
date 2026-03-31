# Deploy BPS MCP Server to Cloudflare Workers

## Prerequisites

- Cloudflare account ([sign up free](https://dash.cloudflare.com/sign-up))
- Cloudflare API token with Workers permissions
- Node.js ≥ 18 and npm
- BPS API key ([get one free](https://webapi.bps.go.id))

## Quick Deploy

### 1. Clone and install

```bash
git clone https://github.com/setiapam/bps-mcp-server
cd bps-mcp-server
npm install
```

### 2. Authenticate wrangler

```bash
npx wrangler login
```

### 3. Create KV namespace

```bash
npx wrangler kv namespace create BPS_CACHE
```

Copy the `id` from the output and replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` in `wrangler.toml`.

For preview (local dev), also run:

```bash
npx wrangler kv namespace create BPS_CACHE --preview
```

Update the `preview_id` field in `wrangler.toml` with the preview namespace ID.

### 4. Set BPS API key as secret

```bash
npx wrangler secret put BPS_API_KEY
```

Enter your BPS API key when prompted. This stores it encrypted — it will NOT be in `wrangler.toml`.

### 5. Deploy

```bash
npm run deploy
```

The worker will be live at `https://bps-mcp-server.<your-subdomain>.workers.dev`.

## Automated Deploy via GitHub Actions

The `.github/workflows/deploy-worker.yml` workflow deploys on every push to `main`.

Add these secrets to your GitHub repository settings:

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers:Edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

Create a scoped API token at: Cloudflare Dashboard → Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template.

## Local Development

```bash
npm run dev:worker
```

This starts the worker locally at `http://localhost:8787`.

For local dev, you can pass the API key via header instead of relying on the KV-stored secret.

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Set transport to `Streamable HTTP` and URL to:
```
https://bps-mcp-server.<your-subdomain>.workers.dev/mcp
```

Add header: `X-BPS-API-Key: your_api_key`

## BYOK Mode (Per-Request API Key)

The worker supports BYOK — pass the BPS API key per request via the `X-BPS-API-Key` header. This is useful when multiple users with different BPS API keys share a single deployed worker.

```bash
curl https://bps-mcp-server.<your-subdomain>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "X-BPS-API-Key: your_bps_api_key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

## Configuring MCP Clients

### Claude Desktop (remote MCP)

```json
{
  "mcpServers": {
    "bps-statistics": {
      "type": "http",
      "url": "https://bps-mcp-server.<your-subdomain>.workers.dev/mcp",
      "headers": {
        "X-BPS-API-Key": "your_api_key_here"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http bps https://bps-mcp-server.<your-subdomain>.workers.dev/mcp
```

## Health Check

```bash
curl https://bps-mcp-server.<your-subdomain>.workers.dev/
```

Returns server info and the MCP endpoint URL.
