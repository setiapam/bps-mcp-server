# Changelog

## [0.15.1](https://github.com/setiapam/bps-mcp-server/compare/v0.15.0...v0.15.1) (2026-05-24)


### Bug Fixes

* expand static table fallback with multi-keyword and parent domain strategies ([8dffb5e](https://github.com/setiapam/bps-mcp-server/commit/8dffb5edbcae47c710aac1a583c5595e9af0aeb5))

## [0.15.0](https://github.com/setiapam/bps-mcp-server/compare/v0.14.0...v0.15.0) (2026-05-24)


### Features

* add intent detection and result hints for smarter query routing ([6632d28](https://github.com/setiapam/bps-mcp-server/commit/6632d28a8d4fe7890e5bacea4f1cc339ff7c03f1))
* integrate stopwords-iso for comprehensive noise word removal ([81e16c0](https://github.com/setiapam/bps-mcp-server/commit/81e16c0b27a6eca13e05cdf31473d8411e648850))


### Bug Fixes

* prefix unused params with underscore to satisfy lint rule ([eaae6bb](https://github.com/setiapam/bps-mcp-server/commit/eaae6bb176c77cd5c3cb29b24d7ec33cb4129359))
* resolveCanonical prefers last keyword match to avoid wrong variable selection ([71e317e](https://github.com/setiapam/bps-mcp-server/commit/71e317e48843dca9fd6c2b38a3d818c99d29f5ab))

## [0.14.0](https://github.com/setiapam/bps-mcp-server/compare/v0.13.2...v0.14.0) (2026-05-24)


### Features

* add agama/religion topic support with static table fallback ([5364481](https://github.com/setiapam/bps-mcp-server/commit/5364481197d7da0c696eb3bb50410f7df8bcc938))

## [0.13.2](https://github.com/setiapam/bps-mcp-server/compare/v0.13.1...v0.13.2) (2026-05-22)


### Bug Fixes

* **find_data:** support kab/kota breakdown queries ([7716db5](https://github.com/setiapam/bps-mcp-server/commit/7716db5ea19968f76a16f0982658d4f4bd49ed5d))
* lint error - use const for non-reassigned variable ([05a0d5f](https://github.com/setiapam/bps-mcp-server/commit/05a0d5f8f5873d186efd284c922a53dd7070fb05))
* resolve 8 edge cases in smart tools ([051d991](https://github.com/setiapam/bps-mcp-server/commit/051d9919f11af5ecc121b5b30c8691dfabaad547))

## [0.13.1](https://github.com/setiapam/bps-mcp-server/compare/v0.13.0...v0.13.1) (2026-05-22)


### Bug Fixes

* **analysis:** fix get_trend, compare_data, get_ranking data accuracy ([e39bb89](https://github.com/setiapam/bps-mcp-server/commit/e39bb89da115dc5d5c84f6b29fec3640d2810666))

## [0.13.0](https://github.com/setiapam/bps-mcp-server/compare/v0.12.1...v0.13.0) (2026-05-21)


### Features

* add compare_data, get_trend, get_ranking tools ([9db03d0](https://github.com/setiapam/bps-mcp-server/commit/9db03d0126a57cb4095d58a2a24298655fe9710d))

## [0.12.1](https://github.com/setiapam/bps-mcp-server/compare/v0.12.0...v0.12.1) (2026-05-21)


### Bug Fixes

* remove version.ts, pass version as param to createServer ([5d55328](https://github.com/setiapam/bps-mcp-server/commit/5d55328b395ccc62e9abc2236c3dece9e164054c))
* sync version strings to 0.11.0 ([7e00533](https://github.com/setiapam/bps-mcp-server/commit/7e005333db4b64c84c5b67387b51dac3c00ddf57))

## [0.12.0](https://github.com/setiapam/bps-mcp-server/compare/v0.11.0...v0.12.0) (2026-05-21)


### Features

* add seed script for pre-populating provincial var_ids ([8d68d8e](https://github.com/setiapam/bps-mcp-server/commit/8d68d8e0a472c04db07e6c20d6bc6d6827a3fa5a))


### Bug Fixes

* KNOWN_VARS only for national domain — var_ids differ per domain ([907ca38](https://github.com/setiapam/bps-mcp-server/commit/907ca3857ecfc0889006cad9337b728366841d26))
* resolve N/A period labels and incorrect var title in dynamic data ([425f72a](https://github.com/setiapam/bps-mcp-server/commit/425f72a69885b18dc414da6e2f6fda1b9c047be3))

## [0.11.0](https://github.com/setiapam/bps-mcp-server/compare/v0.10.2...v0.11.0) (2026-05-21)


### Features

* persistent learning store for find_data optimization ([2448344](https://github.com/setiapam/bps-mcp-server/commit/2448344b1888c323e6b52e194726cc273a1a7b0b))

## [0.10.2](https://github.com/setiapam/bps-mcp-server/compare/v0.10.1...v0.10.2) (2026-05-20)


### Bug Fixes

* correct AllStats proxy URL path construction ([fb348a2](https://github.com/setiapam/bps-mcp-server/commit/fb348a20e043e221646c6098863c7886762524e1))

## [0.10.1](https://github.com/setiapam/bps-mcp-server/compare/v0.10.0...v0.10.1) (2026-05-20)


### Bug Fixes

* add NODE_AUTH_TOKEN for npm publish ([eff5c74](https://github.com/setiapam/bps-mcp-server/commit/eff5c742a2ba726c5f175e52587f277ebb0ac440))

## [0.10.0](https://github.com/setiapam/bps-mcp-server/compare/v0.9.0...v0.10.0) (2026-05-20)


### Features

* learning cache and topic routing for faster AI queries ([898ec50](https://github.com/setiapam/bps-mcp-server/commit/898ec504994abc04e39a7fb35c9d584554109592))

## [0.9.0](https://github.com/setiapam/bps-mcp-server/compare/v0.8.0...v0.9.0) (2026-05-20)


### Features

* add learning cache - remember successful variable lookups for faster repeat queries ([2e4da82](https://github.com/setiapam/bps-mcp-server/commit/2e4da822fdb75fb0fb1441bea1ad70299e99fdb2))

## [0.8.0](https://github.com/setiapam/bps-mcp-server/compare/v0.7.0...v0.8.0) (2026-05-20)


### Features

* add topic routing guide in find_data for faster AI decision-making ([76909aa](https://github.com/setiapam/bps-mcp-server/commit/76909aaf555e2982094ccec5fce9cf8e8ea683c8))

## [0.7.0](https://github.com/setiapam/bps-mcp-server/compare/v0.6.1...v0.7.0) (2026-05-20)


### Features

* route AllStats search through homelab proxy ([ca0f477](https://github.com/setiapam/bps-mcp-server/commit/ca0f4778e9e022e5eaf3eba20b888ca3f5fcea82))

## [0.6.1](https://github.com/setiapam/bps-mcp-server/compare/v0.6.0...v0.6.1) (2026-05-20)


### Bug Fixes

* use homelab proxy for BPS API, remove debug endpoints ([be61c07](https://github.com/setiapam/bps-mcp-server/commit/be61c07afbc899f9b4d0cfcaa489048c1b125013))

## [0.6.0](https://github.com/setiapam/bps-mcp-server/compare/v0.5.4...v0.6.0) (2026-05-19)


### Features

* route BPS API through homelab proxy to bypass CF bot detection ([1b79a1a](https://github.com/setiapam/bps-mcp-server/commit/1b79a1a22310e74a33288ef9ac1735fa2a531232))

## [0.5.4](https://github.com/setiapam/bps-mcp-server/compare/v0.5.3...v0.5.4) (2026-05-19)


### Bug Fixes

* read OAuth props from ctx (not headers) as per workers-oauth-provider API ([d0aab14](https://github.com/setiapam/bps-mcp-server/commit/d0aab142125e4c2e1247b1dc13252bf0b88e92b8))

## [0.5.3](https://github.com/setiapam/bps-mcp-server/compare/v0.5.2...v0.5.3) (2026-05-19)


### Bug Fixes

* make API key validation resilient to BPS API failures from CF IPs ([1511d98](https://github.com/setiapam/bps-mcp-server/commit/1511d983dc0912ee4185444b29ca687f3fd99c81))

## [0.5.2](https://github.com/setiapam/bps-mcp-server/compare/v0.5.1...v0.5.2) (2026-05-19)


### Bug Fixes

* prevent double body consumption in OAuth authorize POST ([887ef5d](https://github.com/setiapam/bps-mcp-server/commit/887ef5d8d9bea94818e5216399a20ca7e936fb8c))

## [0.5.1](https://github.com/setiapam/bps-mcp-server/compare/v0.5.0...v0.5.1) (2026-05-19)


### Bug Fixes

* correct BPS API key validation endpoint ([101a167](https://github.com/setiapam/bps-mcp-server/commit/101a1675466810a9802de7610b19e139b30db823))

## [0.5.0](https://github.com/setiapam/bps-mcp-server/compare/v0.4.0...v0.5.0) (2026-05-19)


### Features

* add AI-friendly tools (find_data, find_variable) and optimize cache ([7bc21d6](https://github.com/setiapam/bps-mcp-server/commit/7bc21d60cd2116ed3af700272d9d7defd1ab0b3f))
* add release workflow with automated versioning and changelog ([03698e0](https://github.com/setiapam/bps-mcp-server/commit/03698e0c87bf5f20d5ba3d0b709a3d7464bbbf67))
* automated release workflow with changelog and semantic versioning ([e8efde6](https://github.com/setiapam/bps-mcp-server/commit/e8efde6c6925deecd0f62b71c62fbfb1eb2e8123))
* implement OAuth 2.1 for remote MCP clients (Claude.ai, ChatGPT, etc.) ([d69d1ff](https://github.com/setiapam/bps-mcp-server/commit/d69d1ffef31f50ed8e88df758fcafeceaf5db4d2))
* integrate AllStats Search and Deep Search with WebAPI ([25bf5d7](https://github.com/setiapam/bps-mcp-server/commit/25bf5d726b6b9eeb287ab5805a49bde90bfb5d3f))
* Phase 2 — complete data coverage (31 tools) ([debebd9](https://github.com/setiapam/bps-mcp-server/commit/debebd9e05e8c727fadd7d6135f3e5f8eae06f83))
* Phase 3 — resources, prompts, tests, CI/CD ([a85c896](https://github.com/setiapam/bps-mcp-server/commit/a85c896bc1eacbd544fc703bcbfe4d0108d74249))
* Phase 4 — Cloudflare Workers remote deployment ([75b655c](https://github.com/setiapam/bps-mcp-server/commit/75b655cc76a4f0e3453339a3ba3c657f69e4b52f))
* rate limit ([96282e8](https://github.com/setiapam/bps-mcp-server/commit/96282e82e8468d510f6a975dd36fe9fe59c44e7a))


### Bug Fixes

* 403 allstats search ([311738d](https://github.com/setiapam/bps-mcp-server/commit/311738d06b97a2f4bee54eeb08b107ba7a492c0f))
* add User-Agent header to BPS API requests to avoid WAF blocks ([2969f81](https://github.com/setiapam/bps-mcp-server/commit/2969f81c398f834f4f50529d8938a6698415869a))
* add User-Agent header to BPS API requests to avoid WAF blocks ([9a97201](https://github.com/setiapam/bps-mcp-server/commit/9a97201993266fa044a09e2cf27f298b40c6426b))
* address code review feedback - fix alias domainName, pre-sort keys, fix test comment ([1639a71](https://github.com/setiapam/bps-mcp-server/commit/1639a717abacb70b1763ceddcee58d9273f0d506))
* BYOK ([4e142c4](https://github.com/setiapam/bps-mcp-server/commit/4e142c4a4fd1bd80c0fae4feb5c1e7aafd0ce4b8))
* read .env ([40ec71c](https://github.com/setiapam/bps-mcp-server/commit/40ec71cd45e08d061441a309c9cfb4d88bf7472c))
* require Node.js &gt;= 22 (wrangler 4.x and vitest 4.x requirement) ([6968836](https://github.com/setiapam/bps-mcp-server/commit/6968836aa17d6e7cff3fcb2f89d71451ec6eca73))
* update dependencies ([7793d91](https://github.com/setiapam/bps-mcp-server/commit/7793d91735010ddf89cb8b12a26a63924d476160))
* update wrangler ([891c6b3](https://github.com/setiapam/bps-mcp-server/commit/891c6b3edc23ccd22f665f37ebb5ab1bd817f4fa))


### Performance Improvements

* add request deduplication, timeout, retry, and optimize domain resolver and data formatter ([6f24e12](https://github.com/setiapam/bps-mcp-server/commit/6f24e12ec3d8cf0b6598d77aed1c86457b353278))
* request deduplication, timeouts, retry, and hot-path optimizations ([ee7eae4](https://github.com/setiapam/bps-mcp-server/commit/ee7eae45695479ed8395010e9e983019b7e91ed1))

## [0.4.0](https://github.com/setiapam/bps-mcp-server/compare/v0.3.2...v0.4.0) (2026-05-19)


### Features

* add AI-friendly tools (find_data, find_variable) and optimize cache ([7bc21d6](https://github.com/setiapam/bps-mcp-server/commit/7bc21d60cd2116ed3af700272d9d7defd1ab0b3f))
* implement OAuth 2.1 for remote MCP clients (Claude.ai, ChatGPT, etc.) ([d69d1ff](https://github.com/setiapam/bps-mcp-server/commit/d69d1ffef31f50ed8e88df758fcafeceaf5db4d2))
* rate limit ([96282e8](https://github.com/setiapam/bps-mcp-server/commit/96282e82e8468d510f6a975dd36fe9fe59c44e7a))


### Bug Fixes

* BYOK ([4e142c4](https://github.com/setiapam/bps-mcp-server/commit/4e142c4a4fd1bd80c0fae4feb5c1e7aafd0ce4b8))
* require Node.js &gt;= 22 (wrangler 4.x and vitest 4.x requirement) ([6968836](https://github.com/setiapam/bps-mcp-server/commit/6968836aa17d6e7cff3fcb2f89d71451ec6eca73))
* update dependencies ([7793d91](https://github.com/setiapam/bps-mcp-server/commit/7793d91735010ddf89cb8b12a26a63924d476160))
* update wrangler ([891c6b3](https://github.com/setiapam/bps-mcp-server/commit/891c6b3edc23ccd22f665f37ebb5ab1bd817f4fa))

## [0.3.2](https://github.com/setiapam/bps-mcp-server/compare/v0.3.1...v0.3.2) (2026-04-11)


### Bug Fixes

* add User-Agent header to BPS API requests to avoid WAF blocks ([2969f81](https://github.com/setiapam/bps-mcp-server/commit/2969f81c398f834f4f50529d8938a6698415869a))
* add User-Agent header to BPS API requests to avoid WAF blocks ([9a97201](https://github.com/setiapam/bps-mcp-server/commit/9a97201993266fa044a09e2cf27f298b40c6426b))

## [0.3.1](https://github.com/setiapam/bps-mcp-server/compare/v0.3.0...v0.3.1) (2026-04-08)


### Bug Fixes

* 403 allstats search ([311738d](https://github.com/setiapam/bps-mcp-server/commit/311738d06b97a2f4bee54eeb08b107ba7a492c0f))

## [0.3.0](https://github.com/setiapam/bps-mcp-server/compare/v0.2.0...v0.3.0) (2026-04-07)


### Features

* integrate AllStats Search and Deep Search with WebAPI ([25bf5d7](https://github.com/setiapam/bps-mcp-server/commit/25bf5d726b6b9eeb287ab5805a49bde90bfb5d3f))

## [0.2.0](https://github.com/setiapam/bps-mcp-server/compare/v0.1.0...v0.2.0) (2026-04-07)


### Features

* add release workflow with automated versioning and changelog ([03698e0](https://github.com/setiapam/bps-mcp-server/commit/03698e0c87bf5f20d5ba3d0b709a3d7464bbbf67))
* automated release workflow with changelog and semantic versioning ([e8efde6](https://github.com/setiapam/bps-mcp-server/commit/e8efde6c6925deecd0f62b71c62fbfb1eb2e8123))
* Phase 4 — Cloudflare Workers remote deployment ([75b655c](https://github.com/setiapam/bps-mcp-server/commit/75b655cc76a4f0e3453339a3ba3c657f69e4b52f))


### Bug Fixes

* address code review feedback - fix alias domainName, pre-sort keys, fix test comment ([1639a71](https://github.com/setiapam/bps-mcp-server/commit/1639a717abacb70b1763ceddcee58d9273f0d506))


### Performance Improvements

* add request deduplication, timeout, retry, and optimize domain resolver and data formatter ([6f24e12](https://github.com/setiapam/bps-mcp-server/commit/6f24e12ec3d8cf0b6598d77aed1c86457b353278))
* request deduplication, timeouts, retry, and hot-path optimizations ([ee7eae4](https://github.com/setiapam/bps-mcp-server/commit/ee7eae45695479ed8395010e9e983019b7e91ed1))
