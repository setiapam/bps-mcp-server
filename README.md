# BPS MCP Server

[![CI](https://github.com/murphi/bps-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/murphi/bps-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

MCP (Model Context Protocol) server untuk data statistik BPS (Badan Pusat Statistik) Indonesia. Memungkinkan AI clients seperti Claude Desktop, Claude Code, Cursor, dan lainnya untuk mengakses data statistik resmi Indonesia melalui natural language.

## Fitur

- **32 tools** mencakup seluruh endpoint BPS API v1
- **3 MCP Resources** — domain list, kabupaten per provinsi, subjek per domain
- **5 MCP Prompts** — template analisis data siap pakai
- **Domain resolver** dengan fuzzy matching (ketik "Jatim" → Jawa Timur)
- **Data formatter** yang mengubah raw BPS data menjadi format mudah dibaca
- **In-memory cache** dengan TTL per tipe data
- **Bilingual** — mendukung bahasa Indonesia dan Inggris
- **Atribusi BPS** otomatis di setiap response (sesuai ToU)
- **BYOK** (Bring Your Own Key) — setiap user menggunakan API key BPS sendiri

## Prasyarat

- Node.js ≥ 18
- API key BPS (gratis, daftar di [webapi.bps.go.id](https://webapi.bps.go.id))

## Instalasi & Penggunaan

### Via npx (recommended)

```bash
BPS_API_KEY=your_key npx bps-mcp-server
```

### Clone & Run

```bash
git clone https://github.com/murphi/bps-mcp-server
cd bps-mcp-server
npm install
npm run build
BPS_API_KEY=your_key npm start
```

## Akses Remote via Cloudflare Workers

Deploy sebagai serverless worker untuk akses remote tanpa instalasi Node.js lokal:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/setiapam/bps-mcp-server)

Lihat panduan lengkap di [docs/DEPLOY-WORKERS.md](docs/DEPLOY-WORKERS.md).

Setelah deploy, tambahkan ke MCP client via remote transport:

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

## Tools (32)

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
| `get_dynamic_data` | **Core** — Ambil data tabel dinamis |
| `list_static_tables` | Daftar tabel statis |
| `get_static_table` | Detail tabel statis (HTML) |
| `list_press_releases` | Daftar Berita Resmi Statistik (BRS) |
| `get_press_release` | Detail BRS |
| `list_publications` | Daftar publikasi |
| `get_publication` | Detail publikasi |
| `list_strategic_indicators` | Indikator strategis |
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
| `search` | Pencarian lintas tipe |
| `cache_clear` | Bersihkan cache |

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

## Contoh Query

```
"Berapa jumlah penduduk Indonesia tahun 2023?"
"Bandingkan angka kemiskinan Jawa Timur vs Jawa Barat 2020-2023"
"Cari BRS terbaru tentang inflasi"
"Data ekspor kopi Indonesia tahun 2024"
```

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

```bash
git clone https://github.com/murphi/bps-mcp-server
cd bps-mcp-server
npm install
npm run build
npm run test:unit
```

## Atribusi

Sumber: Badan Pusat Statistik (BPS) — https://www.bps.go.id
Layanan ini menggunakan API Badan Pusat Statistik (BPS).

## Lisensi

MIT
