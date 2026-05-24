# Optimasi `find_data` — Persistent Learning Store

> **Lihat juga:** [SMART-TOOLS.md](./SMART-TOOLS.md) untuk dokumentasi logic `get_trend`, `compare_data`, dan `get_ranking`.

## Latar Belakang

### Masalah

Ketika AI model (terutama free tier seperti Sonnet 4.6) menerima pertanyaan seperti "berapa angka kemiskinan Jawa Timur", flow yang terjadi:

1. AI call `find_data` → internal: 5-9 HTTP requests ke BPS API
2. AI merasa hasil kurang → call `list_strategic_indicators`
3. AI coba lagi → call `get_dynamic_data`
4. AI coba lagi → call `find_variable`, `search`, dst.

**Total: 12 tool calls, sangat lambat.**

### Akar Masalah

1. **`find_data` internal flow terlalu banyak HTTP calls:**
   - resolve domain (1 call)
   - list subjects (1 call)
   - list variables per subject (1-5 calls)
   - list periods (1 call)
   - get dynamic data (1 call)
   = 5-9 HTTP requests per invocation

2. **Learning cache saat ini (`learn:` prefix) nebeng di `ICacheProvider`:**
   - Di stdio: `InMemoryCache` → hilang tiap restart
   - Di Workers: `KVCache` → persistent, tapi tercampur dengan API cache

3. **`cache_clear` tool menghapus semua** termasuk learned mappings (di stdio)

### Target

- Query populer: **1-2 HTTP calls** (resolve domain + get data)
- Query baru (cold): tetap 5-9 calls, tapi **auto-learn** untuk next time
- Learning **survive restart** dan **tidak terhapus** oleh `cache_clear`

---

## Arsitektur

### Layer Lookup (Prioritas Tinggi ke Rendah)

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: KNOWN_VARS (hardcoded)                         │
│ → Topik populer dengan var_id stabil                    │
│ → Instant, zero I/O                                    │
│ → Contoh: "miskin" → var_id 184                        │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Persistent Learning Store                      │
│ → Learned dari successful queries sebelumnya            │
│ → 1 read I/O (file/KV)                                │
│ → Shared antar semua user                              │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Full Search Flow (existing)                    │
│ → list_subjects → list_variables → scoring             │
│ → 5-9 HTTP calls                                       │
│ → Hasil disimpan ke Layer 2 untuk next time            │
└─────────────────────────────────────────────────────────┘
```

### Separation of Concerns

```
┌──────────────────────────────────────────────────┐
│ ICacheProvider (existing, unchanged)             │
│ → API response cache                             │
│ → Short TTL, boleh hilang, boleh di-clear        │
│ → Keys: "subjects:3500", "variables:3500:23"     │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│ IPersistentStore (baru)                          │
│ → Learned variable mappings                      │
│ → Long-lived, TIDAK ikut cache_clear             │
│ → Survive restart                                │
│ → Keys: "miskin:3500" → {var_id, title, ...}     │
└──────────────────────────────────────────────────┘
```

---

## Interface

```typescript
interface IPersistentStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  // Tidak ada clear() — by design, data ini tidak boleh bulk-delete
}
```

Tidak ada TTL — data valid sampai terbukti salah (var_id return empty data).

---

## Implementasi Per Environment

### stdio (lokal): `FileStore`

```
Storage: ~/.bps-mcp/learned-vars.json
Format: { "miskin:3500": "{\"var_id\":184,...}", ... }
```

- Read: load file ke memory saat init, serve dari memory
- Write: update memory + flush ke disk (debounced, max 1 write per 5 detik)
- Survive restart: ya (file-based)
- Concurrency: single process, no issue

### Cloudflare Workers: `KVStore`

```
Storage: KV Namespace (bisa BPS_CACHE yang sama, prefix "learn:")
TTL: none (atau sangat panjang, 365 hari)
```

- Read: KV get (sudah cached di edge ~60s)
- Write: KV put tanpa TTL
- Survive restart: ya (KV persistent)
- Concurrency: eventually consistent (fine untuk learning)

---

## KNOWN_VARS — Hardcoded Defaults

Topik populer dengan var_id yang stabil bertahun-tahun di BPS:

```typescript
const KNOWN_VARS: Record<string, { var_id: number; label: string }[]> = {
  // Kemiskinan
  miskin:        [{ var_id: 184, label: "Persentase Penduduk Miskin" },
                  { var_id: 183, label: "Jumlah Penduduk Miskin (ribu)" }],
  kemiskinan:    [{ var_id: 184, label: "Persentase Penduduk Miskin" }],

  // Pengangguran
  pengangguran:  [{ var_id: 543, label: "Tingkat Pengangguran Terbuka (%)" },
                  { var_id: 674, label: "Jumlah Pengangguran" }],
  tpt:           [{ var_id: 543, label: "Tingkat Pengangguran Terbuka (%)" }],

  // IPM
  ipm:           [{ var_id: 413, label: "[Metode Baru] Indeks Pembangunan Manusia (IPM)" }],

  // Ketimpangan
  gini:          [{ var_id: 98, label: "Gini Rasio" }],

  // Kependudukan
  penduduk:      [{ var_id: 1452, label: "Jumlah Penduduk" }],

  // Agama — tidak ada var_id stabil, gunakan static table fallback
  // Inflasi — tidak ada var_id stabil, gunakan strategic indicators
  // PDRB — bervariasi per domain, gunakan strategic indicators
};
```

**Catatan:** KNOWN_VARS hanya untuk keyword yang 100% stabil. Topik yang var_id-nya bervariasi per domain (PDRB, inflasi) tetap lewat search flow atau strategic indicators.

---

## Flow `find_data` (Setelah Optimasi)

```
Input: query="angka kemiskinan", region="Jawa Timur", year="2023"

1. Resolve domain
   "Jawa Timur" → domain "3500" (via DomainResolver, sudah cached)

2. Normalize keyword
   "angka kemiskinan" → normalize → "kemiskinan"
   → check KEYWORD_ALIASES → canonical: "miskin"

3. Layer 1: Check KNOWN_VARS
   "miskin" found → var_id = 184
   → SKIP to step 6

4. Layer 2: Check Persistent Store (jika Layer 1 miss)
   store.get("miskin:3500") → {var_id: 184, ...}
   → SKIP to step 6

5. Layer 3: Full Search (jika Layer 1 & 2 miss)
   → list_subjects → list_variables → scoring
   → bestVar = {var_id: 184, ...}
   → SAVE to persistent store: store.set("miskin:3500", ...)
   → PUSH to Worker (background)

6. Resolve period (jika year diberikan)
   a. Check period store: "period:184:3500:2023"
      → Hit: periodParam = "171" (0 HTTP calls)
      → Miss: call list_periods → find match → save to period store
   b. Jika year tidak diberikan → periodParam = undefined (data terbaru)

7. Get data
   client.getDynamicData("3500", "184", periodParam)

8. Validate & return
   - Jika data kosong → invalidate var mapping + period mapping
     → fallback ke Layer 3 (full search)
   - Jika data ada → format & return
```

### HTTP Calls Summary

| Scenario | Calls |
|----------|-------|
| Known var + known period | 1 (get_dynamic_data) |
| Known var + unknown period | 2 (list_periods + get_dynamic_data) |
| Known var + no year param | 1 (get_dynamic_data) |
| Unknown var (cold) | 5-9 (full search + get_dynamic_data) |
| Unknown var (cold) + learn | Same, tapi next time = 1-2 calls |

---

## Self-Healing: Invalidasi Otomatis

Jika var_id yang di-learn ternyata return data kosong:

```typescript
const result = await client.getDynamicData(domain, varId, period);

if (!result.datacontent || Object.keys(result.datacontent).length === 0) {
  // Invalidate learned mapping
  await store.delete(`${keyword}:${domain}`);
  // Fallback ke full search
  // ... (existing search flow)
}
```

Ini menangani kasus var_id berubah — otomatis self-correct tanpa manual intervention.

---

## Keyword Normalization

Untuk meningkatkan hit rate, normalize query sebelum lookup menggunakan **stopwords-iso**:

```typescript
// stopwords-iso: 758 Indonesian + 1298 English stopwords
// Plus BPS-specific noise words
const ALL_STOPWORDS = new Set([
  ...stopwords.id,  // 758 Indonesian stopwords
  ...stopwords.en,  // 1298 English stopwords
  ...BPS_SPECIFIC_NOISE,  // "menurut", "berdasarkan", "pemeluk", dll
]);
```

Contoh:
- "berapa statistik terkait pemeluk agama di kab jombang" → "agama jombang"
- "angka kemiskinan terbaru di indonesia" → "kemiskinan indonesia"
- "jumlah penduduk berdasarkan agama" → "penduduk agama"
- "what is the population of jakarta" → "population jakarta"

### Resolve Canonical (Prefer Last Match)

Untuk query dengan multiple keywords, prefer kata yang lebih spesifik (terakhir):

```typescript
"penduduk agama" → check "agama" dulu → KEYWORD_ALIASES["agama"] → "agama"
// Bukan "penduduk" yang menang, karena "agama" lebih spesifik untuk konteks ini
```

---

## Hubungan dengan Cache Existing

| Aspek | `ICacheProvider` (existing) | `IPersistentStore` (baru) |
|-------|----------------------------|---------------------------|
| Tujuan | Cache API responses | Learn variable mappings |
| Lifetime | Short (TTL per tipe) | Permanent (sampai invalidasi) |
| Survive restart | Tidak (stdio) / Ya (KV) | Ya (selalu) |
| `cache_clear` | Dihapus semua | **Tidak terpengaruh** |
| Data | Raw API responses | `{var_id, title, sub_name, hitCount, lastUsed}` |
| Scope | Per-session performance | Cross-session intelligence |

### Migrasi

- Hapus penggunaan `cache.set(cacheKey, ...)` dengan prefix `learn:` di `find_data`
- Ganti dengan `store.set(key, ...)` via `IPersistentStore`
- `ICacheProvider` tetap dipakai untuk API response caching (unchanged)

---

## Dampak pada Tool Lain

- `cache_clear`: tetap clear API cache saja, learning store tidak terpengaruh
- `find_variable`: tidak berubah (tetap full search, tapi bisa juga benefit dari learning di masa depan)
- `get_dynamic_data`: tidak berubah (low-level tool)

---

## Metrik Keberhasilan

| Metrik | Sebelum | Target |
|--------|---------|--------|
| Tool calls per query (topik populer) | 12 | 1-2 |
| HTTP calls internal find_data (known var + known period) | 5-9 | **1** |
| HTTP calls internal find_data (known var, unknown period) | 5-9 | **2** |
| HTTP calls internal find_data (new topic) | 5-9 | 5-9 (tapi learn) |
| Repeat query speed | Sama | Instan |
| Cross-user benefit | Tidak ada | Shared via Worker sync |

---

## Fuzzy Keyword Matching di Store

### Masalah

User bisa mengetik variasi yang berbeda untuk topik yang sama:
- "miskin", "kemiskinan", "penduduk miskin", "angka kemiskinan"
- "pengangguran", "nganggur", "tpt", "pengangguran terbuka"

Tanpa fuzzy matching, setiap variasi harus punya entry sendiri di store. Tidak efisien.

### Solusi: Keyword Stemming + Alias Groups

```typescript
// Alias groups — variasi keyword yang merujuk ke topik sama
const KEYWORD_ALIASES: Record<string, string> = {
  // Kemiskinan
  "miskin": "miskin",
  "kemiskinan": "miskin",
  "penduduk miskin": "miskin",
  "warga miskin": "miskin",
  "orang miskin": "miskin",
  "poverty": "miskin",

  // Pengangguran
  "pengangguran": "pengangguran",
  "nganggur": "pengangguran",
  "tpt": "pengangguran",
  "pengangguran terbuka": "pengangguran",
  "unemployment": "pengangguran",

  // IPM
  "ipm": "ipm",
  "pembangunan manusia": "ipm",
  "hdi": "ipm",

  // Gini
  "gini": "gini",
  "ketimpangan": "gini",
  "inequality": "gini",

  // Penduduk
  "penduduk": "penduduk",
  "populasi": "penduduk",
  "population": "penduduk",
  "jumlah penduduk": "penduduk",

  // Agama
  "agama": "agama",
  "religi": "agama",
  "keagamaan": "agama",
  "religion": "agama",
  "pemeluk agama": "agama",
};
```

### Flow dengan Fuzzy Matching

```
Input: "angka kemiskinan jawa timur"

1. Normalize: "kemiskinan"
2. Check KEYWORD_ALIASES: "kemiskinan" → canonical "miskin"
3. Lookup store: "miskin:3500" → {var_id: 184, ...}
4. Hit! Skip search.
```

### Fallback: Substring Matching

Jika tidak ada di alias table, coba substring match terhadap keys di store:

```typescript
function findInStore(keyword: string, domain: string, store: Map<string, string>): string | null {
  // 1. Exact match
  const exact = store.get(`${keyword}:${domain}`);
  if (exact) return exact;

  // 2. Alias match
  const canonical = KEYWORD_ALIASES[keyword];
  if (canonical) {
    const aliased = store.get(`${canonical}:${domain}`);
    if (aliased) return aliased;
  }

  // 3. Substring match — keyword contains or is contained by a stored key
  for (const [key, value] of store) {
    const [storedKw, storedDomain] = key.split(":");
    if (storedDomain !== domain) continue;
    if (storedKw.includes(keyword) || keyword.includes(storedKw)) {
      return value;
    }
  }

  return null;
}
```

### Kapan Alias Table Diupdate

- Hardcoded untuk topik umum (sudah cukup untuk 80% kasus)
- Bisa ditambah dari learned data: jika "penduduk miskin:3500" dan "miskin:3500" resolve ke var_id yang sama, otomatis jadi alias

---

## Period Learning

### Masalah

Setiap kali user minta data tahun tertentu, `find_data` harus call `list_periods` untuk translate "2023" → period_id. Ini 1 HTTP call tambahan yang sebenarnya hasilnya stabil (period_id untuk tahun tertentu jarang berubah).

### Solusi: Simpan Period Mapping di Persistent Store

```typescript
// Key format: "period:{var_id}:{domain}:{year}"
// Value: period_id (string)

// Contoh:
// "period:184:3500:2023" → "171"
// "period:184:3500:2022" → "170"
// "period:543:0000:2023" → "171"
```

### Flow

```
Input: find_data(query="kemiskinan", region="Jawa Timur", year="2023")

1. Resolve var_id → 184 (dari KNOWN_VARS atau store)
2. Check period store: "period:184:3500:2023"
   → Hit: period_id = "171" → skip list_periods call
   → Miss: call list_periods → learn → save "period:184:3500:2023" = "171"
3. get_dynamic_data("3500", "184", "171")
```

### Dampak

- **Best case (known var + known period):** 1 HTTP call (hanya get_dynamic_data)
- Sebelumnya: 2 calls (list_periods + get_dynamic_data)
- Saving: 1 HTTP call per request dengan year parameter

### Invalidasi

Period IDs sangat stabil di BPS (tahun 2023 selalu period_id yang sama untuk variabel tertentu). Tapi untuk safety:
- Jika get_dynamic_data return kosong dengan learned period_id → delete period mapping → retry dengan list_periods

### Data Structure di Store

```typescript
interface LearnedPeriod {
  periodId: string;
  year: string;
  learnedAt: number; // timestamp
}

// Disimpan di IPersistentStore yang sama, dengan prefix "period:"
// Key: "period:{var_id}:{domain}:{year}"
// Value: JSON string of LearnedPeriod
```

---

## Sync Architecture: Worker sebagai Central Brain

### Masalah

- stdio lokal: learning hilang tiap restart (jika hanya file lokal)
- Setiap instance belajar sendiri-sendiri, tidak share knowledge

### Solusi: Worker sebagai Central Store + Sync

```
┌─────────────────────────────────────────────────────────────┐
│ Cloudflare Worker (KV Namespace: BPS_LEARNING)              │
│ → Single source of truth                                    │
│ → Semua user (remote + lokal) kontribusi & consume          │
├─────────────────────────────────────────────────────────────┤
│ GET  /api/learned-vars → return all learned mappings        │
│ POST /api/learned-vars → add/update mapping                 │
│ GET  /api/learned-periods → return all period mappings      │
│ POST /api/learned-periods → add/update period mapping       │
└─────────────────────────────────────────────────────────────┘
```

### Sync Flow (stdio lokal)

```
[Server start]
  1. Load local FileStore (instant, offline-capable)
  2. Background: fetch GET /api/learned-vars dari Worker
  3. Merge: remote data + local data → update FileStore
  → Sekarang punya semua knowledge dari semua user

[Query berhasil via full search]
  1. Simpan ke local FileStore (instant)
  2. Background: POST /api/learned-vars ke Worker
  → Next user (remote atau lokal lain) juga dapat benefit

[Worker query berhasil (remote user)]
  1. Simpan ke KV langsung
  2. Lokal akan dapat saat next sync (server restart atau periodik)
```

### Sync Flow (Worker)

```
[Query masuk]
  1. Check KV langsung (sudah persistent)
  2. Jika miss → full search → save ke KV
  → Otomatis available untuk semua user
```

### API Endpoints di Worker

```typescript
// GET /api/learned-vars
// Response: { entries: { "miskin:3500": {...}, "pengangguran:0000": {...} } }

// POST /api/learned-vars
// Body: { key: "miskin:3500", value: {...} }
// Response: { ok: true }

// GET /api/learned-periods
// Response: { entries: { "period:184:3500:2023": {...}, ... } }

// POST /api/learned-periods
// Body: { key: "period:184:3500:2023", value: {...} }
// Response: { ok: true }
```

### Offline Resilience

- Jika Worker unreachable saat sync → gunakan local FileStore saja
- Jika Worker unreachable saat push → queue locally, retry next start
- FileStore selalu sebagai fallback → server tetap berfungsi offline

### Security

- Endpoint `/api/learned-vars` bisa public read (data BPS publik)
- Write bisa dibatasi dengan simple shared secret atau rate limit
- Atau: hanya accept write dari authenticated MCP sessions

---

## Static Table Fallback

### Masalah

Beberapa topik (seperti data agama) tidak tersedia sebagai dynamic data (time-series) di BPS WebAPI, tapi hanya sebagai **static table** (tabel HTML yang sudah di-format).

### Solusi: Dual Fallback di `find_data`

`find_data` sekarang punya 2 titik fallback ke static tables:

**Fallback 1:** Jika `bestVar` null (tidak ketemu variabel sama sekali)
```
find_data("pemeluk agama", region="kab jombang")
  → normalizeKeyword → "agama"
  → lookupVar → miss (tidak ada di KNOWN_VARS)
  → fullSearchVar → miss (tidak ada variabel dynamic untuk agama)
  → tryStrategicIndicators → miss
  → list_static_tables(domain="3517", keyword="agama")
  → Pick best match → get_static_table() → return HTML table
```

**Fallback 2:** Jika `bestVar` ada tapi datacontent kosong
```
find_data("pemeluk agama", region="kab jombang")
  → bestVar = {var_id: 9999} (found via full search)
  → getDynamicData → datacontent kosong
  → list_static_tables(domain="3517", keyword="agama")
  → Pick best match → get_static_table() → return HTML table
```

### Contoh Query yang Benefit

| Query | Dynamic Data? | Fallback |
|-------|---------------|----------|
| "pemeluk agama di kab jombang" | ❌ | ✅ Static table |
| "distribusi penduduk per kecamatan" | ❌ | ✅ Static table |
| "jumlah sekolah menurut kecamatan" | ❌ | ✅ Static table |
| "angka kemiskinan jawa timur" | ✅ | N/A |

---

## Ide Optimasi Lanjutan (Future)

1. **Batch learning dari log** — analisis query log, pre-populate persistent store
2. **Confidence score** — track hit rate per learned mapping, prioritaskan yang sering berhasil
3. **Preload popular vars** — saat server start, warm up store dengan top-N queries
4. **Response template** — untuk topik populer, sertakan context yang membuat AI tidak perlu call tool lain
