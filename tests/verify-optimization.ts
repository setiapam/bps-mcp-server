/**
 * Manual verification of optimization implementation.
 * Run: node --loader ts-node/esm tests/verify-optimization.ts
 * Or after build: node dist/tests/verify-optimization.js
 */

import { lookupVar, learnVar, invalidateVar, lookupPeriod, learnPeriod, invalidatePeriod, normalizeKeyword } from "../src/services/learning.js";
import { FileStore } from "../src/services/file-store.js";
import type { IPersistentStore } from "../src/services/persistent-store.js";

// Simple in-memory store for testing (no file I/O, no Worker sync)
class TestStore implements IPersistentStore {
  private data: Record<string, string> = {};
  async get(key: string) { return this.data[key] ?? null; }
  async set(key: string, value: string) { this.data[key] = value; }
  async delete(key: string) { delete this.data[key]; }
  async getAll() { return { ...this.data }; }
  async merge(entries: Record<string, string>) {
    for (const [k, v] of Object.entries(entries)) {
      if (!(k in this.data)) this.data[k] = v;
    }
  }
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

async function testNormalization() {
  console.log("\n--- Test: Keyword Normalization ---");

  assert(normalizeKeyword("berapa angka kemiskinan") === "kemiskinan", '"berapa angka kemiskinan" → "kemiskinan"');
  assert(normalizeKeyword("data pengangguran terbaru") === "pengangguran", '"data pengangguran terbaru" → "pengangguran"');
  assert(normalizeKeyword("statistik penduduk di Indonesia") === "penduduk indonesia", '"statistik penduduk di Indonesia" → "penduduk indonesia"');
  assert(normalizeKeyword("IPM") === "ipm", '"IPM" → "ipm"');
  assert(normalizeKeyword("angka kemiskinan") === "kemiskinan", '"angka kemiskinan" → "kemiskinan"');
}

async function testLayer1KnownVars() {
  console.log("\n--- Test: Layer 1 (KNOWN_VARS) ---");
  const store = new TestStore();

  // Direct known keyword (national domain only)
  const r1 = await lookupVar("kemiskinan", "0000", store);
  assert(r1 !== null && r1.var_id === 184, '"kemiskinan" at 0000 → var_id 184 (via alias → "miskin")');

  const r2 = await lookupVar("pengangguran", "0000", store);
  assert(r2 !== null && r2.var_id === 543, '"pengangguran" at 0000 → var_id 543');

  const r3 = await lookupVar("ipm", "0000", store);
  assert(r3 !== null && r3.var_id === 1706, '"ipm" at 0000 → var_id 1706');

  const r4 = await lookupVar("gini", "0000", store);
  assert(r4 !== null && r4.var_id === 98, '"gini" at 0000 → var_id 98');

  // Alias resolution (national)
  const r5 = await lookupVar("berapa angka kemiskinan", "0000", store);
  assert(r5 !== null && r5.var_id === 184, '"berapa angka kemiskinan" at 0000 → normalized → alias → var_id 184');

  const r6 = await lookupVar("tpt", "0000", store);
  assert(r6 !== null && r6.var_id === 543, '"tpt" at 0000 → alias → var_id 543');

  const r7 = await lookupVar("ketimpangan", "0000", store);
  assert(r7 !== null && r7.var_id === 98, '"ketimpangan" at 0000 → alias → var_id 98');

  const r8 = await lookupVar("jumlah penduduk", "0000", store);
  assert(r8 !== null && r8.var_id === 1452, '"jumlah penduduk" at 0000 → alias → var_id 1452');

  // KNOWN_VARS should NOT be used for non-national domains
  const r9a = await lookupVar("kemiskinan", "3500", store);
  assert(r9a === null, '"kemiskinan" at 3500 → null (KNOWN_VARS skipped for non-national)');

  // Unknown keyword — should return null (Layer 3 needed)
  const r9 = await lookupVar("ekspor kopi", "0000", store);
  assert(r9 === null, '"ekspor kopi" → null (not in KNOWN_VARS)');
}

async function testLayer2PersistentStore() {
  console.log("\n--- Test: Layer 2 (Persistent Store) ---");
  const store = new TestStore();

  // Nothing learned yet for unknown topic
  const r1 = await lookupVar("ekspor kopi", "0000", store);
  assert(r1 === null, "Before learning: 'ekspor kopi' → null");

  // Simulate learning
  await learnVar("ekspor kopi", "0000", { var_id: 999, title: "Ekspor Kopi", sub_name: "Perdagangan" }, store);

  // Now should hit
  const r2 = await lookupVar("ekspor kopi", "0000", store);
  assert(r2 !== null && r2.var_id === 999, "After learning: 'ekspor kopi' → var_id 999");

  // Invalidate
  await invalidateVar("ekspor kopi", "0000", store);
  const r3 = await lookupVar("ekspor kopi", "0000", store);
  assert(r3 === null, "After invalidation: 'ekspor kopi' → null");
}

async function testPeriodLearning() {
  console.log("\n--- Test: Period Learning ---");
  const store = new TestStore();

  // Nothing learned
  const r1 = await lookupPeriod(184, "3500", "2023", store);
  assert(r1 === null, "Before learning: period 184:3500:2023 → null");

  // Learn
  await learnPeriod(184, "3500", "2023", "171", store);
  const r2 = await lookupPeriod(184, "3500", "2023", store);
  assert(r2 === "171", "After learning: period 184:3500:2023 → '171'");

  // Different year
  const r3 = await lookupPeriod(184, "3500", "2022", store);
  assert(r3 === null, "Different year: period 184:3500:2022 → null");

  // Invalidate
  await invalidatePeriod(184, "3500", "2023", store);
  const r4 = await lookupPeriod(184, "3500", "2023", store);
  assert(r4 === null, "After invalidation: period 184:3500:2023 → null");
}

async function testFileStore() {
  console.log("\n--- Test: FileStore (persistence) ---");

  const store = new FileStore();

  // Write
  await store.set("test:key", JSON.stringify({ var_id: 123, title: "Test" }));
  const r1 = await store.get("test:key");
  assert(r1 !== null && JSON.parse(r1).var_id === 123, "FileStore set/get works");

  // Merge
  await store.merge({ "new:key": "value1", "test:key": "should-not-overwrite" });
  const r2 = await store.get("new:key");
  assert(r2 === "value1", "FileStore merge adds new keys");
  const r3 = await store.get("test:key");
  assert(r3 !== null && JSON.parse(r3).var_id === 123, "FileStore merge does not overwrite existing");

  // Delete
  await store.delete("test:key");
  await store.delete("new:key");
  const r4 = await store.get("test:key");
  assert(r4 === null, "FileStore delete works");

  console.log("  (Note: file flush is debounced 5s — file write happens async)");
}

async function main() {
  console.log("=== BPS MCP Server — Optimization Verification ===");

  await testNormalization();
  await testLayer1KnownVars();
  await testLayer2PersistentStore();
  await testPeriodLearning();
  await testFileStore();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
