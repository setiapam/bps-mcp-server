#!/usr/bin/env node
/**
 * Seed script: crawl popular var_ids for all provinces and push to Worker.
 *
 * Usage:
 *   BPS_API_KEY=your_key node scripts/seed-learning.js
 *   BPS_API_KEY=your_key node scripts/seed-learning.js --dry-run
 *
 * This finds the correct var_id for popular topics (kemiskinan, pengangguran, etc.)
 * in each province, then pushes the mappings to the Worker's learning API.
 */

const API_KEY = process.env.BPS_API_KEY;
const WORKER_URL = process.env.BPS_WORKER_URL || "https://bps-mcp-server.murphi.my.id";
const DRY_RUN = process.argv.includes("--dry-run");
const BASE = process.env.BPS_API_BASE_URL || "https://webapi.bps.go.id/v1";

if (!API_KEY) {
  console.error("Error: BPS_API_KEY required");
  process.exit(1);
}

// Topics to seed: keyword → subject_id to search in
const TOPICS = [
  { keyword: "miskin", subjectId: 23, match: /miskin|kemiskinan|poverty/i },
  { keyword: "pengangguran", subjectId: 6, match: /pengangguran|tpt/i },
  { keyword: "ipm", subjectId: 26, match: /ipm|pembangunan manusia/i },
  { keyword: "gini", subjectId: 23, match: /gini/i },
  { keyword: "penduduk", subjectId: 12, match: /jumlah penduduk/i },
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function getProvinces() {
  const data = await fetchJson(`${BASE}/api/domain/type/prov/lang/ind/key/${API_KEY}/`);
  return data.data[1]; // [{domain_id, domain_name}, ...]
}

async function getVariables(domain, subjectId) {
  const url = `${BASE}/api/list/model/var/domain/${domain}/subject/${subjectId}/lang/ind/key/${API_KEY}/?page=1&perpage=100`;
  try {
    const data = await fetchJson(url);
    if (!data.data || data.data.length < 2) return [];
    return data.data[1]; // [{var_id, title, unit, ...}, ...]
  } catch {
    return [];
  }
}

async function pushToWorker(key, value) {
  if (DRY_RUN) return;
  try {
    await fetch(`${WORKER_URL}/api/learned-vars`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: JSON.stringify(value) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Silent fail
  }
}

async function main() {
  console.log(`Seeding learning store${DRY_RUN ? " (DRY RUN)" : ""}...`);
  console.log(`Worker: ${WORKER_URL}`);
  console.log(`API: ${BASE}\n`);

  const provinces = await getProvinces();
  console.log(`Found ${provinces.length} provinces\n`);

  let total = 0;
  const results = {};

  for (const prov of provinces) {
    const domain = prov.domain_id;
    process.stdout.write(`${prov.domain_name} (${domain}): `);

    for (const topic of TOPICS) {
      const vars = await getVariables(domain, topic.subjectId);
      // Find best match
      const match = vars.find(v => topic.match.test(v.title));
      if (match) {
        const storeKey = `${topic.keyword}:${domain}`;
        const storeValue = {
          var_id: match.var_id,
          title: match.title,
          sub_name: match.sub_name || "",
          unit: match.unit || "",
        };
        results[storeKey] = storeValue;
        await pushToWorker(storeKey, storeValue);
        process.stdout.write(`${topic.keyword}=${match.var_id} `);
        total++;
      }

      // Rate limit: 100ms between requests
      await new Promise(r => setTimeout(r, 100));
    }
    console.log();
  }

  console.log(`\nDone! Seeded ${total} mappings across ${provinces.length} provinces.`);

  if (DRY_RUN) {
    console.log("\nResults (dry run):");
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
