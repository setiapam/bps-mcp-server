# Panduan Deploy Code Mode — Pola A (Cloudflare Worker Free + k3s Homelab) & Mode Lokal

Panduan ini menjelaskan cara menjalankan **BPS MCP Server Code Mode** di dua lingkungan:
1. **Pola A (Remote Hybrid):** Cloudflare Worker Free menangani OAuth 2.1 + `/mcp` standar (39 tools) dan mem-proxy `/mcp/code` melalui Cloudflare Tunnel ke Pod k3s yang menjalankan sandbox **QuickJS WASM**.
2. **Mode Lokal (`stdio`):** Opt-in melalui flag `--code-mode` atau env `BPS_CODE_MODE=true`.

---

## 1. Mode Lokal (`stdio`)

Default `bps-mcp-server` tetap berjalan pada mode standar (39 tools). Untuk mengaktifkan Code Mode di client MCP lokal (Claude Desktop, Claude Code, Cursor, dll.):

```json
{
  "mcpServers": {
    "bps-code": {
      "command": "npx",
      "args": ["-y", "bps-mcp-server", "--code-mode"],
      "env": {
        "BPS_API_KEY": "your_bps_api_key"
      }
    }
  }
}
```

Atau via environment variable:
```bash
BPS_API_KEY=your_key BPS_CODE_MODE=true npx bps-mcp-server
# atau:
BPS_API_KEY=your_key BPS_MODE=code node dist/index.js
```

---

## 2. Deploy Backend Code Mode ke k3s Homelab

### Prasyarat
- Cluster k3s aktif (mendukung `local-path` StorageClass untuk PVC).
- `cloudflared` berjalan di dalam cluster (atau host yang dapat menjangkau ClusterIP/Ingress).
- Cloudflare Worker Free sudah ter-deploy (`wrangler.toml`).

### Langkah 1 — Buat Shared Secret (32-byte random)

Secret ini mengunci akses ke Pod k3s agar hanya Worker Cloudflare Anda yang dapat memanggil `/mcp/code` (Pod bersikap **fail-closed 401** bila secret kosong/tidak cocok).

```bash
SECRET=$(openssl rand -hex 32)
```

Buat Kubernetes Secret pada namespace tujuan (misal `bps-mcp`):

```bash
kubectl create namespace bps-mcp --dry-run=client -o yaml | kubectl apply -f -

kubectl -n bps-mcp create secret generic bps-mcp-codemode-secret \
  --from-literal=CODEMODE_SHARED_SECRET="$SECRET"
```

### Langkah 2 — Apply Manifest k3s

```bash
kubectl -n bps-mcp apply -f k8s/pvc.yaml
kubectl -n bps-mcp apply -f k8s/service.yaml
kubectl -n bps-mcp apply -f k8s/deployment.yaml
kubectl -n bps-mcp apply -f k8s/networkpolicy.yaml
```

> **Catatan `NetworkPolicy`:** Sesuaikan label `podSelector` pada [`k8s/networkpolicy.yaml`](../k8s/networkpolicy.yaml) (`app: cloudflared`) agar cocok dengan label pod `cloudflared` di cluster k3s Anda. Egress ke seluruh subnet LAN rumah (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`) diblokir secara default untuk mencegah SSRF.

Pastikan pod sehat:
```bash
kubectl -n bps-mcp rollout status deployment/bps-mcp-codemode
kubectl -n bps-mcp port-forward svc/bps-mcp-codemode 3000:3000
curl -s http://127.0.0.1:3000/healthz
curl -s http://127.0.0.1:3000/readyz
```

### Langkah 3 — Tambahkan Ingress di Cloudflare Tunnel (`cloudflared`)

Pada konfigurasi Cloudflare Tunnel (Zero Trust Dashboard → Networks → Tunnels, atau `config.yaml`):

```yaml
ingress:
  - hostname: bps-codemode.murphi.my.id
    service: http://bps-mcp-codemode.bps-mcp.svc.cluster.local:3000
  - service: http_status:404
```

*(Opsional, lapisan keamanan ekstra)* Lindungi hostname `bps-codemode.murphi.my.id` dengan **Cloudflare Access** menggunakan **Service Token** (`CF_ACCESS_CLIENT_ID` & `CF_ACCESS_CLIENT_SECRET`), lalu set kedua secret tersebut di Worker:

```bash
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
```

### Langkah 4 — Aktifkan Proxy `/mcp/code` di Cloudflare Worker Free

1. Uncomment dan sesuaikan `CODEMODE_BACKEND_URL` di [`wrangler.toml`](../wrangler.toml):
   ```toml
   CODEMODE_BACKEND_URL = "https://bps-codemode.murphi.my.id"
   ```
2. Simpan `CODEMODE_SHARED_SECRET` yang sama ke Cloudflare Worker:
   ```bash
   printf "%s" "$SECRET" | npx wrangler secret put CODEMODE_SHARED_SECRET
   ```
3. Deploy Worker:
   ```bash
   npm run typecheck:worker && npm run deploy
   ```

### Langkah 5 — Verifikasi End-to-End

1. Cek `/health` pada Worker:
   ```bash
   curl -s https://<worker-domain>/health | jq
   ```
   Pastikan `"codeModeEndpoint": "/mcp/code"` dan `"codeModeEnabled": true`.
2. Hubungkan client MCP (Claude Web/Desktop/Remote) ke:
   - `https://<worker-domain>/mcp/code` → Code Mode (1 tool `execute_bps_code` dengan akses penuh 39 API `bps.*`)
   - `https://<worker-domain>/mcp` → Standard Mode (39 tools, tetap 100% online di edge meski homelab sedang maintenance)

---

## 3. Build Docker Lokal (Opsional)

Image multi-arch (`linux/amd64` + `linux/arm64`) otomatis dipublikasikan ke GHCR oleh [`.github/workflows/docker.yml`](../.github/workflows/docker.yml). Untuk build dan uji lokal:

```bash
docker build -t bps-mcp-codemode:local .
docker run --rm -p 3000:3000 \
  -e CODEMODE_SHARED_SECRET=dev-secret \
  bps-mcp-codemode:local
```

Smoke test lokal `POST /mcp/code`:
```bash
curl -sS -X POST http://127.0.0.1:3000/mcp/code \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-CodeMode-Secret: dev-secret" \
  -H "X-BPS-API-Key: $BPS_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## 4. Konfigurasi Guardrail & Environment Variables

| Variable | Default | Keterangan |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port listen HTTP server k3s |
| `HOST` | `0.0.0.0` | Interface bind HTTP server |
| `BPS_DATA_DIR` | `~/.bps-mcp` (`/data` di Docker) | Direktori penyimpanan `learned-vars.json` (mounted PVC di k3s) |
| `CODEMODE_SHARED_SECRET` | *(wajib)* | Shared secret header `X-CodeMode-Secret` (fail-closed `401` bila kosong) |
| `CODEMODE_MEMORY_LIMIT_MB` | `32` | Batas RAM per eksekusi QuickJS isolate |
| `CODEMODE_STACK_LIMIT_KB` | `512` | Batas stack QuickJS (anti-infinite recursion) |
| `CODEMODE_TIMEOUT_MS` | `25000` | Batas waktu CPU & I/O per eksekusi skrip |
| `CODEMODE_MAX_CALLS` | `30` | Maksimum pemanggilan `bps.*` per eksekusi |
| `CODEMODE_MAX_OUTPUT_BYTES` | `51200` | Batas ukuran JSON output (50 KB) sebelum dipotong (`truncated: true`) |
| `CODEMODE_MAX_LOG_BYTES` | `4096` | Batas tangkapan `console.log/warn/error` |
| `CODEMODE_MAX_CONCURRENT` | `8` | Maksimum request Code Mode paralel per Pod |
