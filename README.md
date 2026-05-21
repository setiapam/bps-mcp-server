# BPS MCP Server

[![CI](https://github.com/setiapam/bps-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/setiapam/bps-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)

MCP (Model Context Protocol) server untuk data statistik BPS (Badan Pusat Statistik) Indonesia. Memungkinkan AI clients seperti Claude Desktop, Claude Code, Cursor, dan lainnya untuk mengakses data statistik resmi Indonesia melalui natural language.

## Fitur

- **39 tools** mencakup seluruh endpoint BPS WebAPI v1 + AllStats Search + AI-friendly shortcuts
- **AI-friendly** — tool `find_data` memungkinkan AI mendapat data dalam 1 langkah (tanpa perlu navigasi hierarki BPS)
- **Integrasi AllStats Search** — pencarian unified + full-text PDF search (tanpa API key)
- **Smart fallback** — WebAPI search otomatis fallback ke AllStats jika tidak ada hasil
- **3 MCP Resources** — domain list, kabupaten per provinsi, subjek per domain
- **5 MCP Prompts** — template analisis data siap pakai
- **Domain resolver** dengan fuzzy matching (ketik "Jatim" → Jawa Timur)
- **Data formatter** yang mengubah raw BPS data menjadi format mudah dibaca
- **In-memory cache** dengan TTL per tipe data
- **Rate limiting** — 60 req/menit per API key (remote worker)
- **Bilingual** — error messages dan response mendukung bahasa Indonesia dan Inggris
- **Atribusi BPS** otomatis di setiap response (sesuai ToU)
- **BYOK** (Bring Your Own Key) — setiap user wajib menggunakan API key BPS sendiri

## Prasyarat

- Node.js ≥ 22
- API key BPS (gratis, daftar di [webapi.bps.go.id](https://webapi.bps.go.id))

## Quick Start

### Via npx (recommended)

```bash
BPS_API_KEY=your_key npx bps-mcp-server
```

### Clone & Run

```bash
git clone https://github.com/setiapam/bps-mcp-server
cd bps-mcp-server
npm install
npm run build
BPS_API_KEY=your_key npm start
```

## Akses Remote via Cloudflare Workers

Server ini tersedia secara publik di:

```
https://bps-mcp-server.murphi.my.id/mcp
```

### Menggunakan di Claude.ai

1. Buka [claude.ai](https://claude.ai) → Settings → Integrations → Add custom connector
2. Masukkan:
   - **Name:** BPS Statistics
   - **URL:** `https://bps-mcp-server.murphi.my.id/mcp`
3. Claude akan membuka halaman otorisasi
4. Masukkan **BPS API key** Anda (gratis dari [webapi.bps.go.id](https://webapi.bps.go.id))
5. Klik "Otorisasi" — selesai!

Server menggunakan OAuth 2.1 sesuai MCP spec. API key Anda tersimpan aman di server dan tidak pernah terekspos ke client.

### Menggunakan di AI Client Lain (Remote MCP)

Untuk AI client yang mendukung remote MCP dengan OAuth (ChatGPT, Cursor remote, dll):

```
MCP Server URL: https://bps-mcp-server.murphi.my.id/mcp
```

Client akan otomatis melakukan OAuth flow — user hanya perlu memasukkan BPS API key saat halaman otorisasi muncul.

### Menggunakan dengan Custom Headers (tanpa OAuth)

Untuk client yang mendukung custom headers (Claude Desktop, Cursor lokal):

```json
{
  "mcpServers": {
    "bps-statistics": {
      "type": "http",
      "url": "https://bps-mcp-server.murphi.my.id/mcp",
      "headers": {
        "X-BPS-API-Key": "your_api_key_here"
      }
    }
  }
}
```

### Self-hosted

Deploy sebagai serverless worker di akun Cloudflare kamu:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/setiapam/bps-mcp-server)

Lihat panduan lengkap di [docs/DEPLOY-WORKERS.md](docs/DEPLOY-WORKERS.md).

> **Catatan:** Jika deploy di Cloudflare Workers, BPS API tidak bisa diakses langsung karena Cloudflare bot detection memblokir request antar-Cloudflare. Gunakan [bps-api-proxy](https://github.com/setiapam/bps-api-proxy) sebagai relay — deploy di server dengan IP residential (homelab, VPS non-cloud, dll) dan set `BPS_API_BASE_URL` ke URL proxy.

## Konfigurasi MCP Client

### Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

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

### Claude Code

```bash
claude mcp add bps -- npx -y bps-mcp-server
```

Atau file `.mcp.json` di project root:

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

### Cursor / VS Code

File `~/.cursor/mcp.json` atau `.vscode/mcp.json`:

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

## Tools (39)

### AI-Friendly Smart Tools (5)

| Tool | Deskripsi |
|------|-----------|
| `find_data` | **Recommended** — Cari & ambil data dalam satu langkah (resolve wilayah + cari variabel + ambil data) |
| `find_variable` | Cari variabel data berdasarkan kata kunci |
| `compare_data` | Bandingkan data antar wilayah (2+ wilayah sekaligus dalam 1 panggilan) |
| `get_trend` | Ambil data time-series/tren multi-tahun dalam 1 panggilan |
| `get_ranking` | Ranking/peringkat provinsi berdasarkan indikator (top-N) |

> **Untuk AI:** Gunakan `find_data` untuk data 1 wilayah, `compare_data` untuk perbandingan, `get_trend` untuk tren, `get_ranking` untuk peringkat. Jika hasilnya kurang spesifik, gunakan `find_variable` lalu `get_dynamic_data`.

### WebAPI Tools (32)

| Tool | Deskripsi |
|------|-----------|
| `list_domains` | Daftar wilayah (provinsi, kab/kota) |
| `resolve_domain` | Konversi nama wilayah → kode domain (fuzzy matching) |
| `list_subjects` | Daftar subjek data statistik |
| `list_subject_categories` | Kategori subjek |
| `list_variables` | Daftar variabel tabel dinamis |
| `list_vertical_variables` | Variabel vertikal (disagregasi) |
| `list_derived_variables` | Turunan variabel |
| `list_periods` | Periode data tersedia |
| `list_derived_periods` | Turunan periode |
| `list_units` | Satuan data |
| `get_dynamic_data` | **Core** — Ambil data tabel dinamis (butuh var_id) |
| `list_static_tables` | Daftar tabel statis |
| `get_static_table` | Detail tabel statis (HTML) |
| `list_press_releases` | Daftar Berita Resmi Statistik (BRS) |
| `get_press_release` | Detail BRS |
| `list_publications` | Daftar publikasi |
| `get_publication` | Detail publikasi |
| `list_strategic_indicators` | Indikator strategis (headline data terbaru) |
| `get_trade_data` | Data ekspor/impor berdasarkan kode HS |
| `list_infographics` | Daftar infografis BPS |
| `get_infographic` | Detail infografis |
| `list_news` | Daftar berita BPS |
| `get_news` | Detail berita |
| `list_census_events` | Daftar kegiatan sensus |
| `list_census_topics` | Topik data per kegiatan sensus |
| `list_csa_categories` | Kategori CSA |
| `list_csa_subjects` | Subjek CSA per domain |
| `list_csa_tables` | Tabel CSA per subjek |
| `get_csa_table` | Detail tabel CSA (HTML) |
| `list_glossary` | Glosarium istilah statistik |
| `search` | Pencarian lintas tipe (WebAPI + AllStats fallback) |
| `cache_clear` | Bersihkan cache |

### AllStats Search Tools (2)

| Tool | Deskripsi |
|------|-----------|
| `allstats_search` | Pencarian unified semua konten BPS (publikasi, tabel, BRS, infografis, data mikro, glosarium, klasifikasi) |
| `allstats_deep_search` | Full-text search di dalam isi PDF publikasi BPS — **fitur unik, tidak tersedia di WebAPI** |

## Bagaimana AI Menggunakan Server Ini

```
User: "Berapa angka kemiskinan Indonesia 2023?"

AI menggunakan: find_data(query="penduduk miskin", region="Indonesia", year="2023")

Proses internal (otomatis):
1. Resolve "Indonesia" → domain 0000
2. Cari subjek relevan → "Kemiskinan dan Ketimpangan"
3. Cari variabel → "Jumlah Penduduk Miskin" (var_id: 183)
4. Resolve "2023" → period ID 123
5. Ambil data → 25,9 juta jiwa

Jika find_data gagal, AI bisa:
- find_variable(keyword="miskin") → lihat variabel yang tersedia
- list_strategic_indicators() → data headline terbaru
- search(keyword="kemiskinan") → cari tabel/publikasi terkait

User: "Bandingkan kemiskinan Jawa Timur dan Jawa Barat"
AI menggunakan: compare_data(query="kemiskinan", regions="Jawa Timur, Jawa Barat")

User: "Tren pengangguran Indonesia 2019-2024"
AI menggunakan: get_trend(query="pengangguran", region="Indonesia", start_year="2019", end_year="2024")

User: "10 provinsi termiskin"
AI menggunakan: get_ranking(query="kemiskinan", top_n=10, order="highest")
```

## Contoh Query

```
"Berapa jumlah penduduk miskin Indonesia tahun 2023?"
"Bandingkan angka kemiskinan Jawa Timur vs Jawa Barat 2020-2023"
"Tren pengangguran Indonesia dari 2019 sampai 2024"
"10 provinsi dengan kemiskinan tertinggi"
"Peringkat IPM seluruh provinsi 2023"
"Cari BRS terbaru tentang inflasi"
"Data ekspor kopi Indonesia tahun 2024"
"Cari publikasi tentang statistik telekomunikasi"
"Cari teks tentang akses internet di dalam publikasi BPS"
"Berapa IPM Jawa Timur?"
"Pertumbuhan ekonomi Indonesia triwulan terakhir"
```

## Resources (3)

| URI | Deskripsi |
|-----|-----------|
| `bps://domains/provinces` | Daftar seluruh provinsi Indonesia (cached) |
| `bps://domains/regencies/{prov_id}` | Kabupaten/kota per provinsi |
| `bps://subjects/{domain}` | Subjek statistik per domain |

## Prompts (5)

| Prompt | Deskripsi |
|--------|-----------|
| `compare_regions` | Bandingkan data antara dua wilayah |
| `trend_analysis` | Analisis tren data multi-tahun |
| `poverty_profile` | Profil kemiskinan suatu wilayah |
| `economic_overview` | Ringkasan ekonomi wilayah |
| `population_stats` | Statistik kependudukan |

## Environment Variables

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `BPS_API_KEY` | (required) | API key dari webapi.bps.go.id |
| `BPS_API_BASE_URL` | `https://webapi.bps.go.id/v1` | Base URL API |
| `BPS_DEFAULT_LANG` | `ind` | Bahasa default: `ind` / `eng` |
| `BPS_DEFAULT_DOMAIN` | `0000` | Domain default (0000 = Nasional) |
| `BPS_CACHE_ENABLED` | `true` | Aktifkan cache |
| `BPS_CACHE_MAX_ENTRIES` | `500` | Maks entri cache |
| `BPS_LOG_LEVEL` | `info` | Level log: debug/info/warn/error |

## Development

### Setup

```bash
git clone https://github.com/setiapam/bps-mcp-server
cd bps-mcp-server
npm install
```

### Build & Test

```bash
npm run build          # Compile TypeScript
npm run test:unit      # Run unit tests (76 tests)
npm run lint           # ESLint check
npm run typecheck      # TypeScript type check
```

### Menjalankan Lokal

```bash
# Dengan environment variable
BPS_API_KEY=your_key npm start

# Atau buat file .env (lihat .env.example)
cp .env.example .env
# Edit .env, isi BPS_API_KEY
npm start
```

### Testing dengan MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) memungkinkan kamu menguji tools secara interaktif:

```bash
# Install dan jalankan inspector
npx @modelcontextprotocol/inspector

# Di inspector UI:
# 1. Transport: stdio
# 2. Command: node
# 3. Args: dist/index.js
# 4. Env: BPS_API_KEY=your_key
```

Atau test langsung via stdin (tanpa inspector):

```bash
# Test initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | BPS_API_KEY=your_key node dist/index.js

# Test find_data
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"find_data","arguments":{"query":"inflasi","region":"Indonesia"}}}\n' | BPS_API_KEY=your_key node dist/index.js
```

### Testing Remote Worker (Lokal)

```bash
# Jalankan worker secara lokal
npm run dev:worker

# Test di terminal lain
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-BPS-API-Key: your_key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

### Struktur Project

```
src/
├── auth/           # API key & OAuth2 providers
├── client/         # BPS WebAPI & AllStats HTTP clients
├── config/         # Configuration & defaults
├── prompts/        # MCP prompt templates
├── resources/      # MCP resources (domain lists)
├── services/       # Cache, domain resolver, data formatter
├── tools/          # MCP tool definitions (39 tools)
│   ├── smart.tools.ts      # find_data, find_variable (AI shortcuts)
│   ├── analysis.tools.ts   # compare_data, get_trend, get_ranking
│   ├── dynamic-data.tools.ts  # Core data tools
│   ├── search.tools.ts     # Search with AllStats fallback
│   ├── allstats.tools.ts   # AllStats search & deep search
│   └── ...                  # Domain, publication, trade, etc.
├── transport/      # stdio transport
├── utils/          # Logger, error handling, pagination
├── index.ts        # CLI entry point (stdio)
├── worker.ts       # Cloudflare Worker entry point (HTTP)
└── server.ts       # MCP server factory
```

## Atribusi

Sumber: Badan Pusat Statistik (BPS) — https://www.bps.go.id
Layanan ini menggunakan API Badan Pusat Statistik (BPS).

## Lisensi

MIT
