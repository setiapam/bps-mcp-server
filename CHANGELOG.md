# Changelog

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
