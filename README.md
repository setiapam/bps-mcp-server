# BPS MCP Server

MCP (Model Context Protocol) server untuk data statistik BPS (Badan Pusat Statistik) Indonesia. Memungkinkan AI clients seperti Claude Desktop, Claude Code, Cursor, dan lainnya untuk mengakses data statistik resmi Indonesia melalui natural language.

## Fitur

- **20+ tools** mencakup seluruh endpoint BPS API v1
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

## Tools

| Tool | Deskripsi |
|------|-----------|
| `list_domains` | Daftar wilayah (provinsi, kab/kota) |
| `resolve_domain` | Konversi nama wilayah → kode domain |
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
| `list_press_releases` | Daftar Berita Resmi Statistik |
| `get_press_release` | Detail BRS |
| `list_publications` | Daftar publikasi |
| `get_publication` | Detail publikasi |
| `list_strategic_indicators` | Indikator strategis |
| `get_trade_data` | Data ekspor/impor |
| `search` | Pencarian lintas tipe |
| `cache_clear` | Bersihkan cache |

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

## Atribusi

Sumber: Badan Pusat Statistik (BPS) — https://www.bps.go.id
Layanan ini menggunakan API Badan Pusat Statistik (BPS).

## Lisensi

MIT
