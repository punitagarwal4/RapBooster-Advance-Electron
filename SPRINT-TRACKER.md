# RapBooster Advance — Sprint Tracker

Living status document. **Update this in the same commit as the work it describes** — a tracker
that lags the code is worse than no tracker.

Specification: [SPRINTS.md](./SPRINTS.md) · Rules: [CLAUDE.md](./CLAUDE.md) ·
Inputs: [REQUIREMENTS.md](./REQUIREMENTS.md)

Last updated: **2026-07-28**

---

## 1. Overview

| Sprint | Scope | Status | Started | Completed | Tasks | E2E | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Documentation | 🟢 Complete | 2026-07-27 | 2026-07-27 | 7/7 | n/a | `9968d08` |
| 1 | Foundation · Licensing · Shell | 🟡 In progress | 2026-07-27 | — | 7/11 | 15/16 | `15132dd` |
| 2 | Devices · Contacts · Templates | ⬜ Not started | — | — | 0/7 | 0/22 | — |
| 3 | Campaign engine · Groups | ⬜ Not started | — | — | 0/9 | 0/25 | — |
| 4 | Inbox · AI Bot · Settings · Release | ⬜ Not started | — | — | 0/6 | 0/25 | — |

**Legend:** ⬜ Not started · 🟡 In progress · 🟢 Complete · 🔴 Blocked · ⚪ Deferred

### Current status

> 🟡 **Sprint 1 is proceeding without a filled REQUIREMENTS.md**, on customer instruction
> (2026-07-27). Anything that depends on an unanswered question is built against a documented
> default or behind a swappable interface; all of them are listed in
> [REQUIREMENTS.md §0](./REQUIREMENTS.md#section-0--working-assumptions-in-effect).
>
> Two tasks genuinely cannot finish until answers arrive: **T1.8** (licensing) needs §1 to talk
> to a real server — it will ship against the interface with a mock — and **T4.5** (signing and
> auto-update) needs §2, §3 and §4. Everything else is unblocked.
>
> The assumption most worth an early correction is **A7**: phone normalization defaults to
> `+91` and is applied at CSV import, so changing it after a large import means re-importing.

---

## 2. Sprint 0 — Documentation

**Goal:** Freeze scope and produce planning artifacts before any code exists.

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T0.1 | Extract complete feature inventory from `design/` prototypes | 🟢 | 9 screens, 6 modals, full field list captured in SPRINTS.md §2 |
| T0.2 | `REQUIREMENTS.md` | 🟢 | 8 sections, awaiting customer input |
| T0.3 | `SPRINTS.md` | 🟢 | Includes full Prisma schema, IPC contract, algorithms |
| T0.4 | `SPRINT-TRACKER.md` | 🟢 | This file |
| T0.5 | `CLAUDE.md` | 🟢 | Architecture invariants, multi-agent mode, Graphify, production standards |
| T0.6 | Rewrite `README.md` | 🟢 | Points at the four documents |
| T0.7 | Commit + push to `main` | 🟢 | `9968d08` |

**Definition of done:** all documents committed; every prototype field assigned to a sprint;
customer has the questionnaire.

---

## 3. Sprint 1 — Foundation, licensing, app shell

**Proceeding under the assumptions in REQUIREMENTS §0.** T1.8 will ship against the
`LicenseService` interface with a mock until §1 is answered.

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T1.1 | Prisma/Electron packaging spike (timebox 1 day) | 🟢 | **Passed packaged** — see D8, D10–D12. Drizzle fallback not needed |
| T1.2 | Project scaffold, tooling, scripts | 🟢 | Electron + Next static export + Tailwind 4 + ESLint 10 + Prettier; `build`/`pack`/`typecheck`/`lint`/`test:e2e`/`test:smoke` all green |
| T1.3 | Electron shell + security baseline | 🟢 | Strict CSP with build-time inline-script hashes, permission deny-all, external-URL allowlist, navigation lock |
| T1.4 | Database layer, full schema, boot migrator | 🟢 | 17 tables, forward-only migrator, WAL, integrity check + quarantine, pre-migration backups |
| T1.5 | IPC contract + router + renderer hooks | 🟢 | 68 channels + 10 events, two-way zod validation, sandbox-safe preload allowlist, useIpcQuery/useIpcEvent |
| T1.6 | Design system (Tailwind + shadcn + tokens) | 🟢 | Tokens from the prototype palette; hand-written primitives (Button, StatusPill, EmptyState, PageHeader) instead of the shadcn CLI — see D20 |
| T1.7 | App shell, sidebar, nine routes | 🟢 | Sidebar in prototype order with Settings pinned, all nine routes prerendered, toast provider, per-route error boundary |
| T1.8 | Licensing: service, fingerprint, activation, conflict, gate | ⬜ | |
| T1.9 | Settings — license panel | ⬜ | |
| T1.10 | Logging, redaction, crash handlers, diagnostics | ⬜ | |
| T1.11 | Playwright harness + packaged smoke test | 🟡 | Harness + isolated-userData fixture + 15 specs green; licensing specs (E1.1–E1.9) land with T1.8 |

**E2E:** **15 written, 15 passing** (stable across consecutive runs). Remaining: E1.1–E1.9
(licensing, with T1.8), E1.11 (tamper, T1.8), E1.15 (log redaction, T1.10). E1.16's packaged
half runs via `npm run test:smoke`.

**Exit gate:** fresh install gates on license · valid key persists across restart · conflict
transfer works · offline grace honored · all nine routes navigate · installers build on both
platforms.

---

## 4. Sprint 2 — Devices, contacts, templates

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T2.1 | `wa-service` utility process + supervisor | ⬜ | |
| T2.2 | Baileys session manager (QR · pairing · reconnect · logout) | ⬜ | Version pinned per REQUIREMENTS §7.6 |
| T2.3 | Devices screen | ⬜ | |
| T2.4 | Contacts: lists, virtualized table, CSV import/export | ⬜ | 50k-row target |
| T2.5 | Templates: four types, media store, preview | ⬜ | |
| T2.6 | Merge tags + live preview | ⬜ | |
| T2.7 | Mock transport | ⬜ | Unblocks all CI testing for Sprints 3–4 |

**E2E:** E2.1 – E2.22 — 0/22 passing.

**Exit gate:** device links by QR and pairing code and survives restart · 20 mock devices
concurrent · 50k CSV imports cleanly · all four template types with working merge tags.

---

## 5. Sprint 3 — Campaign engine and groups

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T3.1 | Campaign creation + queue expansion | ⬜ | |
| T3.2 | Send engine (workers · throttle · retries) | ⬜ | |
| T3.3 | Crash-safe resume | ⬜ | **The highest-risk item in the project** |
| T3.4 | Controls + scheduling + device reassignment | ⬜ | |
| T3.5 | Campaigns UI + detail view | ⬜ | |
| T3.6 | Campaign report export | ⬜ | Format per REQUIREMENTS §7.2 |
| T3.7 | Groups: sync + list + selection | ⬜ | |
| T3.8 | Groups: bulk messaging job | ⬜ | |
| T3.9 | Groups: bulk creation job | ⬜ | |

**E2E:** E3.1 – E3.25 — 0/25 passing.

**Exit gate:** 10k-recipient campaign completes with reconciled counters · pacing measurably
respected · **kill-and-resume produces no duplicates beyond the documented bound** · groups
create and message in bulk.

---

## 6. Sprint 4 — Inbox, AI bot, settings, dashboard, release

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T4.1 | Inbox (two-pane, live ingestion, composer) | ⬜ | |
| T4.2 | AI Bot config + OpenAI auto-reply worker | ⬜ | |
| T4.3 | Settings: AI · sending defaults · data & backup · about | ⬜ | |
| T4.4 | Dashboard real aggregates | ⬜ | |
| T4.5 | Packaging, signing, notarization, auto-update | ⬜ | Needs REQUIREMENTS §3, §4 |
| T4.6 | Hardening pass + full regression + README | ⬜ | |

**E2E:** E4.1 – E4.25 — 0/25 passing.

**Exit gate:** signed installers on both platforms · auto-update works against the real feed ·
AI replies correctly and fails loudly · full 88-test regression green.

---

## 7. Decision log

Architectural choices made during execution. Every entry needs a date, the decision, and the
reasoning — future sessions read this instead of re-litigating.

| # | Date | Decision | Reasoning |
| --- | --- | --- | --- |
| D1 | 2026-07-27 | Scope frozen to the prototype's 9 screens | Customer confirmed Number Filter, Group Grabber, Warmup and Spintax are out — they appear nowhere in the mockups |
| D2 | 2026-07-27 | Baileys runs in a dedicated `utilityProcess`, not main | 20 concurrent sockets would stall window management and IPC; isolation also survives a Baileys crash |
| D3 | 2026-07-27 | `wa-service` never writes to SQLite; main is the sole writer | One writer removes lock contention and centralizes transactions and auditing |
| D4 | 2026-07-27 | Per-recipient queue rows rather than an in-memory list | The only way Pause/Resume and crash recovery can be correct |
| D5 | 2026-07-27 | `Contact.data` as a JSON blob with promoted `name`/`phone` | Lists have arbitrary columns; EAV would need a join per field at 50k rows; no screen filters on custom fields |
| D6 | 2026-07-27 | Mock transport built in Sprint 2, before the campaign engine | Without it, Sprints 3–4 cannot be tested in CI without risking a real WhatsApp ban |
| D7 | 2026-07-27 | No Baileys fork (`baileys-pro`, `baileys-antiban`, etc.) | Anti-ban pacing is ours and auditable; forks add supply-chain risk to the most sensitive dependency |
| D8 | 2026-07-27 | **Prisma stays — Drizzle fallback not needed** | T1.1 spike passed in a packaged asar build on Windows: migrations applied, write/read/aggregate round-trip, idempotent rerun. Prisma 7 generates plain TypeScript with a WASM query compiler, so there is no engine binary to ship |
| D9 | ⬜ pending | Baileys 7.x RC vs 6.7.23 | Customer decision in REQUIREMENTS §7.6 — record the pinned version here |
| D10 | 2026-07-27 | **Electron pinned to 42.7.1, not 43.x** | Electron 43 is ABI 148; `better-sqlite3` publishes prebuilds only up to ABI 146 (Electron 42). On 43 every install fell back to `node-gyp`, which needs Python + VS Build Tools on every build machine — unacceptable for CI and the macOS build. Revisit when better-sqlite3 ships ABI 148 prebuilds |
| D11 | 2026-07-27 | `better-sqlite3` pinned to 12.11.1 | `@prisma/adapter-better-sqlite3@7.9.1` requires `^12.6.0`. Pinning 13.x produced two copies (hoisted 13.0.1 + nested 12.11.1) and the nested one had no Electron prebuild. One hoisted copy is required for `install-app-deps` to work |
| D12 | 2026-07-27 | Packaged build verified via a `--self-test` flag on the main entry | Native-module and asar-layout breakage only reproduces in a real packaged binary. Making it a flag on the shipped entry means the same probe backs the per-sprint smoke test in SPRINTS.md §13.4 |
| D13 | 2026-07-27 | **Renderer served over a custom `app://` scheme, not `file://`** | The Next static export references assets at absolute `/_next/...` paths, which under `file://` resolve to the filesystem root and 404. A relative `assetPrefix` fixes the root page but breaks nested routes (`/campaigns/` would seek `/campaigns/_next/...`) and the app has nine. The scheme also gives the renderer a real origin, which is what makes a strict CSP possible in T1.3. Path traversal is contained in `app-protocol.ts` |
| D14 | 2026-07-27 | `scripts/copy-renderer.mjs` copies the export to `out/renderer` at build time | Next cannot export outside its own directory. Doing the copy in the build rather than in `electron-builder` means the unpackaged and packaged layouts are identical, so E2E exercises the same load path the shipped app uses instead of a test-only one |
| D15 | 2026-07-27 | Renderer load path keyed on `ELECTRON_RENDERER_URL`, not `app.isPackaged` | `isPackaged` is false under Playwright, which would have forced tests down a dev-server path the shipped app never takes. Keying on the env var means absence of a dev server === production behaviour |
| D16 | 2026-07-28 | **Channel names live in a zod-free `shared/channels.ts`** | The preload runs with `sandbox: true`, where `require` cannot reach `node_modules` — importing the zod contract there broke `window.api` entirely. A compile-time `AssertEqual` in `ipc.ts` makes the two lists impossible to drift apart |
| D17 | 2026-07-28 | **CSP pins build-time hashes of Next's inline scripts** | The App Router emits inline bootstrap scripts that `script-src 'self'` blocks. The alternatives were `'unsafe-inline'`, which permits *any* injected script, or per-request nonces, which a static export cannot produce. Hashing fails closed: an inline script not present at build time will not run |
| D18 | 2026-07-28 | IPC handlers resolve a discriminated result and never throw | Electron stringifies a thrown `Error` across IPC, destroying the typed taxonomy and forcing every call site into try/catch |
| D19 | 2026-07-28 | The E2E fixture awaits `firstWindow()` before yielding | The window is only created after the database boot sequence, so it is a reliable barrier. Without it, database assertions raced the migrator and failed intermittently |
| D20 | 2026-07-28 | **Hand-written UI primitives instead of the shadcn CLI** | The CLI wants to own project layout and expects a conventional single-app root; this repo has the renderer in a subdirectory alongside `electron/` and `shared/`. shadcn components are copy-in source anyway, so the CLI adds a layout constraint without adding capability. Radix primitives will be added directly for the components that need real accessibility behaviour (dialog, dropdown, tooltip) when those screens land. **Deviation from SPRINTS.md T1.6** |
| D21 | 2026-07-28 | **`app://` handler resolves Next's dot-flattened RSC payload paths** | The static export writes segment payloads nested (`devices/__next.devices/__PAGE__.txt`) but the client router requests them flattened (`devices/__next.devices.__PAGE__.txt`). Every client-side navigation 404'd. Navigation still worked because Next falls back to a full document load, which is exactly why this was easy to miss — the symptom was console noise plus a stale layout |
| D22 | 2026-07-28 | **Sidebar active state uses `useSelectedLayoutSegment`, not `usePathname`** | The sidebar lives in a persisted layout where `usePathname` did not update on client-side navigation in a static export, leaving every item marked active simultaneously. `useSelectedLayoutSegment` is the API intended for exactly this |

---

## 8. Deviations log

Anything built differently from `SPRINTS.md`. An empty table means the spec and the code agree.

| # | Date | Sprint | Deviation | Why | Spec updated? |
| --- | --- | --- | --- | --- | --- |
| — | — | — | *(none yet)* | — | — |

---

## 9. Known issues and technical debt

Carried forward between sprints. Nothing here may be silently dropped — it is either fixed or
explicitly accepted with a reason.

| # | Sprint found | Issue | Severity | Status |
| --- | --- | --- | --- | --- |
| K1 | 3 (by design) | A message in flight during a crash may send twice; bounded at one per device per crash | Accepted | Documented in SPRINTS §6.4 — WhatsApp offers no dedup primitive to eliminate it |
| K2 | 1 | ~~The `init` migration creates a spike-only `SpikeProbe` table~~ | ✅ Resolved | Baseline regenerated in T1.4 with the real 17-table schema; E1.13 asserts `SpikeProbe` is absent |
| K3 | 1 | Builds are unsigned; `electron-builder` reports "default Electron icon is used" | Expected | Resolved in T4.5 once REQUIREMENTS §2 (icon) and §4 (certificates) are supplied |

---

## 10. Test results history

One row per sprint completion. Regression counts are cumulative — a later sprint must re-run
every earlier suite.

| Date | Sprint | New | Regression | Total | Typecheck | Lint | Packaged smoke | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-27 | 1 (partial) | 5 | n/a | 5 pass / 0 fail | ✅ | ✅ | ✅ | T1.1, T1.2 complete; T1.11 harness up |
| 2026-07-27 | 1 (partial) | 3 | 5 | 8 pass / 0 fail | ✅ | ✅ | ✅ | T1.4 complete. Adds E1.13, E1.13b, E1.13c (real two-launch restart) |
| 2026-07-28 | 1 (partial) | 5 | 8 | 13 pass / 0 fail | ✅ | ✅ | ✅ | T1.3 + T1.5 complete. Adds E1.3 (CSP), E1.14b–e (IPC contract, allowlist, path containment). Stable across 2 consecutive runs |
| 2026-07-28 | 1 (partial) | 2 | 13 | 15 pass / 0 fail | ✅ | ✅ | ✅ | T1.6 + T1.7 complete. Adds E1.10c (all nine routes navigate, zero console errors) and E1.10d (active nav state). Stable across 2 consecutive runs |

---

## 11. Release history

| Version | Date | Platforms | Signed | Notarized | Notes |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | *(no releases yet)* |

---

## 12. How to update this file

At the end of every sprint, in the same commit as the code:

1. Set the sprint's row in §1 to 🟢 with dates, task count, E2E count and commit SHA.
2. Tick every task row in the sprint's own section.
3. Add a row to §10 with the actual test numbers — **the real numbers, including failures**.
4. Add any architectural choice to §7 with its reasoning.
5. Add anything built differently from the spec to §8, and say whether `SPRINTS.md` was updated
   to match.
6. Move anything unfinished or newly discovered into §9 rather than leaving it undocumented.
7. Update the "Last updated" date at the top.

A sprint is not complete until this file reflects reality.
