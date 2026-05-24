# Smart Tools — Detail Logic & Implementasi

Dokumentasi lengkap logic internal smart tools. Setiap tool bukan sekadar wrapper BPS WebAPI — ada intelligence layer untuk mengatasi inkonsistensi dan kompleksitas struktur data BPS.

## Daftar Isi

1. [find_data](#find_data) — Cari & ambil data dalam 1 langkah
2. [get_trend](#get_trend) — Tren multi-tahun
3. [compare_data](#compare_data) — Perbandingan antar wilayah
4. [get_ranking](#get_ranking) — Peringkat provinsi
5. [Helper Functions](#helper-functions) — Fungsi-fungsi pendukung

---

## find_data

**File:** `src/tools/smart.tools.ts`  
**Fungsi:** `registerSmartTools` → tool "find_data"

### Tujuan

Menggabungkan 5-9 langkah API menjadi 1 tool call: resolve wilayah → cari variabel → resolve periode → ambil data → format.

### Parameter

| Param | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `query` | string | required | Deskripsi data (misal: "kemiskinan", "IPM", "pengangguran") |
| `region` | string | "Indonesia" | Nama wilayah (fuzzy matching) |
| `year` | string? | - | Tahun, bisa multi: "2023" atau "2020,2021,2022" |

### Flow Detail

```
┌─ Step 0: Intent Detection ───────────────────────────────────┐
│ detectIntent(query, region, year)                             │
│                                                               │
│ Pattern matching untuk 6 intent:                             │
│ - single_value: default                                      │
│ - comparison: "bandingkan", "vs", "antara X dan Y"           │
│ - trend: "tren", "2019-2024", "dari...sampai"                │
│ - ranking: "peringkat", "10 provinsi termiskin"              │
│ - table: "pemeluk agama", "per kecamatan", "distribusi"      │
│ - publication: "publikasi", "BRS", "cari teks di dalam"      │
│                                                               │
│ Auto-extract params:                                         │
│ - Year range: "2019-2024" → {year: "2019,2024"}             │
│ - Comparison: "antara jatim dan jabar" → {region1, region2}  │
│                                                               │
│ Output: {intent, confidence, suggestedTool, hints}           │
└───────────────────────────────────────────────────────────────┘
          │
          ▼
┌─ Step 1: Resolve Domain ─────────────────────────────────────┐
│ Input: region="Jawa Timur"                                    │
│ → DomainResolver.resolve("Jawa Timur")                        │
│ → Fuzzy match (Levenshtein + alias: "Jatim"→"Jawa Timur")    │
│ → Output: domain="3500", domainName="Jawa Timur"             │
└───────────────────────────────────────────────────────────────┘
          │
          ▼
┌─ Step 2: Find Variable (3-Layer Lookup) ─────────────────────┐
│                                                               │
│ Layer 1: KNOWN_VARS (hardcoded, 0 I/O)                       │
│   normalizeKeyword("angka kemiskinan") → "kemiskinan"         │
│   resolveCanonical("kemiskinan") → "miskin"                   │
│   KNOWN_VARS["miskin"] → var_id 184 ✓ (hanya domain 0000)    │
│                                                               │
│ Layer 2: Persistent Store (1 read I/O)                        │
│   store.get("miskin:3500") → {var_id:184, title:...}          │
│                                                               │
│ Layer 3: Full Search (5-9 HTTP calls)                         │
│   → getSubjectIdsForKeyword("miskin") → [23]                 │
│   → listSubjects(3500) → match title → more subject IDs      │
│   → listVariables per subject (max 5 subjects)               │
│   → computeRelevanceScore() per variabel                     │
│   → Sort by score, return best                               │
│   → learnVar() → simpan ke store untuk next time             │
│                                                               │
│ Fallback 1: Strategic Indicators                              │
│   Jika Layer 1-3 gagal → cek list_strategic_indicators       │
│   Match keyword terhadap title indikator strategis            │
│                                                               │
│ Fallback 2: Static Tables                                    │
│   Jika Strategic Indicators gagal → list_static_tables(kw)   │
│   Pick best match → get_static_table() → return HTML table   │
│   (Ini yang menangani query seperti "pemeluk agama")         │
└───────────────────────────────────────────────────────────────┘
          │
          ▼
┌─ Step 3: Resolve Period ─────────────────────────────────────┐
│ Input: var_id=184, domain="3500", year="2023"                │
│                                                               │
│ 1. Check period store: lookupPeriod(184, "3500", "2023")     │
│    → Hit: return "123" (0 HTTP calls)                        │
│                                                               │
│ 2. Miss: listPeriods(3500, 184)                              │
│    → Filter: th_name.includes("2023") → th_id=123            │
│    → learnPeriod(184, "3500", "2023", "123")                 │
│    → Return "123"                                            │
│                                                               │
│ 3. Tanpa year: ambil periods[0] (terbaru)                    │
└───────────────────────────────────────────────────────────────┘
          │
          ▼
┌─ Step 4: Get Data ───────────────────────────────────────────┐
│ getDynamicData("3500", "184", "123")                         │
│                                                               │
│ Self-Healing:                                                │
│ Jika datacontent kosong DAN var dari learning store:          │
│   → invalidateVar("miskin", "3500")                          │
│   → invalidatePeriod(184, "3500", "2023")                    │
│   → Retry: fullSearchVar() → resolvePeriod() → getData()    │
│                                                               │
│ Fallback untuk kab/kota (4 digit, tidak berakhir "00"):      │
│   → Hitung parent: domain.slice(0,2)+"00" (3517→3500)       │
│   → lookupVar/fullSearchVar di parent domain                 │
│   → Fetch data dari parent domain                            │
│   → Return dengan note "Data dari provinsi induk"            │
│                                                               │
│ Fallback static table (jika dynamic data tetap kosong):      │
│   → list_static_tables(domain, kw)                           │
│   → Pick best match → get_static_table() → return            │
└───────────────────────────────────────────────────────────────┘
          │
          ▼
┌─ Step 5: Format & Return ────────────────────────────────────┐
│ formatDynamicData(result, domain, lang)                       │
│ → Decode datacontent keys (vervar+var+turvar+period)         │
│ → Build readable table                                       │
│ → Append BPS attribution                                     │
│ → Generate result hints (generateResultHints)                │
│                                                               │
│ Result Hints:                                                │
│ - Untuk kab/kota: "💡 Data provinsi: find_data(...)"         │
│ - Untuk agama: "💡 Breakdown: list_static_tables(...)"       │
│ - Untuk miskin: "💡 Gini rasio: get_dynamic_data(var="98")"  │
│ - Untuk pengangguran: "💡 TPak: find_variable(...)"          │
│                                                               │
│ Success → learnVar() (simpan mapping untuk next time)        │
└───────────────────────────────────────────────────────────────┘
```

### Relevance Scoring (`computeRelevanceScore`)

Ketika full search menemukan banyak variabel, scoring menentukan mana yang paling relevan:

```
+100  exact phrase match di title ("penduduk miskin" ada di title)
+50   title dimulai dengan query
+40   bonus jika SEMUA kata query match
+30   per kata yang match di title
+20   title mengandung "tingkat"/"persentase"/"jumlah" (indikator utama)
+15   per kata yang match di sub_name
+15   title pendek (<60 char, lebih general)
-15   title punya >1 "menurut" (breakdown, kurang berguna)
-20   title panjang (>100 char, terlalu spesifik)

Heuristik khusus:
+40   query="miskin" + title="persentase" (prefer persentase)
+40   query="jumlah miskin" + title="jumlah" (respect "jumlah" keyword)
+50   query="agama" + title="menurut agama" (prefer agama breakdown)
+30   query="agama" + title="jumlah"/"penduduk"
+60   query minta kab/kota + title mengandung "kabupaten"
```

### HTTP Calls Summary

| Skenario | HTTP Calls |
|----------|-----------|
| Known var + known period (warm) | 1 |
| Known var + unknown period | 2 |
| Unknown var (cold) | 5-9 (lalu learn) |
| Repeat query (setelah learn) | 1-2 |

---

## get_trend

**File:** `src/tools/analysis.tools.ts`  
**Fungsi:** `registerAnalysisTools` → tool "get_trend"

### Tujuan

Ambil data time-series untuk satu wilayah dalam rentang tahun tertentu, format sebagai tabel tren dengan persentase perubahan.

### Parameter

| Param | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `query` | string | required | Indikator (misal: "IPM", "kemiskinan") |
| `region` | string | "Indonesia" | Nama wilayah |
| `start_year` | string | "2019" | Tahun awal |
| `end_year` | string | "2024" | Tahun akhir |

### Flow Detail

```
┌─ Step 1: Resolve Domain ─────────────────────────────────────┐
│ Sama dengan find_data Step 1                                  │
│ "Indonesia" → "0000", "Jawa Timur" → "3500"                  │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Step 2: Resolve Variable ───────────────────────────────────┐
│ resolveVariable(client, store, "IPM", "0000")                │
│ → lookupVar() → KNOWN_VARS["ipm"] → var_id 413              │
│                                                               │
│ Jika miss → full search dengan:                              │
│   - Synonym expansion: "ipm" → ["ipm","pembangunan manusia"] │
│   - Variable scoring (prefer non-lama, prefer aggregate)     │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Step 3: Get Periods ────────────────────────────────────────┐
│ listPeriods("0000", 413)                                     │
│ → [{th_id:119, th:"2019"}, {th_id:120, th:"2020"}, ...]     │
│                                                               │
│ Build yearToPeriod map:                                      │
│   "2019"→"119", "2020"→"120", ..., "2024"→"124"             │
│                                                               │
│ ⚠️ FALLBACK: Jika periods kosong:                            │
│   → invalidateVar("IPM", "0000", store)                      │
│   → resolveVariableFullSearch() — cari var lain              │
│   → listPeriods() lagi dengan var baru                       │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Step 4: Fetch Data (Multi-Period) ──────────────────────────┐
│ getDynamicData("0000", "413", "119,120,121,122,123,124")     │
│                                                               │
│ Response berisi:                                             │
│ - datacontent: {"999941301190": 71.92, ...} (ratusan entry)  │
│ - tahun: [{val:119, label:"2019"}, ...]                      │
│ - vervar: [{val:1100, label:"ACEH"}, ..., {val:9999,...}]    │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Step 5: Parse Datacontent — CRITICAL LOGIC ─────────────────┐
│                                                               │
│ 5a. Build period label map dari response.tahun               │
│     {119: "2019", 120: "2020", ..., 124: "2024"}            │
│                                                               │
│ 5b. Find aggregate vervar                                    │
│     Prioritas:                                               │
│     1. vervar "9999" atau label contains "indonesia"         │
│     2. vervar dengan label <b>...</b> (bold = aggregate)     │
│                                                               │
│ 5c. Filter datacontent                                       │
│     - Hanya ambil keys yang mengandung aggregate vervar      │
│     - Contoh: filter keys containing "9999"                  │
│       "999941301190" ✓ (INDONESIA, 2019)                     │
│       "110041301190" ✗ (ACEH, 2019)                          │
│                                                               │
│ 5d. Match period IDs — LONGEST FIRST                         │
│     Sort period IDs: ["124","123","122","121","120","119"]    │
│     (longest first untuk hindari collision)                   │
│                                                               │
│     Problem tanpa longest-first:                             │
│       key "999941301120" contains "120" → match period 120   │
│       TAPI juga contains "112" → false match period 112!     │
│                                                               │
│     Dengan longest-first:                                    │
│       "124" dicek duluan → match "...1240" → 2024            │
│       "123" dicek → match "...1230" → 2023                   │
│       dst.                                                   │
│                                                               │
│ 5e. Filter year range                                        │
│     Hanya simpan data dalam range start_year..end_year       │
│     (API mungkin return lebih banyak periode)                │
│                                                               │
│ 5f. Deduplicate                                              │
│     Satu tahun = satu nilai (ambil match pertama)            │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Step 6: Format Output ──────────────────────────────────────┐
│ Sort by year ascending                                       │
│ Hitung perubahan (%) per tahun: (current-prev)/prev * 100    │
│ Hitung total tren: (last-first)/first * 100                  │
│                                                               │
│ Output:                                                      │
│ | Tahun | Nilai | Perubahan |                                │
│ | 2019  | 71,92 | -         |                                │
│ | 2020  | 71,94 | +0.0%     |                                │
│ | 2024  | 74,2  | +0.9%     |                                │
│ Tren: naik 3.2% dari 2019 ke 2024                           │
└───────────────────────────────────────────────────────────────┘
```

### Datacontent Key Format

BPS datacontent key adalah concatenated numeric IDs:

```
Key: "999941301240"
      ├──┤├─┤├┤├─┤├┤
      │    │  │  │  └─ trailing (biasanya 0)
      │    │  │  └──── period_id (124 = 2024)
      │    │  └─────── turvar (0 = tidak ada turunan)
      │    └────────── var_id (413)
      └─────────────── vervar (9999 = INDONESIA)
```

**Catatan:** Format ini tidak didokumentasikan resmi oleh BPS. Ditemukan dari reverse-engineering response API. Panjang tiap segment bisa bervariasi tergantung jumlah digit ID.

### Kenapa Perlu Longest-First Matching

```
Period IDs: 112, 119, 120, 121, 122, 123, 124

Key "999941301120" (seharusnya period 112, tahun 2012):
  - contains("120") → TRUE (false positive! match period 120 = 2020)
  - contains("112") → TRUE (correct match)

Dengan sort longest-first dan break setelah match pertama:
  - "124" → not found
  - "123" → not found
  - "122" → not found
  - "121" → not found
  - "120" → found! → WRONG (ini sebenarnya period 112)

SOLUSI: Sort response period IDs (bukan request period IDs) longest-first.
Karena semua period IDs di response punya panjang sama (3 digit),
kita filter berdasarkan year range di step 5e sebagai safety net.
```

---

## compare_data

**File:** `src/tools/analysis.tools.ts`  
**Fungsi:** `registerAnalysisTools` → tool "compare_data"

### Tujuan

Bandingkan satu indikator antara 2+ wilayah. Setiap wilayah di-resolve dan di-fetch secara independen.

### Parameter

| Param | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `query` | string | required | Indikator (misal: "IPM", "pengangguran") |
| `regions` | string | required | Nama wilayah dipisah koma |
| `year` | string? | - | Tahun data |

### Flow Detail

```
┌─ Per Wilayah: fetchDataForDomain() ──────────────────────────┐
│                                                               │
│ Input: query="pengangguran", domain="3600", year="2024"      │
│                                                               │
│ 1. resolveVariable(client, store, "pengangguran", "3600")    │
│    → lookupVar() → check store                               │
│    → Jika miss: full search di subject 6 (Tenaga Kerja)      │
│    → Scoring: prefer "Kabupaten/Kota" variant                │
│    → Return: var_id=157 "TPT Menurut Kabupaten/Kota"         │
│                                                               │
│ 2. listPeriods("3600", 157)                                  │
│    → Cari period yang label-nya contains "2024"              │
│                                                               │
│    ⚠️ FALLBACK 1: Jika periods kosong                        │
│    → invalidateVar() → resolveVariableFullSearch()            │
│                                                               │
│    ⚠️ FALLBACK 2: Jika tahun tidak ditemukan di periods      │
│    → invalidateVar() → resolveVariableFullSearch()            │
│    → listPeriods() lagi, cari tahun di var baru              │
│                                                               │
│ 3. getDynamicData("3600", "157", periodParam)                │
│                                                               │
│ 4. Extract AGGREGATE value dari datacontent                  │
│    → Cari aggregate vervar:                                  │
│      a. "9999" atau label "indonesia" (nasional)             │
│      b. domain[0:2]+"99" (misal "3699" untuk domain 3600)   │
│      c. label startsWith "<b>" (bold = aggregate)            │
│      d. label contains "provinsi"                            │
│    → Filter datacontent keys yang mengandung aggregate ID    │
│    → Ambil nilai pertama yang match                          │
│    → Fallback: values[0] jika tidak ada aggregate            │
│                                                               │
│ 5. Return: { value: "6,68 persen", varTitle: "TPT..." }      │
└───────────────────────────────────────────────────────────────┘
```

### Variable Scoring (dalam `resolveVariable`)

Ketika ada multiple variabel yang match keyword, scoring menentukan pilihan:

```typescript
score(variable) = {
  +10  jika title contains "metode lama"        // HINDARI
  +5   jika title contains "golongan umur"      // disagregasi
  +5   jika title contains "lapangan usaha"     // disagregasi
  +5   jika title contains "klasifikasi"        // disagregasi
  +5   jika title contains "pendidikan tertinggi" // disagregasi
  -2   jika title contains "metode baru"        // PREFER
  -3   jika title contains "kabupaten"          // punya aggregate
  -3   jika title contains "provinsi"           // punya aggregate
}
// Sort ascending (score rendah = lebih baik)
```

**Mengapa disagregasi di-deprioritize:**

Variabel "TPT Menurut Golongan Umur" punya vervar: 15-19, 20-24, 25-29, ..., Jumlah.
- Nilai pertama (15-19) = 38.85% (sangat tinggi, bukan TPT provinsi!)
- Aggregate "Jumlah" ada tapi bukan entry pertama

Variabel "TPT Menurut Kabupaten/Kota" punya vervar: Kab A, Kab B, ..., Provinsi X.
- Entry "Provinsi X" (vervar 3699) = 6.68% (benar!)
- Bisa dideteksi via pattern domain+"99"

### Aggregate Vervar Detection

```
Domain 0000 (Nasional):
  → vervar "9999" dengan label "<b>INDONESIA</b>"

Domain 3500 (Jawa Timur):
  → vervar "35000" dengan label "Jawa Timur"
  → ATAU vervar "3599" (pattern: domain[0:2] + "99")
  → ATAU vervar dengan label "<b>JAWA TIMUR</b>"

Domain 3600 (Banten):
  → vervar "3699" dengan label "Provinsi Banten"
  → Pattern: "36" + "99" = "3699"
```

Detection logic (prioritas):
1. ID = "9999" atau label contains "indonesia"
2. ID = `domain.slice(0,2) + "99"` (misal "3699")
3. ID = `domain.slice(0,4) + "0"` (misal "35000")
4. Label startsWith `<b>` (bold)
5. Label contains "provinsi"

### Unit Filtering

BPS kadang mengisi unit dengan "Tidak Ada Satuan" — ini di-filter dari output:

```typescript
const unit = varData.unit && !varData.unit.toLowerCase().includes("tidak ada")
  ? ` ${varData.unit}` : "";
```

---

## get_ranking

**File:** `src/tools/analysis.tools.ts`  
**Fungsi:** `registerAnalysisTools` → tool "get_ranking"

### Tujuan

Ranking/peringkat provinsi berdasarkan indikator. Selalu fetch dari domain 0000 (nasional) karena data per-provinsi tersedia di sana.

### Parameter

| Param | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `query` | string | required | Indikator (misal: "IPM", "kemiskinan") |
| `top_n` | number | 10 | Jumlah yang ditampilkan |
| `order` | "highest"/"lowest" | "highest" | Urutan |
| `year` | string? | - | Tahun (kosong = terbaru) |

### Flow Detail

```
┌─ Step 1: resolveVariableForRanking() ────────────────────────┐
│ Khusus untuk ranking — prefer variabel "Menurut Provinsi"    │
│                                                               │
│ 1. Normalize keyword + stemming                              │
│    "kemiskinan" → roots: ["kemiskinan", "miskin"]            │
│    "ipm" → roots: ["ipm"] + synonyms: ["pembangunan manusia"]│
│                                                               │
│ 2. Map keyword → subject IDs                                 │
│    "ipm" → [26], "miskin" → [23]                             │
│                                                               │
│ 3. Search variabel di domain 0000                            │
│                                                               │
│    Pass 1: "Provinsi" + keyword + "persentase/tingkat/indeks"│
│            + validasi data recent (≥2020)                     │
│    Contoh: "Persentase Penduduk Miskin Menurut Provinsi"     │
│            → has "provinsi" ✓, has "miskin" ✓,               │
│              has "persentase" ✓, period ≥2020 ✓              │
│                                                               │
│    Pass 2: "Provinsi" + keyword (tanpa filter tipe)          │
│            + validasi data recent                             │
│                                                               │
│    Pass 3: keyword match saja (tanpa "Provinsi")             │
│            → Fallback jika tidak ada var "Provinsi"          │
│                                                               │
│    Fallback: resolveVariable(client, store, query, "0000")   │
│                                                               │
│ ⚠️ VALIDASI DATA RECENT:                                     │
│    Setiap kandidat dicek listPeriods() — harus punya         │
│    setidaknya 1 period dengan label ≥ "2020"                 │
│    Ini mencegah var lama (misal var 202 hanya sampai 2013)   │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Step 2: Get Period ─────────────────────────────────────────┐
│ Jika year diberikan:                                         │
│   listPeriods("0000", var_id) → cari label contains year    │
│ Jika tidak:                                                  │
│   Ambil periods[0] (terbaru, BPS sort descending)            │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Step 3: Fetch Data ─────────────────────────────────────────┐
│ getDynamicData("0000", var_id, periodParam)                  │
│                                                               │
│ Response.vervar bisa berisi:                                 │
│ A) Hanya provinsi (34 entries) — jika var "Menurut Provinsi" │
│ B) Semua kab/kota + provinsi (500+ entries) — jika var umum  │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Step 4: Filter Vervar ke Level Provinsi ────────────────────┐
│                                                               │
│ Strategi:                                                    │
│ 1. Scan semua vervar, pisahkan:                              │
│    - vervarLabels: hanya yang label <b>...</b> (provinsi)    │
│      KECUALI "<b>INDONESIA</b>" (nasional, bukan provinsi)   │
│    - allVervarLabels: semua entry                            │
│                                                               │
│ 2. Pilih mana yang dipakai:                                  │
│    - Jika vervarLabels ≥ 10 entries → pakai (data kab/kota)  │
│    - Jika < 10 → pakai allVervarLabels (sudah level provinsi)│
│                                                               │
│ Kenapa threshold 10:                                         │
│   - Indonesia punya 38 provinsi                              │
│   - Jika bold entries ≥ 10, berarti data di level kab/kota   │
│     dan bold = aggregate provinsi                            │
│   - Jika < 10, berarti variabel sudah di level provinsi     │
│     (semua entry adalah provinsi, tidak perlu filter)        │
│                                                               │
│ 3. Strip HTML tags dari label: "<b>ACEH</b>" → "ACEH"       │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Step 5: Extract Values ─────────────────────────────────────┐
│                                                               │
│ Sort vervar IDs longest-first (hindari substring collision)  │
│                                                               │
│ Per datacontent entry:                                        │
│   - Skip jika bukan number                                   │
│   - Match key terhadap vervar IDs (longest first)            │
│   - Deduplicate: 1 provinsi = 1 nilai                        │
│                                                               │
│ Contoh:                                                      │
│   vervar "1100" (ACEH), key "110041301240" → match           │
│   vervar "11" (jika ada) → TIDAK match duluan karena         │
│   "1100" lebih panjang dan dicek lebih dulu                  │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Step 6: Sort & Format ──────────────────────────────────────┐
│ Sort by value (highest/lowest sesuai parameter)              │
│ Slice ke top_n                                               │
│ Format sebagai numbered table                                │
└───────────────────────────────────────────────────────────────┘
```

### Keyword Stemming (untuk `matchesTitle`)

```typescript
Input: "kemiskinan"
kwWords: ["kemiskinan"]
roots: ["kemiskinan"]

Stemming rules:
  - ke...an (len>6): "kemiskinan" → "miskin" ✓
  - pe...an (len>6): "pengangguran" → "nganggur"
  - ...an (len>5): "kemiskinan" → "kemiskina" (harmless noise)

Final roots: ["kemiskinan", "miskin", "kemiskina"]
matchesTitle("persentase penduduk miskin") → TRUE (contains "miskin")
```

### Synonym Expansion (untuk `matchesTitle`)

```typescript
RANKING_SYNONYMS = {
  ipm: ["ipm", "pembangunan manusia"],
  tpt: ["tpt", "pengangguran terbuka"],
  gini: ["gini", "gini rasio"],
}

Input: "ipm"
roots: ["ipm"]
synonyms: ["ipm", "pembangunan manusia"]

matchesTitle("indeks pembangunan manusia menurut provinsi")
  → roots.some(r => title.includes(r)) → "ipm" in title? NO
  → synonyms.some(s => title.includes(s)) → "pembangunan manusia" in title? YES ✓
```

---

## Helper Functions

### `resolveVariable(client, store, query, domain)`

**Lokasi:** `analysis.tools.ts` line ~395

Fungsi inti untuk resolve keyword → var_id. Dipakai oleh `compare_data` dan `get_trend`.

```
Input: query="IPM", domain="3500"

1. lookupVar(query, domain, store)
   → normalizeKeyword("IPM") → "ipm"
   → resolveCanonical("ipm") → "ipm"
   → KNOWN_VARS["ipm"] → var_id 413 (HANYA jika domain="0000")
   → store.get("ipm:3500") → cached result (jika ada)

2. Jika miss → Full Search:
   a. Map keyword ke subjects: "ipm" → [26]
   b. listSubjects(domain) → match title → tambah subject IDs
   c. Per subject (max 3):
      - listVariables(domain, subId, page=1, perPage=100)
      - Match title terhadap searchTerms (dengan synonym expansion)
      - Collect candidates
   d. Score & sort candidates
   e. learnVar() → simpan ke store
   f. Return best candidate
```

### `resolveVariableFullSearch(client, store, query, domain)`

**Lokasi:** `analysis.tools.ts` line ~537

Sama seperti `resolveVariable` tapi **bypass** KNOWN_VARS dan store. Digunakan sebagai fallback ketika var dari cache terbukti tidak punya data.

Perbedaan dengan `resolveVariable`:
- Skip Layer 1 (KNOWN_VARS) dan Layer 2 (store)
- Exclude variabel "metode lama" dari candidates
- **Validasi periods exist** sebelum return (listPeriods per candidate)
- Lebih lambat (lebih banyak API calls) tapi lebih akurat

### `resolveVariableForRanking(client, store, query)`

**Lokasi:** `analysis.tools.ts` line ~635

Khusus untuk `get_ranking`. Selalu search di domain 0000.

Perbedaan dengan `resolveVariable`:
- Prefer variabel dengan "Provinsi" di title
- Validasi data recent (≥2020)
- Stemming bahasa Indonesia (ke-...-an → root)
- Multi-pass search (strict → relaxed)

### `fetchDataForDomain(client, store, query, domain, year)`

**Lokasi:** `analysis.tools.ts` line ~467

Dipakai oleh `compare_data`. Fetch satu nilai aggregate untuk satu domain.

```
1. resolveVariable() → var_id
2. listPeriods() → find period for year
3. getDynamicData() → datacontent
4. Find aggregate vervar → extract single value
5. Return formatted value string
```

Self-healing chain:
- periods kosong → invalidate + fullSearch
- year tidak ditemukan di periods → invalidate + fullSearch
- datacontent kosong → return "N/A"

### `normalizeKeyword(query)` (dari `learning.ts`)

Menggunakan **stopwords-iso** untuk comprehensive noise removal:
- 758 Indonesian stopwords + 1298 English stopwords
- BPS-specific noise: `menurut`, `berdasarkan`, `pemeluk`, `terkait`, dll

```typescript
"berapa statistik terkait pemeluk agama di kab jombang" → "agama jombang"
"penduduk menurut agama" → "penduduk agama"
"angka kemiskinan terbaru di indonesia" → "kemiskinan indonesia"
"what is the population of jakarta" → "population jakarta"
```

### `resolveCanonical(normalized)` (dari `learning.ts`)

Prefer **last matching keyword** (lebih spesifik):

```typescript
KEYWORD_ALIASES:
  "kemiskinan" → "miskin"
  "penduduk miskin" → "miskin"
  "nganggur" → "pengangguran"
  "pembangunan manusia" → "ipm"
  "hdi" → "ipm"
  "ketimpangan" → "gini"
  "populasi" → "penduduk"
  "agama" → "agama"
  "religi" → "agama"
  "pemeluk agama" → "agama"

Word-level fallback (check dari belakang):
  "penduduk agama" → check "agama" dulu → KEYWORD_ALIASES["agama"] → "agama"
  (bukan "penduduk" yang menang, karena "agama" lebih spesifik)
```

---

## Intent Detection (`src/services/intent-detector.ts`)

### Tujuan

Mendeteksi intent user dari natural language query dan suggest tool terbaik + extract params.

### 6 Intent Types

| Intent | Pattern | Suggested Tool |
|--------|---------|----------------|
| `single_value` | Default (angka spesifik) | `find_data` |
| `comparison` | "bandingkan", "vs", "antara X dan Y" | `compare_data` |
| `trend` | "tren", "2019-2024", "dari...sampai" | `get_trend` |
| `ranking` | "peringkat", "10 provinsi termiskin" | `get_ranking` |
| `table` | "pemeluk agama", "per kecamatan", "distribusi" | `find_data` (static table fallback) |
| `publication` | "publikasi", "BRS", "cari teks di dalam" | `search` |

### Auto-Extract Params

```typescript
// Year range extraction
"pengangguran 2019-2024" → {year: "2019,2024"}

// Comparison region extraction
"antara jawa timur dan jawa barat" → {region1: "jawa timur", region2: "jawa barat"}
```

### Confidence Scoring

Pattern matching dengan scoring:
- Match pattern → +30 per pattern
- Multiple regions in query → +20
- Year range in params → +20
- Confidence = min(score / 50, 1)

### Result Hints (`generateResultHints`)

Generate actionable next-step suggestions berdasarkan query context:

```typescript
// Untuk kab/kota domain
"💡 Data provinsi: find_data(query="...", region="provinsi") [domain: 3500]"

// Untuk agama query
"💡 Breakdown detail: list_static_tables(domain="3517", keyword="agama")"

// Untuk kemiskinan
"💡 Gini rasio: get_dynamic_data(domain="0000", var="98")"
"💡 Garis kemiskinan: find_variable(keyword="garis kemiskinan")"

// Untuk pengangguran
"💡 TPak: find_variable(keyword="tpak", domain="...")"

// Untuk IPM
"💡 Data historis: get_trend(query="ipm", region="...")"
```

---

## Self-Healing Pattern

Semua tools menerapkan invalidasi otomatis saat data tidak ditemukan:

```
┌─────────────────────────────────────────────────────────────┐
│ TRIGGER                    │ ACTION                          │
├────────────────────────────┼─────────────────────────────────┤
│ listPeriods() → []         │ invalidateVar() + fullSearch    │
│ year not in periods        │ invalidateVar() + fullSearch    │
│ getDynamicData() → empty   │ invalidateVar() + retry         │
│ (find_data only)           │ + invalidatePeriod()            │
└─────────────────────────────────────────────────────────────┘
```

Ini memastikan:
- Jika BPS mengubah var_id → otomatis cari yang baru
- Jika variabel dihapus → otomatis fallback
- Jika period structure berubah → otomatis re-learn
- Tidak perlu manual intervention

---

## Persistent Store Keys

```
Variable mappings:
  Key: "{canonical_keyword}:{domain}"
  Value: JSON {var_id, title, sub_name, unit}
  Contoh: "miskin:3500" → {"var_id":184,"title":"Persentase Penduduk Miskin",...}

Period mappings:
  Key: "period:{var_id}:{domain}:{year}"
  Value: JSON {periodId, year}
  Contoh: "period:184:3500:2023" → {"periodId":"123","year":"2023"}
```

Storage locations:
- stdio (lokal): `~/.bps-mcp/learned-vars.json`
- Cloudflare Workers: KV Namespace

---

## Known Limitations & Edge Cases

### 1. Datacontent Key Collision
Period ID "120" bisa match di key yang sebenarnya mengandung period "112" (karena "1120" contains "120"). Mitigasi: longest-first matching + year range filter.

### 2. Variabel Berbeda Per Domain
IPM di domain 0000 = var 413, di domain 3500 = var 36. KNOWN_VARS hanya untuk domain 0000. Domain lain selalu full search.

### 3. Semester Data
Kemiskinan BPS dirilis per semester (Maret & September). `get_trend` mengambil satu nilai per tahun (match pertama), yang bisa jadi semester 1 atau 2 tergantung urutan di response.

### 4. Bold Label Assumption
Filtering provinsi di `get_ranking` bergantung pada BPS menggunakan `<b>` tag untuk label provinsi. Jika BPS mengubah format ini, filter akan gagal dan fallback ke semua vervar.

### 5. Rate Limiting
`resolveVariableFullSearch` bisa melakukan banyak API calls (listVariables + listPeriods per candidate). Jika BPS rate-limit, beberapa candidates mungkin di-skip.

---

## Panduan Pengembangan

### Menambah Topik Baru ke KNOWN_VARS

File: `src/services/learning.ts`

```typescript
// 1. Tambah entry di KNOWN_VARS (hanya untuk domain 0000)
const KNOWN_VARS = {
  inflasi: [{ var_id: XXX, title: "...", sub_name: "..." }],
};

// 2. Tambah alias di KEYWORD_ALIASES
const KEYWORD_ALIASES = {
  "laju inflasi": "inflasi",
  "inflation": "inflasi",
};
```

### Menambah Synonym untuk Variable Search

File: `src/tools/analysis.tools.ts` — cari `SEARCH_SYNONYMS`

```typescript
const SEARCH_SYNONYMS: Record<string, string[]> = {
  ipm: ["ipm", "pembangunan manusia", "indeks pembangunan"],
  // Tambah di sini:
  inflasi: ["inflasi", "consumer price", "ihk"],
};
```

### Menambah Disagregasi yang Di-deprioritize

File: `src/tools/analysis.tools.ts` — cari `score` function dalam `resolveVariable`

```typescript
// Tambah pattern baru:
if (t(x).includes("jenis kelamin")) s += 5;
if (t(x).includes("status pekerjaan")) s += 5;
```

### Menambah Aggregate Vervar Pattern

File: `src/tools/analysis.tools.ts` — cari `aggregateVervar` di `fetchDataForDomain`

```typescript
// Tambah pattern baru untuk domain tertentu:
if (vId === domain + "00") { aggregateVervar = vId; break; }
```


---

## Changelog (v0.13.2)

### Fix #1: Data-Formatter Vervar Label Mismatch

**Problem:** Semua kab/kota dilabel "Situbondo" karena `findLongestMatch` salah match vervar ID pendek (1, 2, 3...) via substring.

**Root cause:** Vervar IDs sequential (1=Pacitan, 2=Ponorogo, 12=Situbondo). Key `1049701250` contains "12" (Situbondo) sebagai substring, padahal sebenarnya vervar 10 (Banyuwangi).

**Fix:** `resolveDatacontentKey` sekarang menggunakan positional extraction:
1. Cari var_id di key → split key menjadi prefix (vervar) dan suffix (period/turvar)
2. Match vervar dari prefix secara exact atau startsWith
3. Fallback ke `findLongestMatch` jika positional gagal

### Fix #2: get_trend Provincial Aggregate

**Problem:** `get_trend` di domain provinsi (3500) mengambil nilai kab/kota random, bukan aggregate provinsi.

**Fix:** Expanded aggregate vervar detection:
1. `9999` atau label "indonesia" (nasional)
2. `domain[0:2] + "99"` (misal 3599 untuk domain 3500)
3. `domain[0:4] + "0"` (misal 35000)
4. Label `<b>...</b>` atau contains "provinsi" atau matches `domainName`
5. Label "jumlah" atau "total" (last resort)

### Fix #3: Strategic Indicators Fallback

**Problem:** Inflasi dan PDRB tidak ada di KNOWN_VARS dan var_id bervariasi per domain. `get_trend` dan `compare_data` gagal.

**Fix:** Jika `resolveVariable` return null, fallback ke `list_strategic_indicators`:
- Match keyword terhadap title indikator strategis
- Format data langsung dari `ind.data` object (key=periode, value=nilai)
- Berlaku untuk `get_trend` dan `fetchDataForDomain` (compare_data)

### Fix #4: Respect 'jumlah' Keyword

**Problem:** Scoring selalu prefer "persentase" untuk kemiskinan, bahkan jika user eksplisit minta "jumlah penduduk miskin".

**Fix:** Cek apakah query contains "jumlah":
- Jika ya: boost "jumlah" (+40), penalty "persentase" (-10)
- Jika tidak: boost "persentase" (+40) seperti sebelumnya

### Fix #5: Domain Kab/Kota Fallback

**Problem:** `find_data` di domain kab/kota (misal Surabaya=3578) sering return kosong karena variabel terbatas.

**Fix:** Jika datacontent kosong DAN domain adalah kab/kota (4 digit, tidak berakhir "00"):
1. Hitung parent province: `domain.slice(0,2) + "00"` (3578 → 3500)
2. `lookupVar` atau `fullSearchVar` di parent domain
3. Fetch data dari parent domain
4. Return dengan note "Data diambil dari domain provinsi induk"

### Fix #6: Expanded Ranking Synonyms

**Problem:** `get_ranking` gagal untuk "harapan hidup", "PDRB", "pendidikan" karena tidak ada synonym mapping.

**Fix:** Expanded `RANKING_SYNONYMS`:
```
pdrb: ["pdrb", "produk domestik", "pertumbuhan ekonomi"]
harapan hidup: ["harapan hidup", "angka harapan hidup", "umur harapan"]
pendidikan: ["rata-rata lama sekolah", "harapan lama sekolah", "melek huruf"]
penduduk: ["jumlah penduduk", "populasi"]
```

Juga expanded `KEYWORD_SUBJECTS` dengan pdrb→[52], harapan→[26,30], pendidikan→[26,28].

### Fix #7: Prefer Annual Over Semester

**Problem:** Kemiskinan BPS dirilis per semester (Maret & September). `get_trend` bisa ambil semester random.

**Fix:** Saat mapping year→period, prefer period yang label-nya exact match tahun (misal "2023") over yang mengandung tahun (misal "September 2023"). Jika sudah ada annual match, jangan overwrite dengan semester.

### Fix #8: compare_data Limitation Documented

**Problem:** User minta "bandingkan kemiskinan Jatim vs Jabar 2020 dan 2024" tapi tool hanya support 1 tahun.

**Fix:** Tambah note di tool description: "hanya mendukung perbandingan untuk 1 tahun. Untuk perbandingan multi-tahun, gunakan get_trend per wilayah."
