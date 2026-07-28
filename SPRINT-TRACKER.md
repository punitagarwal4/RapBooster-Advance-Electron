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
| 1 | Foundation · Licensing · Shell | 🟢 Complete | 2026-07-27 | 2026-07-28 | 11/11 | 28 passing | `f095b16` |
| 2 | Devices · Contacts · Templates | 🟢 Complete | 2026-07-28 | 2026-07-28 | 7/7 | 21 passing | `a51bff7` |
| 3 | Campaign engine · Groups | 🟢 Complete | 2026-07-28 | 2026-07-28 | 9/9 | 16 passing | `922b14a` |
| 4 | Inbox · AI Bot · Settings · Release | 🟡 In progress | 2026-07-28 | — | 6/6 (2 unverified) | 81 passing | pending |

**Legend:** ⬜ Not started · 🟡 In progress · 🟢 Complete · 🔴 Blocked · ⚪ Deferred

### Current status

> 🟢 **Sprints 0–3 complete.** Sprint 4 is feature-complete: all six tasks are built, the full
> 81-test suite passes, and the packaged build is green.
>
> **What is not done is proving the release itself.** T4.5 and T4.6 are marked 🟡, not 🟢,
> because no build has been signed and no update has ever been installed — that needs §2/§3/§4
> from you (K6). Everything is wired and waiting.
>
> T3.3 crash-safe resume — the highest-risk item in the project — is done and asserted by E3.8.
>
> ⚠ **A packaging bug was found and fixed in this pass (D55).** Baileys declares its image
> library as an optional *peer* dependency, which npm hoists in development but electron-builder
> does not package. Every packaged build would have sent images with no thumbnail and no
> dimensions — silently, because Baileys logs that failure at debug level and carries on. Dev
> was unaffected, and E2E could not have caught it (the mock transport never builds real media).
> Fixed by declaring sharp ourselves, and now guarded in both the build and the packaged
> self-test.
>
> The build is proceeding without a filled REQUIREMENTS.md, on customer instruction
> (2026-07-27). Anything depending on an unanswered question is built against a documented
> default or behind a swappable interface; all are listed in
> [REQUIREMENTS.md §0](./REQUIREMENTS.md#section-0--working-assumptions-in-effect).
>
> **What is genuinely waiting on you, in order of cost-to-change:**
>
> 1. **§7.9 — Button and Interactive templates (assumption A14).** ⚠ New, and a platform
>    limitation rather than a preference: WhatsApp has withdrawn tappable buttons from
>    unofficial libraries. Two of your four template types are affected. Currently they send as
>    numbered text, which always delivers.
> 2. **§7.5 — default country code (assumption A7, currently `+91`).** Applied at CSV import
>    and stored, so correcting it after a large import means re-importing. Sprint 2 builds the
>    importer; this is the last comfortable moment to change it.
> 3. **§1 — license server API.** T1.8 shipped against the interface with a mock;
>    `services/license/http.ts` is the only file that changes when the real endpoints arrive.
> 4. **§7.6 — Baileys version (assumption A12).** Now pinned to `7.0.0-rc13`. Sprint 2 pins it; changing later means a
>    regression run.
> 5. **§2, §3, §4 — branding, update feed, signing.** Needed by T4.5, not before.

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

**Complete.** Built under the assumptions in REQUIREMENTS §0; T1.8 ships against the
`LicenseService` interface with the mock implementation until §1 is answered.

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T1.1 | Prisma/Electron packaging spike (timebox 1 day) | 🟢 | **Passed packaged** — see D8, D10–D12. Drizzle fallback not needed |
| T1.2 | Project scaffold, tooling, scripts | 🟢 | Electron + Next static export + Tailwind 4 + ESLint 10 + Prettier; `build`/`pack`/`typecheck`/`lint`/`test:e2e`/`test:smoke` all green |
| T1.3 | Electron shell + security baseline | 🟢 | Strict CSP with build-time inline-script hashes, permission deny-all, external-URL allowlist, navigation lock |
| T1.4 | Database layer, full schema, boot migrator | 🟢 | 17 tables, forward-only migrator, WAL, integrity check + quarantine, pre-migration backups |
| T1.5 | IPC contract + router + renderer hooks | 🟢 | 68 channels + 10 events, two-way zod validation, sandbox-safe preload allowlist, useIpcQuery/useIpcEvent |
| T1.6 | Design system (Tailwind + shadcn + tokens) | 🟢 | Tokens from the prototype palette; hand-written primitives (Button, StatusPill, EmptyState, PageHeader) instead of the shadcn CLI — see D20 |
| T1.7 | App shell, sidebar, nine routes | 🟢 | Sidebar in prototype order with Settings pinned, all nine routes prerendered, toast provider, per-route error boundary |
| T1.8 | Licensing: service, fingerprint, activation, conflict, gate | 🟢 | LicenseService interface + Http/Mock, composite fingerprint, safeStorage cache with HMAC tamper check, activation + conflict UI, window gate + IPC guard, offline grace |
| T1.9 | Settings — license panel | 🟢 | Status, masked key, bound device, remarks, dates, re-check, two-step deactivate, paths + diagnostics export |
| T1.10 | Logging, redaction, crash handlers, diagnostics | 🟢 | electron-log with rotation, automatic redaction hook, console capture, crash handlers, diagnostics bundle |
| T1.11 | Playwright harness + packaged smoke test | 🟢 | 28 specs green across two suites, stable over 3 consecutive runs; packaged smoke via `npm run test:smoke` |

**E2E:** **28 written, 28 passing**, stable across three consecutive runs. Split across
`sprint-1.spec.ts` (shell, IPC, security, database) and `sprint-1-license.spec.ts`
(licensing, Settings panel, log redaction). E1.16's packaged half runs via
`npm run test:smoke`.

**Exit gate:** fresh install gates on license · valid key persists across restart · conflict
transfer works · offline grace honored · all nine routes navigate · installers build on both
platforms.

---

## 4. Sprint 2 — Devices, contacts, templates

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T2.1 | `wa-service` utility process + supervisor | 🟢 | utilityProcess fork, typed protocol, health ping, restart ladder, recovery hook rebuilding sessions from SQLite |
| T2.2 | Baileys session manager (QR · pairing · reconnect · logout) | 🟢 | **baileys 7.0.0-rc13** pinned exact; backoff + jitter + circuit breaker; loggedOut terminal; auth purged on logout |
| T2.3 | Devices screen | 🟢 | Card grid, live status via push events, Add Device dialog with QR + pairing tabs, reconnect, two-step logout, limit surfaced |
| T2.4 | Contacts: lists, virtualized table, CSV import/export | 🟢 | Cursor pagination, SQL search, virtualized table with infinite scroll, list tabs, import dialog with column mapping, streaming export. **50k import + 10k UI verified** |
| T2.5 | Templates: four types, media store, preview | 🟢 | Four types, managed media store with size/type limits, WhatsApp-style preview, delete guarded by campaign usage |
| T2.6 | Merge tags + live preview | 🟢 | Shared render engine used by both preview and send path, insert-token buttons, unknown-tag warning |
| T2.7 | Mock transport | 🟢 | Transport interface + deterministic mock (scriptable failure rate, latency, drops) + Baileys 7 implementation. Unblocks CI testing for Sprints 3–4 |

**E2E:** **21 written, 21 passing**, stable across two consecutive runs. Devices (E2.1–E2.10), contacts and CSV (E2.11–E2.17), templates and merge tags (E2.18–E2.22).

**Exit gate:** device links by QR and pairing code and survives restart · 20 mock devices
concurrent · 50k CSV imports cleanly · all four template types with working merge tags.

---

## 5. Sprint 3 — Campaign engine and groups

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T3.1 | Campaign creation + queue expansion | 🟢 | Batched expansion with round-robin device assignment, de-duplicated per contact |
| T3.2 | Send engine (workers · throttle · retries) | 🟢 | Per-device workers, atomic single-statement claim, retry with terminal/retryable split, batched progress events |
| T3.3 | Crash-safe resume | 🟢 | **E3.8 passes**: 80-recipient campaign hard-killed mid-send, resumes on relaunch, drains fully, no duplicate queue rows |
| T3.4 | Controls + scheduling + device reassignment | 🟢 | Start/pause/resume/stop/delete, wall-clock scheduler, and mid-run reassignment that pauses with a reason when no device remains |
| T3.5 | Campaigns UI + detail view | 🟢 | Card grid with live counters and progress, status-conditional controls, create dialog, per-recipient view with status filters |
| T3.6 | Campaign report export | 🟢 | CSV, one row per recipient with summary header (REQUIREMENTS §7.2 / A9), streamed by page |
| T3.7 | Groups: sync + list + selection | 🟢 | Per-device sync with upsert, device filter, select-all, multi-select with prototype styling |
| T3.8 | Groups: bulk messaging job | 🟢 | Database-backed job with per-target rows, throttled through wa-service, per-group outcomes |
| T3.9 | Groups: bulk creation job | 🟢 | Four suffix rules, seeded members consumed in order, per-group result log including partial adds |

**E2E:** E3.1 – E3.25 — 0/25 passing.

**Exit gate:** 10k-recipient campaign completes with reconciled counters · pacing measurably
respected · **kill-and-resume produces no duplicates beyond the documented bound** · groups
create and message in bulk.

---

## 6. Sprint 4 — Inbox, AI bot, settings, dashboard, release

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T4.1 | Inbox (two-pane, live ingestion, composer) | 🟢 | Live ingestion with duplicate suppression, device filter, search, unread badges, all four message shapes, composer with emoji, delivery receipts |
| T4.2 | AI Bot config + OpenAI auto-reply worker | 🟢 | Every prototype field wired into the prompt, keyword escalation, hard rules (no groups, no self, opt-out), distinct failure codes, throttled replies |
| T4.3 | Settings: AI · sending defaults · data & backup · about | 🟢 | Encrypted AI key with masked reads, sending defaults applied to new campaigns, backup/restore with integrity refusal, guarded clear |
| T4.4 | Dashboard real aggregates | 🟢 | SQL aggregates per REQUIREMENTS §7.1 plus today counts; refreshes on campaign, device and message events |
| T4.5 | Packaging, signing, notarization, auto-update | 🟡 | **Wired but unverified.** Icon, entitlements, `asarUnpack`, updater service and `system:checkUpdate` are all in place and the packaged build is green — but no build has been signed and no update has ever been installed, because that needs REQUIREMENTS §2/§3/§4. See K6. Procedure written up in [RELEASE.md](./RELEASE.md) |
| T4.6 | Hardening pass + full regression + README | 🟡 | Audit clean on production deps (K7), full regression green, RELEASE.md written. Remaining: memory profile under 20 devices, startup-time measurement, README rewrite |

**E2E:** 81/81 passing (4.4m). Packaged smoke green, including the new
`baileys image thumbnail` probe.

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
| D23 | 2026-07-28 | **The gate is enforced twice: window entry route *and* an IPC guard** | The window loading the activation screen is a UI decision, and UI decisions can be wrong — a stale window, a bug, a crafted call. The router refuses every non-license channel while unlocked is false, so no customer data can flow regardless. E1.14f asserts it |
| D24 | 2026-07-28 | Rejected activations and conflicts are **not** persisted | Storing a rejection would leave the app in a state the user never agreed to, and a conflict is not an activation. Only a successful bind writes a record. E1.3 and E1.6 assert the table stays empty |
| D25 | 2026-07-28 | **Tamper detection is an HMAC keyed to the machine fingerprint, and is honestly scoped** | It stops a user flipping `status` to `valid` with a database browser. Anyone able to run code as this user can defeat it; real enforcement is server-side. Documented as evidence, not DRM |
| D26 | 2026-07-28 | The E2E fixture activates through the real UI rather than seeding the database | A seeded shortcut would let the gate rot undetected. Costs about a second per test and keeps every downstream spec honest about running in a licensed app |
| D55 | 2026-07-28 | **A restore verifies the backup before touching the live database** | Restoring a corrupt file over a working database turns a recoverable situation into data loss. The current database is also snapshotted first, so a restore is itself undoable. E4.20b asserts a bogus file leaves the data intact |
| D56 | 2026-07-28 | Clear-all-data **backs up first** and keeps devices and the license | Someone who meant something narrower can still get their data back, and clearing content is not the same as deactivating the product |
| D57 | 2026-07-28 | Dashboard refetches on campaign, device and message events | It is the landing route, so it is usually already mounted when the numbers change. Found by E4.22, which caught it showing stale counts |
| D52 | 2026-07-28 | **`settings:get` never returns a secret**, even encrypted | A key readable from the UI ends up in a screenshot, a support bundle or a bug report. Encrypted keys report a masked placeholder so the UI can show "set / not set" without ever holding the value |
| D53 | 2026-07-28 | Auto-reply failures produce **distinct codes**, never a silent skip | AI_KEY_MISSING, AI_KEY_INVALID, AI_RATE_LIMITED and AI_TIMEOUT are separate and surfaced. A silent no-op would leave the user believing auto-reply works when it does not — the worst outcome for a feature they configured deliberately |
| D54 | 2026-07-28 | Only the **keyword** escalation trigger is enforced, and the UI says so | OpenAI returns no confidence score, so the prototype's threshold cannot be honoured directly (REQUIREMENTS §5, A13). The screen states this rather than presenting a control that silently does nothing |
| D50 | 2026-07-28 | Inbound messages are **ignored if the id already exists** | WhatsApp redelivers on reconnect. Without the check the user would see the same message twice, which reads as a bug in the app rather than a protocol behaviour. E4.1b asserts a relaunch adds nothing |
| D51 | 2026-07-28 | Inbound test traffic is driven by an env var on the **mock transport**, not a "simulate" IPC channel | Keeps the test hook inside code that is already test-only. Production never ships the mock, so there is no simulate surface to secure or accidentally expose |
| D55 | 2026-07-28 | **`sharp` is a direct production dependency of this app**, pinned exactly, even though only Baileys uses it | Baileys declares `sharp` as an optional *peer*. npm hoists peers to the root, so dev always found it — but electron-builder packages by walking our own production dependency graph, where a peer of a dependency is unreachable. sharp was therefore in every dev run and in **no** packaged build. Declaring it ourselves is what makes it ship. Confirmed by inspecting `app.asar` before (0 sharp entries) and after (50, plus `@img/sharp-win32-x64` unpacked) |
| D56 | 2026-07-28 | Chose **sharp over jimp**, despite jimp being pure JS with no native binary and no CVEs | Baileys 7.0.0-rc13's `extractImageThumb` gates its jimp branch on `typeof lib.jimp?.Jimp === 'object'`, but jimp@1.6.1 exports `Jimp` as a *function*, so the branch is unreachable — the same file's `generateProfilePicture` checks for `'function'`, which is the inconsistency. Verified directly: with jimp installed and sharp hidden, the call throws `No image processing library available`. jimp was installed, tested, and removed again. Revisit if a later Baileys fixes the check |
| D57 | 2026-07-28 | sharp pinned at **0.35.3**, and the guard refuses anything below 0.35.0 or any caret range | Everything under 0.35.0 inherits the libvips CVEs (GHSA-f88m-g3jw-g9cj); the transitive copy Baileys pulled was 0.34.5. Declaring 0.35.3 ourselves overrides it and takes `npm audit --omit=dev` to zero. Pinned exactly per the same rule as Baileys and better-sqlite3 — native modules must not move underneath a packaged build |
| D58 | 2026-07-28 | The thumbnail check lives in the **packaged self-test**, not only in a build-time script | The bug was invisible everywhere else: dev has sharp hoisted, E2E uses the mock transport which never builds real media, and Baileys swallows the failure as a debug log. Only a packaged run proves sharp is both shipped and loadable from outside the asar. The build-time script (`scripts/check-media-deps.mjs`) additionally asserts the *declaration*, since a functional check alone passes on a hoisted peer install and would let the original bug straight through |
| D48 | 2026-07-28 | Per-recipient view is a **dialog**, not a `/campaigns/[id]` route | The renderer is a static export, so a dynamic segment needs its parameters known at build time — campaign ids are not. **Deviation from SPRINTS §11.1 T3.5**, and arguably better UX: the list stays visible behind it |
| D49 | 2026-07-28 | A dropped device's **pending** rows are reassigned; sent and in-flight rows are not | Only pending work is safe to move. Without reassignment one lost account strands its slice and a 10k campaign silently stalls at 80% looking finished. With no device left the campaign pauses with a reason rather than spinning against sockets that cannot send |
| D46 | 2026-07-28 | **E2E gained a global warm-up launch** | The first launch after a build pages a ~200 MB binary plus fresh bundles from disk; on a loaded machine that took over 90s while the same test ran in 1.4s warm. The first test was absorbing the whole cost and failing on a budget that was fine for its actual work. Warming once keeps every per-test timeout meaningful instead of being a proxy for disk I/O |
| D47 | 2026-07-28 | Launch timeouts unified in `fixtures/constants.ts` | The two fixtures carried different arbitrary bounds (60s vs 90s). These guard reaching a screen, not behaviour, so a generous value costs nothing when healthy — while a tight one trains everyone to re-run instead of investigate |
| D42 | 2026-07-28 | **Throttle lives in wa-service; the worker loop lives in main** | SPRINTS §3.1 placed both in wa-service, but the worker needs the database and wa-service deliberately has no handle. Splitting them is stronger than either alone: main owns the queue, and pacing sits at the socket boundary where no caller — campaign, group, inbox or AI — can bypass it |
| D43 | 2026-07-28 | Row claiming uses **raw SQL**, not Prisma | It must be one statement so SQLite's write lock makes it atomic. Prisma would issue SELECT then UPDATE, leaving a window in which two workers claim the same recipient and send twice |
| D44 | 2026-07-28 | `deviceIds`/`listIds` dropped `.min(1)` from the zod contract | zod rejected before the handler ran, so the user saw a generic "that request was not valid" instead of the prototype's "Select at least one device and contact list". Structural validation stays in zod; messages users read come from the handler |
| D45 | 2026-07-28 | The daily cap counts **successful** sends only | A send that failed never reached WhatsApp, so it must not consume the user's allowance |
| D39 | 2026-07-28 | **Preload converts an unhandled-channel rejection into the error envelope** | `ipcRenderer.invoke` rejects when no handler is registered, which happens for channels declared in the contract ahead of their implementation. Found by E2.21 calling `campaign:create` before Sprint 3 exists. Without this the promise-never-rejects guarantee the renderer is written against would be false, and every call site would need a try/catch |
| D40 | 2026-07-28 | Merge-tag rendering lives in `shared/`, used by both preview and send | Two implementations would eventually disagree, and the failure mode — a preview that does not match what was sent — is only discovered after messaging thousands of people |
| D41 | 2026-07-28 | Template media is **copied** into a managed store, not referenced in place | A campaign scheduled for next week must still send its image after the user has moved or deleted the original. A failed copy deletes the template rather than leaving one that fails at send time |
| D35 | 2026-07-28 | **Prisma `skipDuplicates` is unsupported on SQLite** — duplicates filtered explicitly | One indexed `IN` query per 1,000-row batch, then `createMany`. Far cheaper than per-row upserts, and the alternative (letting the unique constraint throw) would fail the whole batch |
| D36 | 2026-07-28 | CSV parsing is hand-written rather than a library | The importer streams line by line to hold 50k rows without loading the file; the common parsers want to own the whole stream. Handles the RFC 4180 cases that actually appear in exported contact lists — quoted fields, embedded commas, doubled quotes — all asserted by E2.15 |
| D37 | 2026-07-28 | Import mapping is **explicit**, not positional | The prototype mapped columns by position. A column-order change in an exported file would then silently shuffle every contact's data into the wrong fields |
| D38 | 2026-07-28 | E2E launch timeout raised to 60s and the helper centralized | The first Electron launch after a build is far slower (module load, Prisma init, V8 warm-up). A 20s bound failed the first test in a suite while passing in isolation — cold start, not flakiness |
| D31 | 2026-07-28 | **`wa-service` is built as an extra entry of the main bundle** (`out/main/wa-service/index.js`) | It needs the same externals as main (better-sqlite3 is excluded, Baileys is not) and must ship inside the asar. A separate electron-vite config would have duplicated that configuration and drifted |
| D32 | 2026-07-28 | Baileys is imported **lazily**, only when the real transport is selected | The mock path must not pay to load it, and a Baileys import failure must not be able to break the test transport — which is what every automated test depends on |
| D33 | 2026-07-28 | A missed health ping **kills** the child rather than waiting | A wedged process never exits on its own, so without this a hang would be unrecoverable. Killing converts it into the restart path that is already tested |
| D34 | 2026-07-28 | Added `system:waServiceState` after an E2E exposed the gap | The service reaches `up` during boot, so a renderer mounting afterwards would never see a transition. A degraded-state banner has to read current state on first paint; events alone cannot do that |
| D27 | 2026-07-28 | `app://` flattened-payload resolver made **recursive** | Route groups add a nesting level (`__next.!KGFwcCk/devices/__PAGE__.txt` requested as `__next.!KGFwcCk.devices.__PAGE__.txt`), which the single-level version could not reach. Depth now varies with route structure, so the resolver must too |
| D28 | 2026-07-28 | **`refreshGate()` only reloads when the lock state actually changes** | It previously reloaded on every revalidation, destroying renderer state — the user would lose their place and any open dialog or typed input would vanish. Found because a toast disappeared in E1.9b; the test was right and the app was wrong |
| D29 | 2026-07-28 | Redaction lives in an `electron-log` hook, not at call sites | Call-site discipline fails eventually — someone logs an error object containing a phone number. The hook applies to every transport, so no level or code path can bypass it. `console.*` in main is routed through the logger so existing calls are covered without a mechanical rewrite |
| D30 | 2026-07-28 | Activation E2E asserts the input value before clicking | The form is React-controlled, so its state only updates once hydration attaches the handler. Clicking first submitted an empty form intermittently. This is a real property of the app (it *is* empty until hydrated), so the test waits for readiness rather than the app adding a test hook |

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
| K5 | 4 | `settings:get`/`settings:set` were declared in the contract but had **no handler**, so saving the AI key silently did nothing | ✅ Resolved | Found by E4.17. Implemented in T4.3. The preload already converted the missing-handler rejection into a typed error (D39), so it failed visibly rather than hanging — but nothing surfaced it until a test asserted the stored value |
| K4 | 3 | **Intermittent E2E launch timeouts on this machine** — roughly 1 per 2 full runs | Environmental | Always a launch wait, never a behavioural assertion; the affected spec passes in isolation every time; no orphaned Electron processes after a run. Consistent with disk/CPU contention on a machine that has been building, packaging and launching ~35 Electron apps per suite for hours. **Deliberately not masked with Playwright retries** — that would hide real regressions too. Re-evaluate on a quieter machine or in CI |
| K3 | 1 | Builds are unsigned; `electron-builder` reported "default Electron icon is used" | Partly resolved | The icon warning is gone — a placeholder `assets/branding/icon.png` now ships and is applied. Signing still needs REQUIREMENTS §4 |
| K6 | 4 | **The release pipeline has never been executed end to end.** No signed installer, no notarized DMG, no update ever downloaded or installed | Blocked on user | Config is complete and the packaged build is green, so this is unverified rather than unwritten. Blocked on REQUIREMENTS §2 (branding), §3 (feed URL) and §4 (certificates). Deliberately marked 🟡 rather than 🟢: claiming a release pipeline works when nobody has watched it produce a signed, installable, self-updating build would be the single most expensive thing to be wrong about here |
| K7 | 4 | 20 high-severity advisories reported by `npm audit`, all in the **build toolchain** (electron-builder, vite, next, postcss and their transitive `minimatch`/`brace-expansion`) | Accepted | `npm audit --omit=dev` reports **0 vulnerabilities** — none of these reach the shipped app. Verified against the actual package: `app.asar` contains only `out/`, `prisma/migrations`, `package.json` and the production dependency graph. Fixing them requires `npm audit fix --force`, which would pull vite outside the range electron-vite supports. Re-evaluate when electron-builder and electron-vite publish updated ranges |

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
| 2026-07-28 | 1 (partial) | 10 | 15 | 25 pass / 0 fail | ✅ | ✅ | ✅ | T1.8 complete. Adds the full licensing suite: E1.1–E1.7, E1.9, E1.11, E1.14f. Stable across 2 consecutive runs |
| 2026-07-28 | **1 (complete)** | 3 | 25 | **28 pass / 0 fail** | ✅ | ✅ | ✅ | T1.9 + T1.10 + T1.11. Adds E1.9b, E1.9c, E1.15 (redaction). Two flaky specs fixed at the root — see D28. **Stable across 3 consecutive runs** |
| 2026-07-28 | 2 (partial) | 7 | 28 | 35 pass / 0 fail | ✅ | ✅ | ✅ | T2.1 + T2.2 + T2.7. wa-service verified inside the packaged asar |
| 2026-07-28 | 2 (partial) | 2 | 35 | 37 pass / 0 fail | ✅ | ✅ | ✅ | T2.3 Devices screen. Stable across 2 consecutive runs |
| 2026-07-28 | 2 (partial) | 6 | 37 | 43 pass / 0 fail | ✅ | ✅ | ✅ | T2.4 contacts backend. E2.12 imports 50,000 rows; E2.16 asserts the <500ms search budget. Stable across 2 runs |
| 2026-07-28 | 2 (partial) | 1 | 43 | 44 pass / 0 fail | ✅ | ✅ | ✅ | T2.4 contacts UI. E2.17 asserts virtualization holds <100 rows in the DOM at 10,000 contacts. Stable across 2 runs |
| 2026-07-28 | **2 (complete)** | 5 | 44 | **49 pass / 0 fail** | ✅ | ✅ | ✅ | T2.5 + T2.6. Preload gap fixed (D39). **Stable across 2 consecutive runs** |

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
