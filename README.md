# BPS MCP Server

[![CI](https://github.com/setiapam/bps-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/setiapam/bps-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)

MCP (Model Context Protocol) server untuk data statistik BPS (Badan Pusat Statistik) Indonesia. Memungkinkan AI clients seperti Claude Desktop, Claude Code, Cursor, dan lainnya untuk mengakses data statistik resmi Indonesia melalui natural language.

## Fitur

- **39 tools** mencakup seluruh endpoint BPS WebAPI v1 + AllStats Search + AI-friendly shortcuts
- **Code Mode (Opsional)** — single tool `execute_bps_code` di sandbox **QuickJS WASM** dengan akses penuh ke seluruh 39 API `bps.*` (return JSON terstruktur + `Promise.all()`), menghemat ~80–85% token schema tool; tersedia lokal (`--code-mode`) maupun remote (`/mcp/code`)
- **AI-friendly** — tool `find_data` dengan intent detection otomatis (resolve wilayah → detect intent → cari variabel → ambil data)
- **Intent Detection** — otomatis detect: single value, comparison, trend, ranking, table/breakdown, publication
- **Stopwords-ISO** — noise removal otomatis untuk 758 kata Indonesia + 1298 kata Inggris
- **Static Table Fallback** — `find_data` otomatis fallback ke tabel statis jika dynamic data tidak tersedia (misal: data agama)
- **Result Hints** — setiap response include tips lanjutan yang actionable
- **Integrasi AllStats Search** — pencarian unified + full-text PDF search (tanpa API key)
- **Smart fallback** — WebAPI search otomatis fallback ke AllStats jika tidak ada hasil
- **3 MCP Resources** — domain list, kabupaten per provinsi, subjek per domain
- **5 MCP Prompts** — template analisis data siap pakai
- **Domain resolver** dengan fuzzy matching (ketik "Jatim" → Jawa Timur)
- **Data formatter** yang mengubah raw BPS data menjadi format mudah dibaca
- **Persistent learning store** — auto-learn variable mappings, survive restart (local by default; remote sync opt-in)
- **In-memory cache** dengan TTL per tipe data
- **Rate limiting** — 60 req/menit per API key (remote worker) + retry otomatis saat BPS membalas HTTP 429
- **Year-aware resolver** — tidak lagi diam-diam mengembalikan data tahun lama saat tahun yang diminta tidak tersedia
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

Server ini tersedia secara publik melalui dua endpoint:

| Endpoint | Mode | Keterangan |
|----------|------|------------|
| `https://bps-mcp-server.murphi.my.id/mcp` | **Standard Mode** (39 tools) | Berjalan penuh di Cloudflare Edge (100% online) |
| `https://bps-mcp-server.murphi.my.id/mcp/code` | **Code Mode** (`execute_bps_code`) | Hybrid Cloudflare Worker Free + sandbox QuickJS k3s (hemat token & dukung `Promise.all()`); bila backend maintenance, gunakan `/mcp` |

### Menggunakan di Claude.ai

1. Buka [claude.ai](https://claude.ai) → Settings → Integrations → Add custom connector
2. Masukkan:
   - **Name:** BPS Statistics (atau `BPS Code Mode`)
   - **URL:** `https://bps-mcp-server.murphi.my.id/mcp` (atau `/mcp/code` untuk Code Mode)
3. Claude akan membuka halaman otorisasi
4. Masukkan **BPS API key** Anda (gratis dari [webapi.bps.go.id](https://webapi.bps.go.id))
5. Klik "Otorisasi" — selesai!

Server menggunakan OAuth 2.1 sesuai MCP spec. API key Anda tersimpan aman di server dan tidak pernah terekspos ke client.

### Menggunakan di AI Client Lain (Remote MCP)

Untuk AI client yang mendukung remote MCP dengan OAuth (ChatGPT, Cursor remote, dll):

```
MCP Server URL (Standard):  https://bps-mcp-server.murphi.my.id/mcp
MCP Server URL (Code Mode): https://bps-mcp-server.murphi.my.id/mcp/code
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

> Untuk menggunakan **Code Mode** remote, cukup ganti `url` di atas menjadi `https://bps-mcp-server.murphi.my.id/mcp/code`.

### Self-hosted

Deploy sebagai serverless worker di akun Cloudflare kamu:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/setiapam/bps-mcp-server)

Lihat panduan lengkap di [docs/DEPLOY-WORKERS.md](docs/DEPLOY-WORKERS.md) dan panduan self-host **Code Mode (Hybrid Worker + k3s)** di [docs/DEPLOY-K3S-CODEMODE.md](docs/DEPLOY-K3S-CODEMODE.md).

> **Catatan:** Saat ini, BPS WebAPI (`https://webapi.bps.go.id`) sudah tidak memblokir request dari Cloudflare Workers, sehingga Anda dapat mengaksesnya **secara langsung** (tanpa proxy). Namun, **AllStats Search Engine** (`https://searchengine.web.bps.go.id`) masih diblokir oleh Cloudflare bot challenge. Jika Anda menggunakan Cloudflare Workers dan ingin menggunakan fitur AllStats Search/Deep Search, gunakan [bps-api-proxy](https://github.com/setiapam/bps-api-proxy) sebagai relay (deploy di server dengan IP residential) dan set `BPS_ALLSTATS_BASE_URL` di `wrangler.toml` ke URL proxy tersebut.

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

## Code Mode (`execute_bps_code`)

Selain mode standar (39 tools terpisah), server ini mendukung **Code Mode** — pola arsitektur di mana LLM menulis skrip JavaScript asinkron (ES2022+) terhadap API bertipe `bps.*` di dalam sandbox terisolasi **QuickJS WASM**, alih-alih memanggil banyak tool satu per satu.

### Keunggulan Code Mode
- **Hemat ~80–85% token schema:** hanya mendaftarkan **1 tool** (`execute_bps_code`) dengan deklarasi TypeScript ringkas (`declare const bps`), bukan 39 schema penuh setiap turn.
- **Komposisi & paralelisme dalam 1 langkah:** LLM dapat menggabungkan beberapa indikator/wilayah via `Promise.all([...])`, lalu memfilter, menghitung rasio, atau mengagregasi hasilnya di dalam sandbox sehingga hanya ringkasan akhir yang masuk ke konteks.
- **100% cakupan 39 tools sebagai JSON terstruktur:** seluruh tool — termasuk `bps.findData`, `bps.compareData`, `bps.getTrend`, `bps.getRanking`, `bps.getTradeData`, `bps.search`, `bps.allstatsSearch`, `bps.listGlossary`, serta helper `bps.help(methodName?)` — tersedia di namespace `bps.*` dan berbagi *source of truth* yang sama dengan mode standar.
- **Sandbox aman & terkendali:** setiap eksekusi berjalan di isolate QuickJS baru tanpa `fetch`, `fs`, `process`, `require`, atau `setTimeout`; dilengkapi batas default RAM `32 MB`, stack `512 KB`, timeout `25 detik`, maksimal `30` panggilan `bps.*`, dan output maksimal `50 KB`. Seluruh panggilan ke BPS tetap melewati `RequestScheduler` anti-429.

### Mengaktifkan Code Mode Secara Lokal (`stdio`)

Default CLI tetap mode standar (39 tools, 100% backward-compatible). Aktifkan Code Mode dengan flag `--code-mode` atau env `BPS_CODE_MODE=true` (atau `BPS_MODE=code`):

```bash
# Via npx
BPS_API_KEY=your_key npx -y bps-mcp-server --code-mode

# Via Claude Code
claude mcp add bps-code -- npx -y bps-mcp-server --code-mode
```

Konfigurasi Claude Desktop / Cursor / `.mcp.json`:

```json
{
  "mcpServers": {
    "bps-code": {
      "command": "npx",
      "args": ["-y", "bps-mcp-server", "--code-mode"],
      "env": {
        "BPS_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Contoh Skrip yang Dijalankan AI di `execute_bps_code`

```js
const [kemiskinan, tpt, kopi] = await Promise.all([
  bps.compareData({
    query: "persentase penduduk miskin",
    regions: ["Jawa Timur", "Jawa Barat"],
    years: "2021-2024",
  }),
  bps.getRanking({
    query: "pengangguran",
    level: "kabkota",
    provinces: ["Jawa Timur"],
    top_n: 5,
    order: "highest",
  }),
  bps.getTradeData({ commodity: "kopi", source: "ekspor", year: "2024" }),
]);

return {
  kemiskinan: kemiskinan.summary,
  top5PengangguranJatim: tpt.rows,
  top3TujuanEksporKopi: kopi.byCountry.slice(0, 3),
};
```

> Untuk deployment remote hybrid (**Cloudflare Worker Free `/mcp/code` → Cloudflare Tunnel → k3s Homelab**), lihat panduan lengkap di [docs/DEPLOY-K3S-CODEMODE.md](docs/DEPLOY-K3S-CODEMODE.md) dan arsitektur teknis di [docs/code-mode-plan.md](docs/code-mode-plan.md).

## Tools (39)

### AI-Friendly Smart Tools (5)

| Tool | Deskripsi |
|------|-----------|
| `find_data` | **Recommended** — Cari & ambil data dalam satu langkah (resolve wilayah + cari variabel + ambil data) |
| `find_variable` | Cari variabel data berdasarkan kata kunci |
| `compare_data` | Bandingkan data antar wilayah (2+ wilayah sekaligus dalam 1 panggilan) |
| `get_trend` | Ambil data time-series/tren multi-tahun dalam 1 panggilan |
| `get_ranking` | Ranking provinsi **atau kabupaten/kota** berdasarkan indikator (top-N, satu panggilan) |

> **Untuk AI:** Gunakan `find_data` untuk data 1 wilayah, `compare_data` untuk perbandingan, `get_trend` untuk tren, `get_ranking` untuk peringkat. Untuk peringkat kabupaten/kota pakai `get_ranking(level="kabkota")` — server menyapu tabel tiap provinsi sekaligus dan menyeragamkan tahun (BPS tidak punya tabel kab/kota nasional). Parameter `level` wajib diisi: `provinsi` atau `kabkota`. Jika hasilnya kurang spesifik, gunakan `find_variable` lalu `get_dynamic_data`.

### WebAPI Tools (32)

| Tool | Deskripsi |
|------|-----------|
| `list_domains` | Daftar wilayah (provinsi, kab/kota) |
| `resolve_domain` | Konversi nama wilayah → kode domain (fuzzy matching) |
| `list_subjects` | Daftar subjek data statistik |
| `list_subject_categories` | Kategori subjek |
| `list_variables` | Daftar variabel tabel dinamis |
| `list_vertical_variables` | Variabel vertikal (disagregasi) — semua halaman digabung, tidak terpotong 10 baris |
| `list_derived_variables` | Turunan variabel |
| `list_periods` | Periode data tersedia |
| `list_derived_periods` | Turunan periode |
| `list_units` | Satuan data |
| `get_dynamic_data` | **Core** — Ambil data tabel dinamis (butuh var_id); `format="json"` mengembalikan baris terstruktur |
| `list_static_tables` | Daftar tabel statis |
| `get_static_table` | Detail tabel statis (HTML) |
| `list_press_releases` | Daftar Berita Resmi Statistik (BRS) |
| `get_press_release` | Detail BRS |
| `list_publications` | Daftar publikasi |
| `get_publication` | Detail publikasi |
| `list_strategic_indicators` | Indikator strategis (headline data terbaru) |
| `get_trade_data` | Data ekspor/impor per bab HS 2 digit; bisa pakai nama komoditas ("kopi", "cpo", "batubara") |
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
| `list_glossary` | Glosarium istilah statistik (fallback otomatis ke definisi variabel saat endpoint glosarium BPS down) |
| `search` | Pencarian lintas tipe dalam satu panggilan (`type="all"` = tabel + publikasi + BRS sekaligus, fallback AllStats) |
| `cache_clear` | Bersihkan cache |

> **Catatan parameter BPS:** `get_trade_data` menerima kode HS 2-10 digit atau nama komoditas; WebAPI BPS hanya menyediakan data per bab 2 digit, jadi kode yang lebih panjang otomatis diturunkan ke babnya. `source`/`period` menerima `"1"/"2"` maupun `"ekspor"/"impor"` dan `"bulanan"/"tahunan"`.

### AllStats Search Tools (2)

| Tool | Deskripsi |
|------|-----------|
| `allstats_search` | Pencarian unified semua konten BPS (publikasi, tabel, BRS, infografis, data mikro, klasifikasi); urutan default `relevansi`, otomatis mencoba akar kata bila hasil nol |
| `allstats_deep_search` | Full-text search di dalam isi PDF publikasi BPS — **fitur unik, tidak tersedia di WebAPI** |

## Bagaimana AI Menggunakan Server Ini

```
User: "Berapa angka kemiskinan Indonesia 2023?"

AI menggunakan: find_data(query="penduduk miskin", region="Indonesia", year="2023")

Proses internal (otomatis):
0. Intent Detection: "single_value" → find_data
1. Resolve "Indonesia" → domain 0000
2. Normalize: "berapa angka kemiskinan" → "kemiskinan" (stopwords-iso)
3. Cari subjek relevan → "Kemiskinan dan Ketimpangan"
4. Cari variabel → "Jumlah Penduduk Miskin" (var_id: 183)
5. Resolve "2023" → period ID 123
6. Ambil data → 25,9 juta jiwa
7. Result hints: "💡 Gini rasio: get_dynamic_data(var="98")"

Jika find_data gagal, AI bisa:
- find_variable(keyword="miskin") → lihat variabel yang tersedia
- list_strategic_indicators() → data headline terbaru
- search(keyword="kemiskinan") → cari tabel/publikasi terkait

User: "Bandingkan kemiskinan Jawa Timur dan Jawa Barat"
AI menggunakan: compare_data(query="kemiskinan", regions="Jawa Timur, Jawa Barat")

User: "Tren pengangguran Indonesia 2019-2024"
AI menggunakan: get_trend(query="pengangguran", region="Indonesia", start_year="2019", end_year="2024")

User: "10 provinsi termiskin"
AI menggunakan: get_ranking(query="kemiskinan", top_n=10, order="highest", level="provinsi")

User: "10 kabupaten/kota dengan pengangguran tertinggi"
AI menggunakan: get_ranking(query="pengangguran", top_n=10, order="highest", level="kabkota")
→ Server menyapu tabel TPT kab/kota di seluruh provinsi (1 panggilan)
→ Default period_mode="common": semua angka diseragamkan ke tahun bersama terbaru
  (mis. 2025) agar sebanding; year="2024" untuk tahun lain, period_mode="latest"
  untuk periode terbaru tiap provinsi
→ Melaporkan provinsi yang tidak punya rincian kab/kota dan periode tiap baris

User: "Statistik pemeluk agama di Kab Jombang"
AI menggunakan: find_data(query="pemeluk agama", region="Kab Jombang")
→ Intent: "table" → find_data dengan static table fallback
→ Otomatis ambil tabel statis "Jumlah Penduduk Menurut Agama"
→ Result hints: "💡 Breakdown detail: list_static_tables(keyword="agama")"
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
"Statistik pemeluk agama di Kabupaten Klaten"
"Distribusi penduduk per kecamatan di Jakarta"
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
| `BPS_ALLSTATS_BASE_URL` | `https://searchengine.web.bps.go.id` | Base URL AllStats Search |
| `BPS_WORKER_URL` | (kosong) | **Opt-in.** URL worker untuk sinkronisasi learning lintas mesin. Jika diisi, API key Anda dikirim ke server tersebut. |
| `BPS_CODE_MODE` | `false` | Set `true` (atau `BPS_MODE=code` / flag `--code-mode`) untuk mengaktifkan Code Mode (`execute_bps_code`) di mode `stdio` |
| `BPS_DATA_DIR` | `~/.bps-mcp` | Direktori penyimpanan `learned-vars.json` (mis. `/data` untuk PVC di k3s) |
| `CODEMODE_MEMORY_LIMIT_MB` | `32` | Batas memori QuickJS WASM per eksekusi Code Mode |
| `CODEMODE_STACK_LIMIT_KB` | `512` | Batas ukuran stack QuickJS per eksekusi |
| `CODEMODE_TIMEOUT_MS` | `25000` | Timeout CPU & I/O per eksekusi Code Mode (ms) |
| `CODEMODE_MAX_CALLS` | `30` | Maksimum panggilan `bps.*` per eksekusi |
| `CODEMODE_MAX_OUTPUT_BYTES` | `51200` | Batas ukuran output JSON sebelum dipotong (`truncated: true`) |
| `CODEMODE_MAX_LOG_BYTES` | `4096` | Batas tangkapan `console.log/warn/error` |
| `CODEMODE_SHARED_SECRET` | *(wajib untuk HTTP)* | Secret header `X-CodeMode-Secret` untuk backend k3s (`src/http-server.ts`) & Worker proxy |
| `CODEMODE_MAX_CONCURRENT` | `8` | Maksimum request Code Mode paralel pada HTTP server k3s |

### Catatan Rate Limit BPS

BPS tidak mempublikasikan angka rate limit yang tetap. Batas dapat berbeda menurut token, endpoint, periode waktu, dan alamat IP (lihat [Ketentuan Penggunaan WebAPI BPS](https://webapi.bps.go.id/documentation)). Dalam pengujian, puluhan request cepat berturut-turut memicu `HTTP 429 Request rate limit exceeded`, lalu pulih setelah beberapa saat. Laporan komunitas (tidak resmi) menyebut sekitar **2 request/detik** dan sekitar **100 request/hari per key**; angka itu bisa berubah.

Server ini mengurangi risiko 429 dengan:

- cache respons per tipe data dan deduplikasi request identik;
- retry otomatis untuk 429/408/5xx dengan backoff (2s, 4s, 8s);
- pemecahan otomatis request multi-tahun karena BPS membatasi **maksimal 3 periode per request**;
- pesan error yang menyarankan menunggu 1–2 menit jika 429 tetap terjadi.

## Development

### Setup

```bash
git clone https://github.com/setiapam/bps-mcp-server
cd bps-mcp-server
npm install
```

### Build & Test

```bash
npm run build             # Compile TypeScript
npm run test:unit         # Run unit tests (238 tests)
npm run lint              # ESLint check
npm run typecheck         # TypeScript type check (Node/stdio/HTTP)
npm run typecheck:worker  # TypeScript type check (Cloudflare Worker)
npm run deploy:dry        # Verifikasi bundle Worker tanpa WASM
```

### Menjalankan Lokal

```bash
# Mode standar (39 tools)
BPS_API_KEY=your_key npm start

# Mode Code Mode (1 tool: execute_bps_code)
BPS_API_KEY=your_key npm run start:code

# HTTP Server Code Mode (untuk container / k3s)
CODEMODE_SHARED_SECRET=dev-secret npm run start:http

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
├── client/         # BPS WebAPI & AllStats HTTP clients + RequestScheduler
├── codemode/       # Code Mode (QuickJS WASM sandbox, normalizer, 39-method bps.* API)
│   ├── executor.ts          # CodeExecutor interface & env limits
│   ├── quickjs-executor.ts  # QuickJS WASM isolated sandbox + guardrails
│   ├── normalize-code.ts    # Fence strip, async wrapper, defensive TS strip
│   ├── bps-api.ts           # Registry 39 method bps.* + validasi Zod + bps.help()
│   ├── types-doc.ts         # Deklarasi TypeScript ringkas untuk execute_bps_code
│   └── server.ts            # Factory createCodeModeServer()
├── config/         # Configuration & defaults
├── prompts/        # MCP prompt templates
├── resources/      # MCP resources (domain lists)
├── services/       # Shared core services (smart, analysis, search, trade, glossary, cache, resolver)
├── tools/          # Standard MCP tool definitions (39 tools)
├── transport/      # stdio transport
├── utils/          # Logger, HTML parser, and error handling
├── index.ts        # CLI entry point (stdio; mendukung --code-mode)
├── http-server.ts  # Node.js Streamable HTTP Code Mode backend (k3s)
├── worker.ts       # Cloudflare Worker entry point (/mcp + /mcp/code proxy)
├── worker-mcp.ts   # Standard MCP handler di Cloudflare Edge
├── worker-codemode-proxy.ts # Pattern A proxy /mcp/code -> k3s via Cloudflare Tunnel
└── server.ts       # Standard MCP server factory
k8s/                # Manifest referensi k3s (Deployment, Service, PVC, NetworkPolicy)
Dockerfile          # Multi-stage container image untuk Code Mode HTTP backend
```

## Dukungan & Donasi

Project ini dikembangkan secara independen dan seluruh infrastruktur cloud hosting (termasuk server proxy BPS, Cloudflare Worker, database token OAuth, dll.) ditanggung secara **pribadi**. 

Jika Anda terbantu dengan project ini dan ingin mendukung agar server remote tetap menyala secara gratis serta pembangunannya tetap lancar, Anda dapat memberikan dukungan melalui platform berikut:

* **Untuk Donasi Lokal (Indonesia):**
  * [Saweria](https://saweria.co/setiapam)
* **Untuk Donasi Internasional:**
  * [GitHub Sponsors](https://github.com/sponsors/setiapam)

## Atribusi

Sumber: Badan Pusat Statistik (BPS) — https://www.bps.go.id
Layanan ini menggunakan API Badan Pusat Statistik (BPS).

## Lisensi

MIT
