# BPS Statistics MCP Server — Project Plan

> **Project:** `@bps-statistics/mcp-server`
> **License:** MIT (open source)
> **Status:** Planning
> **Author:** Murphi
> **Date:** 2026-03-30

---

## 1. Executive Summary

MCP (Model Context Protocol) server yang menjembatani data BPS (Badan Pusat Statistik) Indonesia ke AI clients seperti Claude Desktop, Claude Code, Cursor, dan MCP-compatible clients lainnya. Server ini memungkinkan user untuk melakukan natural language query terhadap data statistik resmi Indonesia — mulai dari data kependudukan, ekonomi, perdagangan, hingga data sensus.

**Prinsip utama:**
- Open source, gratis, sesuai ToU BPS API (non-komersial)
- Bring-your-own-key (BYOK) — setiap user menggunakan API token BPS mereka sendiri
- Auth-layer agnostic — siap migrasi dari token sederhana (v1) ke WSO2 OAuth (v2)
- Dual transport — stdio (lokal via npx) + Streamable HTTP (remote via Cloudflare Workers)
- Bilingual — mendukung output bahasa Indonesia dan Inggris
- Human-readable output — data BPS yang raw di-transform menjadi format yang mudah dipahami LLM

**Compatible AI Clients:**
- **Local (stdio):** Claude Desktop, Claude Code, Cursor, VS Code + Copilot, Windsurf, Cline/Roo Code, Zed, Continue.dev
- **Remote (HTTP):** ChatGPT, Gemini, Microsoft Copilot, custom web/mobile apps, n8n, automation platforms

---

## 2. Arsitektur

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Clients                               │
│                                                                   │
│  LOCAL (stdio)                    REMOTE (Streamable HTTP)        │
│  ┌──────────────────────┐        ┌───────────────────────────┐   │
│  │ Claude Desktop       │        │ ChatGPT (Connectors)      │   │
│  │ Claude Code          │        │ Gemini                    │   │
│  │ Cursor / VS Code     │        │ Microsoft Copilot         │   │
│  │ Windsurf / Zed       │        │ Custom web/mobile apps    │   │
│  │ Cline / Roo Code     │        │ n8n / automation tools    │   │
│  └──────────┬───────────┘        └─────────────┬─────────────┘   │
│             │                                   │                 │
└─────────────┼───────────────────────────────────┼─────────────────┘
              │ stdin/stdout                       │ HTTPS POST/GET
              ▼                                   ▼
┌─────────────────────────┐   ┌───────────────────────────────────┐
│  npm package (stdio)    │   │  Cloudflare Workers (HTTP)        │
│  npx bps-mcp-server     │   │  bps-mcp.{user}.workers.dev/mcp  │
│                         │   │                                   │
│  Runs as local          │   │  Runs on Cloudflare edge          │
│  subprocess on user's   │   │  300+ global locations             │
│  machine                │   │  Scale to zero, pay per request   │
└────────────┬────────────┘   └──────────────┬────────────────────┘
             │                                │
             └────────────┬───────────────────┘
                          ▼
        ┌──────────────────────────────────────┐
        │        Shared Core Logic              │
        │                                       │
        │  ┌───────────┐ ┌───────────┐ ┌─────┐│
        │  │  Tools    │ │ Resources │ │Prmpt││
        │  │  Layer    │ │  Layer    │ │Layer ││
        │  └─────┬─────┘ └─────┬─────┘ └─────┘│
        │        │              │               │
        │  ┌─────▼──────────────▼────────────┐ │
        │  │       Core Services              │ │
        │  │ Domain Resolver │ Data Formatter │ │
        │  │ Response Cache  │ Attribution    │ │
        │  └─────────────────┬───────────────┘ │
        │                    │                  │
        │  ┌─────────────────▼───────────────┐ │
        │  │  Auth Provider (Strategy)        │ │
        │  │  V1: API Key │ V2: WSO2 OAuth2  │ │
        │  └─────────────────┬───────────────┘ │
        │                    │                  │
        │  ┌─────────────────▼───────────────┐ │
        │  │  HTTP Client (fetch)             │ │
        │  └─────────────────┬───────────────┘ │
        └────────────────────┼─────────────────┘
                             │ HTTPS
                             ▼
                ┌────────────────────────┐
                │   webapi.bps.go.id    │
                │   BPS Web API v1      │
                └────────────────────────┘
```

### 2.2 Transport Layer — Dual Mode

MCP protocol mendukung dua transport standar. Server ini mengimplementasikan keduanya dengan shared core logic.

```
┌─────────────────────────────────────────────────────────┐
│                   Transport Layer                        │
│                                                          │
│  ┌─────────────────────────┐  ┌────────────────────────┐│
│  │  stdio Transport        │  │  Streamable HTTP       ││
│  │  (StdioServerTransport) │  │  (Cloudflare Workers)  ││
│  │                         │  │                        ││
│  │  • npx bps-mcp-server   │  │  • POST /mcp           ││
│  │  • JSON-RPC via stdin/  │  │  • GET /mcp (SSE)      ││
│  │    stdout               │  │  • Durable Objects for ││
│  │  • Zero network latency │  │    session state       ││
│  │  • User's env vars      │  │  • KV for caching      ││
│  │    provide BPS API key  │  │  • API key via header   ││
│  │                         │  │    or OAuth flow       ││
│  └─────────────────────────┘  └────────────────────────┘│
│                                                          │
│  Shared: McpServer instance + all tool/resource handlers │
└─────────────────────────────────────────────────────────┘
```

**Kapan pakai yang mana?**

| Scenario | Transport | Alasan |
|---|---|---|
| Developer pakai Claude Desktop/Code | stdio | Paling simple, install via npx |
| Developer pakai Cursor/VS Code | stdio | Native support, low latency |
| User pakai ChatGPT | HTTP (Workers) | ChatGPT butuh remote HTTPS endpoint |
| User pakai Gemini | HTTP (Workers) | Sama — butuh remote endpoint |
| Mobile app / web app | HTTP (Workers) | Nggak bisa spawn subprocess |
| Automation (n8n, etc.) | HTTP (Workers) | Perlu accessible via network |
| Air-gapped / offline | stdio | Nggak butuh internet untuk transport |

### 2.2 Auth Provider — Strategy Pattern (v1 ↔ v2 Migration)

Ini desain kunci untuk menghadapi migrasi dari token sederhana ke WSO2.

```
┌────────────────────────────────────────────┐
│           IAuthProvider (interface)          │
│                                             │
│  + authenticate(): Promise<AuthResult>      │
│  + getHeaders(): Promise<Record<string,str>>│
│  + isExpired(): boolean                     │
│  + refresh(): Promise<void>                 │
│  + getType(): "api-key" | "oauth2"          │
└────────────┬────────────────┬──────────────┘
             │                │
   ┌─────────▼──────┐  ┌─────▼────────────┐
   │ ApiKeyProvider  │  │ WSO2OAuthProvider │
   │ (BPS API v1)   │  │ (BPS API v2)      │
   │                 │  │                   │
   │ - apiKey: str   │  │ - clientId: str   │
   │                 │  │ - clientSecret: st│
   │ getHeaders() →  │  │ - tokenEndpoint   │
   │ { key: apiKey } │  │ - accessToken     │
   │                 │  │ - refreshToken    │
   │ isExpired() →   │  │ - expiresAt       │
   │ false (never)   │  │                   │
   │                 │  │ getHeaders() →    │
   │                 │  │ { Authorization:  │
   │                 │  │   Bearer <token> }│
   └─────────────────┘  └──────────────────┘
```

**Konfigurasi via environment:**

```bash
# V1 (current) — cukup API key
BPS_AUTH_TYPE=api-key
BPS_API_KEY=your_api_key_here

# V2 (future) — WSO2 OAuth2
BPS_AUTH_TYPE=oauth2
BPS_OAUTH_CLIENT_ID=your_client_id
BPS_OAUTH_CLIENT_SECRET=your_client_secret
BPS_OAUTH_TOKEN_ENDPOINT=https://api-gateway.bps.go.id/oauth2/token
BPS_OAUTH_SCOPES=openid,statistics:read

# Shared
BPS_API_BASE_URL=https://webapi.bps.go.id/v1  # atau v2 nantinya
BPS_DEFAULT_LANG=ind
```

**Auto-detection:** Server bisa auto-detect auth type dari env vars yang tersedia, sehingga user nggak perlu set `BPS_AUTH_TYPE` secara eksplisit jika hanya `BPS_API_KEY` yang di-set.

### 2.3 Caching Strategy

BPS data itu jarang berubah (rilis bulanan/tahunan), jadi caching sangat efektif:

```
┌─────────────────────────────────────────────┐
│               Cache Layer                    │
│                                              │
│  Strategy: In-memory LRU + TTL-based         │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │  Domain list     │ TTL: 24 hours    │    │
│  │  Subject list    │ TTL: 24 hours    │    │
│  │  Variable list   │ TTL: 12 hours    │    │
│  │  Static tables   │ TTL: 6 hours     │    │
│  │  Dynamic data    │ TTL: 1 hour      │    │
│  │  Trade data      │ TTL: 1 hour      │    │
│  │  Press release   │ TTL: 30 minutes  │    │
│  │  Publications    │ TTL: 6 hours     │    │
│  │  Strategic ind.  │ TTL: 1 hour      │    │
│  └─────────────────────────────────────┘    │
│                                              │
│  Cache key format:                           │
│  {endpoint}:{domain}:{params_hash}           │
│                                              │
│  Invalidation:                               │
│  - TTL-based automatic expiry                │
│  - Manual flush via `cache_clear` tool       │
│  - Max entries: configurable (default 500)   │
└─────────────────────────────────────────────┘
```

---

## 3. MCP Tools — Complete Specification

### 3.1 Tool Catalog

Berdasarkan analisis lengkap BPS API documentation, berikut semua tools yang akan di-expose:

#### Kategori: Wilayah (Domain)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_domains` | Daftar domain/wilayah BPS (provinsi, kab/kota) | `type`: all/prov/kab/kabbyprov, `prov?` |

#### Kategori: Subjek & Variabel

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_subjects` | Daftar subjek data statistik | `domain`, `subcat?` |
| `list_subject_categories` | Daftar kategori subjek | `domain` |
| `list_variables` | Daftar variabel di tabel dinamis | `domain`, `subject?`, `year?` |
| `list_vertical_variables` | Daftar variabel vertikal | `domain`, `var?` |
| `list_derived_variables` | Daftar turunan variabel | `domain`, `var?` |
| `list_periods` | Daftar periode data | `domain`, `var?` |
| `list_derived_periods` | Daftar turunan periode | `domain`, `var?` |
| `list_units` | Daftar satuan data | `domain` |

#### Kategori: Data Dinamis

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_dynamic_data` | **Core tool** — Ambil data dari tabel dinamis | `domain`, `var`, `th` (periode), `turvar?`, `vervar?`, `turth?` |

#### Kategori: Tabel Statis

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_static_tables` | List semua tabel statis | `domain`, `keyword?`, `year?`, `month?` |
| `get_static_table` | Detail satu tabel statis (HTML table) | `domain`, `id` |

#### Kategori: Sensus

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_census_events` | List kegiatan sensus | — |
| `list_census_topics` | List topik data per sensus | `kegiatan` |
| `list_census_areas` | List wilayah sensus | `kegiatan` |
| `list_census_datasets` | List dataset per sensus & topik | `kegiatan`, `topik` |
| `get_census_data` | Ambil data sensus | `kegiatan`, `wilayah_sensus`, `dataset` |

#### Kategori: SIMDASI (Statistik Indonesia / DDA)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_simdasi_subjects` | Subjek SIMDASI per wilayah | `wilayah` (7-digit MFD code) |
| `list_simdasi_tables` | Tabel SIMDASI per wilayah | `wilayah` |
| `list_simdasi_tables_by_subject` | Tabel per wilayah & subjek | `wilayah`, `id_subjek` |
| `get_simdasi_table` | Detail tabel SIMDASI | `wilayah`, `tahun`, `id_tabel` |
| `list_simdasi_provinces` | MFD codes provinsi | — |
| `list_simdasi_regencies` | MFD codes kab/kota | `parent` |
| `list_simdasi_districts` | MFD codes kecamatan | `parent` |

#### Kategori: CSA (Classification of Statistical Activities)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_csa_categories` | Kategori CSA | `domain` |
| `list_csa_subjects` | Subjek CSA | `domain`, `subcat?` |
| `list_csa_tables` | Tabel per subjek CSA | `domain`, `subject?` |
| `get_csa_table` | Detail tabel CSA | `domain`, `id`, `year?` |

#### Kategori: Publikasi & Berita

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_publications` | List publikasi BPS | `domain`, `keyword?`, `year?`, `month?` |
| `get_publication` | Detail publikasi | `domain`, `id` |
| `list_press_releases` | List Berita Resmi Statistik | `domain`, `keyword?`, `year?`, `month?` |
| `get_press_release` | Detail BRS | `domain`, `id` |

#### Kategori: Indikator & Referensi

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_strategic_indicators` | Indikator strategis (pusat/prov) | `domain`, `var?` |
| `list_infographics` | Infografis BPS | `domain`, `keyword?` |
| `list_glossary` | Glosarium statistik | `prefix?`, `perpage?` |
| `get_glossary` | Detail glosarium | `id` |

#### Kategori: Perdagangan Luar Negeri

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_trade_data` | Data ekspor/impor | `source` (1=ekspor/2=impor), `hs_code`, `hs_type`, `year`, `period` |

#### Kategori: SDGs & SDDS

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_sdgs_data` | Data Sustainable Development Goals | (TBD — perlu explore endpoint) |
| `get_sdds_data` | SDDS data | (TBD — perlu explore endpoint) |

#### Kategori: Pencarian & Utilitas

| Tool | Description | Key Params |
|------|-------------|------------|
| `search` | Pencarian data lintas tipe | `domain`, `keyword`, `type?` |
| `resolve_domain` | Konversi nama wilayah → kode domain | `query` (e.g., "Surabaya", "Jawa Timur") |
| `cache_clear` | Bersihkan cache | — |

### 3.2 Domain Resolver — Smart Lookup

Ini fitur kritis yang membuat server user-friendly. User bilang "Surabaya", server perlu resolve ke domain code "3578".

```
Strategi:
1. Saat startup / first call → fetch full domain list → cache 24 jam
2. Build inverted index: lowercase name → domain_id
3. Support fuzzy matching (Levenshtein distance)
4. Support common aliases:
   - "Jakarta" → "3100" (DKI Jakarta)
   - "Jogja" / "Yogya" → "3400" (DI Yogyakarta)
   - "Jatim" → "3500" (Jawa Timur)
   - dsb.

Internal tool — dipanggil oleh tools lain, bukan directly exposed.
Tapi juga available as tool untuk debugging/exploration.
```

### 3.3 Data Formatter

BPS API mengembalikan data dalam format yang sulit dibaca LLM, terutama `datacontent` di dynamic data:

```json
// Raw BPS response (datacontent key = gabungan vervar+var+turvar+th)
{ "99991452891000": 83.68 }

// Perlu di-transform menjadi:
"Persentase Rumah Tangga yang menggunakan Listrik PLN
di INDONESIA pada tahun 2000: 83.68%"
```

Formatter akan:
1. Resolve datacontent keys ke label yang readable
2. Membentuk tabel teks atau structured response
3. Menyertakan metadata (sumber, catatan, unit)
4. Menambahkan atribusi BPS sesuai ToU

---

## 4. MCP Resources

Resources menyediakan data statis/referensi yang bisa dibaca client tanpa tool call:

| Resource URI | Description |
|---|---|
| `bps://domains/provinces` | Daftar provinsi (cached) |
| `bps://domains/regencies/{prov_id}` | Kab/kota per provinsi |
| `bps://subjects/{domain}` | Daftar subjek per domain |
| `bps://glossary/{term}` | Definisi istilah statistik |

---

## 5. MCP Prompts

Pre-built prompts untuk common use cases:

| Prompt Name | Description |
|---|---|
| `compare_regions` | Template untuk membandingkan data antar wilayah |
| `trend_analysis` | Template untuk analisis tren multi-tahun |
| `poverty_profile` | Template profil kemiskinan suatu daerah |
| `economic_overview` | Template ringkasan ekonomi daerah |
| `population_stats` | Template statistik kependudukan |

---

## 6. Project Structure

```
bps-mcp-server/
├── src/
│   ├── index.ts                    # Entry point: stdio transport (npm)
│   ├── worker.ts                   # Entry point: Cloudflare Workers (HTTP)
│   ├── server.ts                   # MCP server setup & tool registration (shared)
│   │
│   ├── transport/                  # Transport layer
│   │   ├── stdio.ts                # stdio transport init
│   │   └── http.ts                 # Streamable HTTP transport init
│   │
│   ├── auth/                       # Auth provider (strategy pattern)
│   │   ├── types.ts                # IAuthProvider interface
│   │   ├── api-key.provider.ts     # V1: simple API key
│   │   ├── oauth2.provider.ts      # V2: WSO2 OAuth2 (future)
│   │   └── factory.ts              # Auto-detect & instantiate provider
│   │
│   ├── client/                     # HTTP client abstraction
│   │   ├── bps-client.ts           # Main BPS API client
│   │   ├── types.ts                # API response types
│   │   └── endpoints.ts            # Endpoint URL builders
│   │
│   ├── tools/                      # MCP tool handlers
│   │   ├── domain.tools.ts         # list_domains, resolve_domain
│   │   ├── dynamic-data.tools.ts   # get_dynamic_data + support tools
│   │   ├── static-table.tools.ts   # list/get static tables
│   │   ├── census.tools.ts         # Census data tools
│   │   ├── simdasi.tools.ts        # SIMDASI tools
│   │   ├── csa.tools.ts            # CSA subject tools
│   │   ├── publication.tools.ts    # Publications & press releases
│   │   ├── trade.tools.ts          # Foreign trade data
│   │   ├── reference.tools.ts      # Indicators, infographics, glossary
│   │   ├── search.tools.ts         # Cross-type search
│   │   └── utility.tools.ts        # cache_clear, server info
│   │
│   ├── resources/                  # MCP resource handlers
│   │   └── domain.resources.ts
│   │
│   ├── prompts/                    # MCP prompt templates
│   │   └── analysis.prompts.ts
│   │
│   ├── services/                   # Core business logic
│   │   ├── domain-resolver.ts      # Name → code resolver with fuzzy match
│   │   ├── data-formatter.ts       # Raw BPS data → readable output
│   │   ├── cache.ts                # Cache interface (in-memory for stdio, KV for Workers)
│   │   └── attribution.ts          # ToU-compliant attribution text
│   │
│   ├── config/                     # Configuration
│   │   ├── index.ts                # Env var parsing with Zod validation
│   │   ├── defaults.ts             # Default values & constants
│   │   └── domain-aliases.ts       # Common name aliases for domains
│   │
│   └── utils/                      # Shared utilities
│       ├── logger.ts               # stderr logger (stdio-safe)
│       ├── pagination.ts           # Auto-pagination helper
│       └── error.ts                # Error handling & user-friendly messages
│
├── worker/                         # Cloudflare Workers specific
│   ├── wrangler.toml               # Workers config (routes, KV bindings, DO)
│   └── worker-entry.ts             # Workers fetch handler wrapping server
│
├── tests/
│   ├── unit/
│   │   ├── auth/
│   │   ├── services/
│   │   └── tools/
│   ├── integration/
│   │   └── bps-api.test.ts         # Real API integration tests
│   └── fixtures/
│       └── *.json                  # Sample BPS API responses
│
├── docs/
│   ├── SETUP.md                    # Getting started guide
│   ├── TOOLS.md                    # Complete tool reference
│   ├── CLIENTS.md                  # Per-client connection guide
│   ├── DEPLOY-WORKERS.md           # Cloudflare Workers deployment guide
│   ├── MIGRATION-V2.md             # WSO2 migration guide
│   └── CONTRIBUTING.md
│
├── scripts/
│   ├── fetch-domains.ts            # Script to pre-cache domain list
│   └── generate-aliases.ts         # Generate domain alias map
│
├── .env.example
├── package.json
├── tsconfig.json
├── wrangler.toml                   # Root wrangler config (symlink or main)
├── README.md
├── LICENSE                         # MIT
└── CHANGELOG.md
```

---

## 7. Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| Runtime (stdio) | Node.js ≥ 18 | MCP SDK requirement |
| Runtime (remote) | Cloudflare Workers | Edge deployment, free tier, global |
| Language | TypeScript 5.x | Type safety, IDE support |
| MCP SDK | `@modelcontextprotocol/sdk` | Official SDK |
| Schema validation | `zod` v3 | Required peer dep of MCP SDK |
| HTTP client | Built-in `fetch` | Works on both Node.js 18+ and Workers |
| Caching (stdio) | Custom in-memory LRU + TTL | Zero dependencies |
| Caching (Workers) | Cloudflare KV | Persistent, global, edge-cached |
| Session (Workers) | Cloudflare Durable Objects | Per-connection state |
| Auth (Workers) | `workers-oauth-provider` | Cloudflare's OAuth library for MCP |
| Testing | `vitest` | Fast, TypeScript native |
| Build (stdio) | `tsc` | Simple, reliable |
| Build (Workers) | `wrangler` | Cloudflare's CLI tool |
| Linting | `eslint` + `prettier` | Code quality |
| Package manager | `npm` | Widest compatibility |

**Shared-core philosophy:** Tools, auth providers, formatters, dan resolvers ditulis sekali — transport layer (stdio vs Workers) hanya berbeda di entry point dan cache implementation. `fetch` API tersedia di kedua runtime tanpa polyfill.

---

## 8. Configuration & Environment

### 8.1 Environment Variables

```bash
# === Required ===
BPS_API_KEY=your_api_key          # Dari webapi.bps.go.id

# === Optional (with defaults) ===
BPS_API_BASE_URL=https://webapi.bps.go.id/v1  # Base URL API
BPS_DEFAULT_LANG=ind              # Default language: ind | eng
BPS_DEFAULT_DOMAIN=0000           # Default domain (0000 = Nasional)
BPS_CACHE_ENABLED=true            # Enable/disable caching
BPS_CACHE_MAX_ENTRIES=500         # Max cache entries (stdio in-memory only)
BPS_LOG_LEVEL=info                # debug | info | warn | error

# === Transport ===
BPS_TRANSPORT=stdio               # stdio | http
BPS_HTTP_PORT=3000                # Port for local HTTP mode (non-Workers)

# === Future: WSO2 OAuth2 (v2) ===
# BPS_AUTH_TYPE=oauth2
# BPS_OAUTH_CLIENT_ID=
# BPS_OAUTH_CLIENT_SECRET=
# BPS_OAUTH_TOKEN_ENDPOINT=
# BPS_OAUTH_SCOPES=
# BPS_OAUTH_REFRESH_BUFFER_SECONDS=60
```

### 8.2 Cloudflare Workers Config (wrangler.toml)

```toml
name = "bps-mcp-server"
main = "src/worker.ts"
compatibility_date = "2025-12-01"

[vars]
BPS_API_BASE_URL = "https://webapi.bps.go.id/v1"
BPS_DEFAULT_LANG = "ind"
BPS_DEFAULT_DOMAIN = "0000"

# KV namespace for caching BPS API responses
[[kv_namespaces]]
binding = "BPS_CACHE"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Durable Objects for session state (optional, for OAuth flow)
[durable_objects]
bindings = [
  { name = "MCP_SESSION", class_name = "McpSession" }
]

[[migrations]]
tag = "v1"
new_classes = ["McpSession"]
```

**Catatan:** Pada Cloudflare Workers, BPS_API_KEY TIDAK disimpan di `[vars]` (plain text). Gunakan `wrangler secret put BPS_API_KEY` untuk menyimpan sebagai encrypted secret. Namun pada authless public deployment, user mengirim API key mereka sendiri via request header `X-BPS-API-Key`.

### 8.2 Zod Config Schema

```typescript
import { z } from "zod";

const ConfigSchema = z.object({
  // Auth
  authType: z.enum(["api-key", "oauth2"]).default("api-key"),
  apiKey: z.string().optional(),
  oauthClientId: z.string().optional(),
  oauthClientSecret: z.string().optional(),
  oauthTokenEndpoint: z.string().url().optional(),
  oauthScopes: z.string().optional(),

  // API
  apiBaseUrl: z.string().url().default("https://webapi.bps.go.id/v1"),
  defaultLang: z.enum(["ind", "eng"]).default("ind"),
  defaultDomain: z.string().default("0000"),

  // Cache
  cacheEnabled: z.boolean().default(true),
  cacheMaxEntries: z.number().int().positive().default(500),

  // Logging
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
}).refine(
  (data) => {
    if (data.authType === "api-key") return !!data.apiKey;
    if (data.authType === "oauth2") {
      return !!data.oauthClientId && !!data.oauthClientSecret && !!data.oauthTokenEndpoint;
    }
    return false;
  },
  { message: "Invalid auth configuration. Provide BPS_API_KEY or OAuth2 credentials." }
);
```

---

## 9. ToU Compliance Checklist

Berdasarkan Term of Use BPS API (Desember 2022):

| Pasal | Requirement | Implementation |
|---|---|---|
| 3B | Token tidak boleh dibagi | BYOK — user provide own key via env (stdio) atau header (HTTP) |
| 4B | Atribusi wajib | Setiap response menyertakan: "Layanan ini menggunakan API Badan Pusat Statistik (BPS)" |
| 4C | Rate limit respect | Caching (in-memory / KV) + exponential backoff |
| 4E | Non-komersial | Open source MIT, gratis |
| 7 | Gratis & terbuka non-komersial | Sesuai — no monetization |
| 14A | Keamanan token | stdio: token di env var. Workers: token via encrypted header, tidak di-log, tidak di-persist |

### Attribution Text (wajib ada di setiap response tool)

```typescript
const ATTRIBUTION = "Sumber: Badan Pusat Statistik (BPS) — https://www.bps.go.id\n" +
  "Layanan ini menggunakan API Badan Pusat Statistik (BPS).";
```

### Remote Deployment & ToU Considerations

Pada mode remote (Cloudflare Workers), ada pertimbangan tambahan terkait Pasal 3B (token tidak boleh dibagi):

**Opsi A: Authless — User kirim key per-request (MVP)**
- User set header `X-BPS-API-Key` di setiap koneksi
- Server TIDAK menyimpan key secara permanen
- Key hanya ada di memory selama request processing
- Compliant karena server tidak "meminjamkan" key — user pakai key sendiri

**Opsi B: OAuth flow — User login & simpan key (Phase 4+)**
- User authenticate via OAuth (GitHub/Google)
- User input BPS API key sekali, disimpan encrypted di Durable Object per-user
- Subsequent requests pakai stored key
- Lebih convenient, tapi perlu clear consent dari user

**Opsi C: Self-hosted — User deploy Workers sendiri (recommended untuk production)**
- User fork repo → `wrangler secret put BPS_API_KEY` → deploy ke akun Workers mereka sendiri
- Paling secure — key tidak pernah transit ke server pihak ketiga
- Template `Deploy to Cloudflare` button di README

---

## 10. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Goal:** Server berjalan dengan 3-5 core tools.

- [ ] Project scaffolding (TypeScript, MCP SDK, Zod)
- [ ] Config management dengan Zod validation
- [ ] Auth provider interface + API Key provider (v1)
- [ ] BPS HTTP client dengan error handling
- [ ] In-memory LRU cache dengan TTL
- [ ] stderr-safe logger
- [ ] **Tools:** `list_domains`, `resolve_domain`
- [ ] **Tools:** `list_subjects`, `list_variables`
- [ ] **Tools:** `get_dynamic_data` (core tool)
- [ ] Data formatter — datacontent key resolution
- [ ] Attribution text injection
- [ ] Basic README + setup guide
- [ ] Test: connect ke Claude Desktop via stdio

### Phase 2: Complete Data Coverage (Week 3-4)

**Goal:** Semua BPS API endpoints ter-cover.

- [ ] **Tools:** Static tables (list + detail)
- [ ] **Tools:** Census data (events, topics, areas, datasets, data)
- [ ] **Tools:** SIMDASI (subjects, tables, detail, MFD codes)
- [ ] **Tools:** CSA subject hierarchy + tables
- [ ] **Tools:** Publications & press releases
- [ ] **Tools:** Strategic indicators
- [ ] **Tools:** Trade data (export/import)
- [ ] **Tools:** Infographics, glossary
- [ ] **Tools:** Cross-type search
- [ ] **Tools:** `cache_clear` utility
- [ ] Domain alias map (Jogja → 3400, Jatim → 3500, etc.)
- [ ] Auto-pagination (fetching all pages transparently)

### Phase 3: Polish & DX (Week 5-6)

**Goal:** Production-ready stdio version, well-documented, publishable.

- [ ] MCP Resources (domain lists, subject catalogs)
- [ ] MCP Prompts (compare_regions, trend_analysis, etc.)
- [ ] Comprehensive unit tests (vitest)
- [ ] Integration tests against real BPS API
- [ ] Error messages in bahasa Indonesia
- [ ] `.env.example` + setup wizard script
- [ ] Full documentation: SETUP.md, TOOLS.md, CLIENTS.md, CONTRIBUTING.md
- [ ] Per-client config examples (Claude Desktop, Claude Code, Cursor, VS Code, Windsurf)
- [ ] GitHub Actions CI/CD
- [ ] Publish ke npm: `bps-mcp-server`
- [ ] Submit ke MCP server registry (modelcontextprotocol/servers)

### Phase 4: Cloudflare Workers Remote Deployment (Week 7-8)

**Goal:** BPS MCP accessible via HTTP untuk ChatGPT, Gemini, dan semua remote clients.

- [ ] Cloudflare Workers entry point (`src/worker.ts`)
- [ ] Streamable HTTP transport setup dengan `agents` SDK
- [ ] Cache interface abstraction (in-memory ↔ KV switch)
- [ ] KV namespace setup untuk caching BPS responses
- [ ] API key via `X-BPS-API-Key` header (authless mode)
- [ ] CORS + security headers
- [ ] Rate limiting per-IP di Workers level
- [ ] `wrangler.toml` configuration
- [ ] "Deploy to Cloudflare" button di README
- [ ] Self-hosted deployment guide (DEPLOY-WORKERS.md)
- [ ] Test: connect dari ChatGPT Connectors
- [ ] Test: connect dari Gemini
- [ ] Test: connect dari MCP Inspector
- [ ] Submit ke Smithery.ai (MCP marketplace)
- [ ] Submit ke PulseMCP.com client directory

### Phase 5: WSO2 Readiness & OAuth (Week 9-10)

**Goal:** Siap untuk migrasi auth BPS API v2 + optional OAuth untuk remote users.

- [ ] OAuth2 provider implementation (WSO2-compatible)
- [ ] Token refresh logic + retry on 401
- [ ] MIGRATION-V2.md documentation
- [ ] Optional: OAuth flow untuk remote users (Cloudflare Access atau GitHub OAuth)
- [ ] Optional: Durable Objects untuk per-user API key storage
- [ ] Docker image (alternative deployment for non-CF users)

---

## 11. WSO2 Migration Strategy

### 11.1 Apa yang Berubah?

| Aspect | V1 (Current) | V2 (WSO2) |
|---|---|---|
| Auth mechanism | Static API key sebagai query param | OAuth2 Bearer token di header |
| Token lifecycle | Permanent, no expiry | Access token + refresh token, expiry |
| Registration | webapi.bps.go.id → get key | WSO2 Developer Portal → OAuth app |
| Rate limiting | Implicit (server-side) | Explicit via API Gateway policies |
| Base URL | webapi.bps.go.id/v1 | Kemungkinan berubah (TBD) |
| API structure | Mungkin sama, mungkin v2 endpoints | TBD |

### 11.2 Desain yang Sudah Future-Proof

1. **Auth abstracted** — Strategy pattern, switch via config
2. **Base URL configurable** — env var, bukan hardcoded
3. **HTTP client abstracted** — auth headers injected by provider, bukan di client
4. **Token refresh built-in** — OAuth2 provider punya refresh logic + buffer
5. **Retry on 401** — Client otomatis refresh token dan retry pada 401

### 11.3 Migration Checklist (Saat V2 Rilis)

```
1. [ ] Analisis API docs WSO2 BPS
2. [ ] Implement OAuth2Provider berdasarkan actual endpoint
3. [ ] Test token acquisition + refresh flow
4. [ ] Mapping endpoint lama → baru (jika berubah)
5. [ ] Update README + config docs
6. [ ] Bump version (semver major jika breaking)
7. [ ] Publish update
```

---

## 12. Usage Examples — Per-Client Connection Guide

### 12.1 Local Clients (stdio transport)

#### Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) atau `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "bps-statistics": {
      "command": "npx",
      "args": ["-y", "bps-mcp-server"],
      "env": {
        "BPS_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Claude Code

File: `.mcp.json` di project root

```json
{
  "mcpServers": {
    "bps": {
      "command": "npx",
      "args": ["-y", "bps-mcp-server"],
      "env": {
        "BPS_API_KEY": "${BPS_API_KEY}"
      }
    }
  }
}
```

Atau via CLI: `claude mcp add bps -- npx -y bps-mcp-server`

#### Cursor

Settings → Features → MCP → Add MCP Server:
- Type: `command`
- Command: `npx -y bps-mcp-server`

Atau file `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "bps-statistics": {
      "command": "npx",
      "args": ["-y", "bps-mcp-server"],
      "env": {
        "BPS_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### VS Code + GitHub Copilot

File: `.vscode/mcp.json` di workspace:
```json
{
  "servers": {
    "bps-statistics": {
      "command": "npx",
      "args": ["-y", "bps-mcp-server"],
      "env": {
        "BPS_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Windsurf / Cline / Roo Code

Sama dengan format Cursor — tambahkan di MCP config masing-masing.

### 12.2 Remote Clients (Streamable HTTP transport)

#### Self-Hosted Workers (recommended)

```bash
# Clone & deploy ke akun Cloudflare sendiri
git clone https://github.com/murphi/bps-mcp-server
cd bps-mcp-server
wrangler secret put BPS_API_KEY  # input key interactively
wrangler deploy
# → https://bps-mcp-server.{your-subdomain}.workers.dev/mcp
```

#### ChatGPT

1. Enable Developer mode di ChatGPT Settings
2. Settings → Connectors → Create Connector
3. URL: `https://bps-mcp-server.{your-subdomain}.workers.dev/mcp`
4. (Opsional) tambahkan header `X-BPS-API-Key` jika pakai public instance

#### Gemini / Microsoft Copilot

Arahkan ke URL MCP endpoint Workers yang sudah di-deploy.

#### Dari MCP Client yang belum support remote natively

Gunakan `mcp-remote` sebagai bridge:
```json
{
  "mcpServers": {
    "bps-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://bps-mcp-server.{subdomain}.workers.dev/mcp"]
    }
  }
}
```

### 12.3 Natural Language Query Examples

```
User: "Berapa jumlah penduduk Indonesia tahun 2023?"
→ AI calls: resolve_domain("Indonesia") → "0000"
→ AI calls: search(domain="0000", keyword="jumlah penduduk")
→ AI calls: get_dynamic_data(domain="0000", var=..., th=...)
→ AI presents: formatted population data with attribution

User: "Bandingkan angka kemiskinan Jawa Timur vs Jawa Barat 2020-2023"
→ AI calls: resolve_domain("Jawa Timur") → "3500"
→ AI calls: resolve_domain("Jawa Barat") → "3200"
→ AI calls: get_dynamic_data for both regions + multiple years
→ AI presents: comparison table with trend analysis

User: "Cari BRS terbaru tentang inflasi"
→ AI calls: list_press_releases(domain="0000", keyword="inflasi")
→ AI presents: list of recent press releases about inflation

User: "Data ekspor kopi Indonesia tahun 2024"
→ AI calls: get_trade_data(source=1, hs_code="0901", ...)
→ AI presents: formatted export data for coffee
```

---

## 13. Quality & Testing

### 13.1 Test Strategy

| Layer | Approach | Coverage Target |
|---|---|---|
| Unit tests | Mock BPS API responses | Auth providers, formatters, cache, resolver |
| Integration tests | Real API calls (gated by env var) | Core tools with live data |
| Fixture tests | Snapshot response format | Ensure formatter output stability |
| E2E | Manual via Claude Desktop | Happy path for all tool categories |

### 13.2 CI/CD

```yaml
# GitHub Actions
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit

  integration:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:integration
    env:
      BPS_API_KEY: ${{ secrets.BPS_API_KEY }}

  publish-npm:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - run: npm publish --access public
    env:
      NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  deploy-workers:
    if: github.ref == 'refs/heads/main'
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy
```

---

## 14. Distribution Channels

| Channel | URL/Location | Purpose | Transport |
|---|---|---|---|
| npm | `npmjs.com/package/bps-mcp-server` | Primary: stdio local install | stdio |
| GitHub | `github.com/murphi/bps-mcp-server` | Source code + issues | — |
| Cloudflare Workers | `bps-mcp.{user}.workers.dev/mcp` | Self-deploy remote instance | HTTP |
| "Deploy to CF" button | Di README.md | One-click self-deploy ke CF akun user | HTTP |
| MCP Registry | `github.com/modelcontextprotocol/servers` | Official MCP listing | — |
| Smithery | `smithery.ai` | MCP marketplace | — |
| PulseMCP | `pulsemcp.com` | MCP client/server directory | — |
| Docker Hub | (optional Phase 5) | Self-hosted non-CF deployment | HTTP |

---

## 15. Risiko & Mitigasi

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| BPS API down / rate limited | Users can't fetch data | Medium | Caching (KV/in-memory) + graceful error messages |
| BPS API v2 breaking changes | Major refactor needed | Medium | Abstracted client + versioned endpoints |
| WSO2 auth flow berbeda dari expected | Auth provider perlu rewrite | Low | Strategy pattern allows isolated changes |
| API key abuse (user shares key) | BPS blocks the key | Low | BYOK model — document best practices |
| BPS changes ToU | May restrict MCP usage | Low | Monitor ToU, maintain compliance |
| Low adoption | Wasted effort | Medium | Target niche (researchers, data journalists) + good docs |
| CF Workers free tier limits hit | 100K req/day exceeded | Low | User self-deploy to own CF account (no shared limit) |
| API key exposure via HTTP | Key intercepted in transit | Low | HTTPS only + recommend self-deploy option |
| Workers cold start latency | Slow first request | Low | KV cache warm-up + CF auto-scales |
| Durable Object costs | Unexpected billing for heavy OAuth usage | Low | OAuth flow is optional; default authless mode is stateless |

---

## 16. Success Metrics

| Metric | Target (6 months) |
|---|---|
| GitHub stars | 100+ |
| npm weekly downloads | 200+ |
| MCP registry listed | Yes |
| Tools coverage | 100% of BPS API v1 |
| Test coverage | >80% unit tests |
| WSO2 ready | Auth provider implemented |
| Contributors | 3+ external contributors |
| Workers deployments | 10+ self-deployed instances (via "Deploy to CF" button) |
| Client compatibility | Tested on 5+ MCP clients (Claude, ChatGPT, Cursor, etc.) |

---

## 17. Cloudflare Workers Deployment — Detail

### 17.1 Kenapa Workers, Bukan Pages?

| | Cloudflare Pages | Cloudflare Workers |
|---|---|---|
| Tujuan | Static sites + SSR frameworks | Serverless compute, API endpoints |
| MCP support | Tidak bisa (no persistent connections) | First-class: Streamable HTTP + SSE |
| Persistent state | Tidak | Durable Objects, KV, R2 |
| Custom HTTP handling | Terbatas | Full control via fetch handler |
| Pricing | Free untuk static | Free: 100K req/day, 10ms CPU/req |

### 17.2 Workers Architecture

```
┌──────────────────────────────────────────────────────┐
│  Cloudflare Workers Runtime                           │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  fetch handler (worker-entry.ts)                 │ │
│  │                                                   │ │
│  │  POST /mcp  → Streamable HTTP transport          │ │
│  │  GET  /mcp  → SSE stream (optional)              │ │
│  │  GET  /     → Health check + server info         │ │
│  │                                                   │ │
│  │  Headers:                                         │ │
│  │  X-BPS-API-Key: user's BPS token (per-request)   │ │
│  │  Accept: application/json, text/event-stream     │ │
│  └─────────────────────┬───────────────────────────┘ │
│                        │                              │
│  ┌─────────────────────▼───────────────────────────┐ │
│  │  McpServer (shared core — same as stdio)         │ │
│  │  All tools, resources, prompts registered here   │ │
│  └─────────────────────┬───────────────────────────┘ │
│                        │                              │
│  ┌─────────────────────▼───────────────────────────┐ │
│  │  Bindings                                        │ │
│  │  ┌──────────┐ ┌────────────┐ ┌───────────────┐  │ │
│  │  │  KV      │ │ Durable    │ │ Secrets       │  │ │
│  │  │  (cache) │ │ Objects    │ │ (BPS_API_KEY  │  │ │
│  │  │          │ │ (sessions) │ │  for self-    │  │ │
│  │  │          │ │            │ │  deploy mode) │  │ │
│  │  └──────────┘ └────────────┘ └───────────────┘  │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 17.3 Cache Strategy: In-Memory vs KV

| Aspect | stdio (in-memory) | Workers (KV) |
|---|---|---|
| Persistence | Lost on restart | Persists across requests |
| Latency | ~0ms (same process) | ~1-5ms (edge cache hit) |
| Shared across requests | Yes (same process) | Yes (global KV store) |
| TTL support | Custom implementation | Built-in `expirationTtl` |
| Max size | Limited by memory | 25 MiB per value |
| Cost | Free | Free tier: 100K reads/day |

Cache interface:
```typescript
interface ICacheProvider {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

// stdio: InMemoryCache implements ICacheProvider
// Workers: KVCache implements ICacheProvider (wraps env.BPS_CACHE)
```

### 17.4 Deployment Options

**Option A: One-click deploy (recommended for ChatGPT/Gemini users)**
- "Deploy to Cloudflare" button di README
- User click → fork repo → auto-deploy ke akun CF mereka
- User set BPS_API_KEY sebagai secret via Wrangler
- Endpoint: `https://bps-mcp-server.{user}.workers.dev/mcp`

**Option B: Manual deploy (developers)**
```bash
git clone https://github.com/murphi/bps-mcp-server
cd bps-mcp-server
npm install
wrangler secret put BPS_API_KEY
wrangler deploy
```

**Option C: Shared public instance (demo/testing only)**
- Kita host satu instance publik untuk demo/testing
- User kirim key via `X-BPS-API-Key` header per request
- Rate limited, untuk trial only
- URL: `https://bps-mcp-demo.murphi.workers.dev/mcp`

### 17.5 Security Considerations untuk Remote

| Concern | Mitigation |
|---|---|
| API key in transit | HTTPS only (enforced by CF), key di header bukan URL |
| API key logging | Tidak di-log di Workers (explicitly excluded dari logs) |
| Abuse / DDoS | CF built-in DDoS protection + rate limiting |
| Unauthorized access | Authless: per-request key. OAuth: login required. |
| DNS rebinding | Origin header validation (MCP spec requirement) |
| CORS | Whitelist known MCP client origins |

---

## 18. Open Questions

1. **npm package name:** `bps-mcp-server` atau `@bps-statistics/mcp-server` (scoped)?
   - Recommendation: `bps-mcp-server` (simpler, no org needed)

2. **SDGs & SDDS endpoints:** Dokumentasi BPS API tidak detail untuk ini. Perlu explore manual.

3. **Statistical Classifications endpoint:** Ada di docs tapi belum jelas parameter lengkapnya.

4. **Searching endpoint:** Perlu test response format, belum ada sample response di docs.

5. **SIMDASI detail table response format:** Docs tidak menunjukkan sample response lengkap.

6. **Rate limits:** BPS tidak mendokumentasikan rate limit spesifik. Perlu test empiris dan implement conservative defaults.

7. **Workers: shared vs self-deploy model?** Apakah kita host public instance atau hanya provide self-deploy template? Recommendation: keduanya — public demo + self-deploy for production.

8. **Workers: `@cloudflare/agents` SDK vs raw MCP SDK?** Cloudflare punya Agents SDK yang lebih integrated dengan Workers ecosystem, tapi menambah vendor lock-in. Perlu evaluate trade-off.

9. **mcp-remote compatibility:** Untuk clients yang belum native support Streamable HTTP, perlu test `mcp-remote` bridge compatibility.

---

*Document version: 2.0 — Last updated: 2026-03-31*
*Changelog: v2.0 — Added dual transport (stdio + Streamable HTTP), Cloudflare Workers deployment, per-client connection guide, cache abstraction, remote ToU considerations.*
