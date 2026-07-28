# CLAUDE.md — Engineering Instructions

Rules for every coding session in this repository. Read this **before** touching code.

| Document                                 | Purpose                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `CLAUDE.md` (this file)                  | How to work — architecture rules, standards, workflow                  |
| [SPRINTS.md](./SPRINTS.md)               | What to build — full spec, schema, IPC contract, algorithms            |
| [SPRINT-TRACKER.md](./SPRINT-TRACKER.md) | Where we are — status, decisions, deviations                           |
| [REQUIREMENTS.md](./REQUIREMENTS.md)     | Customer inputs still outstanding — answered items move to the tracker |
| `design/`                                | Original HTML prototypes — reference only, **never import from here**  |

---

## 1. Project in one paragraph

RapBooster Advance is a licensed Windows desktop app for WhatsApp marketing: Electron
shell, Next.js renderer, Baileys for WhatsApp, local SQLite per OS user. It connects up to 20
WhatsApp accounts concurrently and runs bulk campaigns, group operations, a unified inbox, and
an OpenAI auto-responder. Nine screens, all defined in `SPRINTS.md` §2. Four sprints, each
ending with Playwright E2E tests, a commit, and a push to `main`.

### 1.1 Non-negotiable decisions

Do not revisit these without an explicit customer instruction recorded in the tracker.

| Topic       | Decision                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------- |
| Scope       | The prototype's 9 screens. Number Filter, Group Grabber, Warmup, Spintax are **out**      |
| Processes   | main + preload + renderer + `wa-service` utility process                                  |
| Renderer    | Next.js `output: 'export'`, client-only, no SSR, no API routes                            |
| Database    | SQLite at `app.getPath('userData')`, Prisma + better-sqlite3, **main is the sole writer** |
| WhatsApp    | Baileys, pinned exactly, wrapped behind our own transport interface                       |
| Concurrency | 20 devices max, **one in-flight message per device**                                      |
| Licensing   | Remote server, hard gate before the main window exists                                    |
| AI          | OpenAI, end-user key, stored via `safeStorage`                                            |
| Branch      | Work on `main`, commit and push at each sprint completion                                 |

---

## 2. Architecture rules

These are invariants. Breaking one is a bug even if tests pass.

1. **The renderer never touches Node.** No `fs`, no `child_process`, no direct database access,
   no `require`. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Every
   piece of data crosses through `window.api`.
2. **`shared/ipc.ts` is the only contract.** Every channel has a zod request schema and a zod
   response schema, validated in both directions. Adding a channel means editing that file
   first, then the handler, then the caller.
3. **Baileys never runs in the main process.** It lives in `wa-service`. Main talks to it over
   MessagePort and knows nothing about sockets.
4. **`wa-service` never writes to SQLite.** It asks main to persist and reports results. One
   writer, no lock contention, one place to audit.
5. **Nothing calls `sock.sendMessage` directly.** Every outbound WhatsApp action — campaign
   message, group message, inbox reply, AI reply — goes through the throttle scheduler in
   `wa-service/throttle.ts`. This is the anti-ban core; bypassing it risks the user's accounts.
6. **Campaign state lives in SQLite, never in memory.** Counters are recomputed from
   `CampaignRecipient` rows. A process restart must be able to rebuild everything from the
   database alone.
7. **Nothing polls.** Progress and status reach the renderer as push events. No `setInterval`
   in the renderer to check whether something finished.
8. **Never import from `design/`.** Those prototypes are a feature reference. The customer
   confirmed the UI is rebuilt cleanly, not copied.

---

## 3. Multi-agent working mode

Use subagents by default wherever the work genuinely fans out. This is the customer's explicit
instruction — but fan out on _independent_ work, not on everything, because parallel agents
editing the same file produce conflicts that cost more than they save.

### 3.1 When to fan out

| Situation                                       | Agents                                                                | Example                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Exploring unfamiliar code                       | 1–3 **Explore** agents in parallel, each with a distinct search focus | "find every IPC handler" + "find every place devices are queried"           |
| Independent feature modules in one sprint       | One implementation agent per module                                   | Sprint 2: contacts · templates · devices screen — three separate file trees |
| Writing the E2E suite                           | A dedicated test-authoring agent, given the acceptance criteria       | Sprint 3's 25 specs                                                         |
| Pre-commit review                               | A review agent over the diff                                          | Every sprint, before pushing                                                |
| Investigating a failure with several hypotheses | One agent per hypothesis                                              | "is it the migrator, the adapter, or asar?"                                 |

Launch parallel agents **in a single message with multiple tool calls** — sequential launches
waste the benefit entirely.

### 3.2 When NOT to fan out

Keep these serial — they touch shared state and parallel edits will collide:

- Anything editing `shared/ipc.ts`, `shared/types.ts`, or `shared/errors.ts`.
- Prisma schema changes and migrations.
- `electron-builder` / packaging configuration.
- The throttle scheduler and campaign worker — one correctness-critical mind, not three.
- Any task where agent B needs agent A's output.

### 3.3 Rules for delegating

- Give each agent the **file paths and context it needs** — a cold agent that re-derives the
  architecture wastes more than it produces.
- Tell each agent explicitly which files it owns and which it must not touch.
- Never let two concurrent agents write the same file.
- Verify what agents report. A returned "done" is a claim, not a result — check the diff and
  run the tests yourself.

---

## 4. Graphify — codebase knowledge graph

[Graphify](https://github.com/Graphify-Labs/graphify) builds a queryable knowledge graph of the
codebase using local tree-sitter parsing (deterministic, no LLM, nothing leaves the machine for
code files). Use it to orient before touching unfamiliar areas instead of grepping blindly.

### 4.1 Setup, once per machine

```bash
uv tool install graphifyy       # or: pipx install graphifyy
graphify install                # registers the /graphify skill with the assistant
```

### 4.2 Use

```bash
/graphify .                     # build the graph (run once the scaffold exists)
/graphify . --update            # re-extract only changed files — run at the end of each sprint
graphify extract . --code-only  # local AST pass only, no API key needed

graphify query "what connects the campaign worker to the throttle scheduler?"
graphify path "CampaignWorker" "ThrottleScheduler"
graphify explain "SessionManager"
graphify export callflow-html   # visual call flow for review
```

### 4.3 Conventions for this repo

- Build the graph at the end of **Sprint 1**, then refresh with `--update` at the end of every
  sprint — it is part of the definition of done.
- **Commit** `GRAPH_REPORT.md` (useful diffable summary). **Git-ignore** `graphify-out/`.
- Before modifying a subsystem you did not write, run `graphify explain "<Thing>"` and
  `graphify path` between it and whatever you are about to connect it to. It is faster and more
  complete than a grep sweep, and it surfaces `INFERRED` edges a grep cannot.
- Re-running the code layer costs nothing (no LLM), so refresh freely rather than working from
  a stale graph.

---

## 5. Production-readiness standards

This app sends messages on behalf of real businesses from accounts that can be permanently
banned. "Works on my machine" is not the bar.

### 5.1 Error handling

- Every IPC handler maps failures onto the `shared/errors.ts` taxonomy (`SPRINTS.md` §5.4).
  A raw `Error` reaching the renderer is a bug.
- Each error carries a `userMessage` (safe to display) and a `detail` (logged, never shown raw).
- **No silent catches.** `catch {}` and `catch (e) { /* ignore */ }` are forbidden. If a failure
  is genuinely ignorable, log it at `debug` with a comment saying why.
- Every process installs global handlers: `uncaughtException`, `unhandledRejection`, and in main
  also `render-process-gone` and `unresponsive`.
- Every renderer route has an error boundary with a retry action.

### 5.2 Logging

- `electron-log` in all three processes, rotating under `userData/logs` (5 MB × 5 files).
- Structured entries: timestamp, level, process tag, correlation id, message, context.
- **Redaction is mandatory and automatic**: license keys, API keys, and phone numbers (keep the
  last 4 digits) are scrubbed by the logger itself, not by each call site. Assume every log
  file will eventually be emailed to support.
- Log every IPC call with channel and duration at `debug`; every send outcome at `info`; every
  reconnect at `warn`.
- Never log message _content_ — it is customer data.

### 5.3 Database

- Migrations are **forward-only** and applied at boot by our own migrator; the Prisma CLI must
  never be required at runtime.
- **Automatic timestamped backup before every migration**, retaining the last 5.
- `PRAGMA integrity_check` on boot with a documented recovery path.
- WAL mode, `foreign_keys=ON`, `busy_timeout=5000`.
- Every multi-row write is a transaction. Bulk operations batch at 1,000 rows.
- No unbounded `findMany` — always a `take` and a cursor.
- Index every foreign key and every column used in a `WHERE status = …`.
- Test migrations against a **populated** database, not an empty one.

### 5.4 WhatsApp safety

This is where careless code costs the user their accounts.

- Every send goes through the throttle scheduler. No exceptions, no "just this once".
- **One in-flight message per device.** Parallelism comes from more devices, never from
  concurrent sends on one account.
- Respect the configured random delay, sleep-after-N, and daily cap — all of them, always.
- Reconnect with exponential backoff (`min(60s, 2^n)` + jitter) and a circuit breaker after 10
  consecutive failures. **Never busy-loop a reconnect** — it looks like an attack to WhatsApp.
- `DisconnectReason.loggedOut` is terminal: purge the auth folder, require re-linking. Every
  other reason is retryable.
- Persist `creds.update` immediately, always. A dropped credential update means a re-scan.
- Automated tests use the **mock transport**. Never point CI at a real WhatsApp account.

### 5.5 Resilience

- `wa-service` is supervised: health-pinged, crash-detected, restarted with backoff, and its
  state rebuilt from SQLite.
- On boot, reset `CampaignRecipient` rows stuck in `sending` back to `pending`, then resume any
  `running` campaign from its first `pending` row (`SPRINTS.md` §6.4).
- Sends are keyed on `CampaignRecipient.id` with `@@unique([campaignId, contactId])`, so a
  contact can never be queued twice.
- The known, accepted limitation — one possible duplicate per device per crash — is documented
  in `SPRINTS.md` §6.4 and `SPRINT-TRACKER.md` §9. Do not paper over it; do not make it worse.
- Graceful shutdown stops workers, closes sockets, checkpoints WAL, and flushes logs.

### 5.6 Security

- License cache and OpenAI key encrypted with Electron `safeStorage`. If `safeStorage` is
  unavailable, degrade explicitly and tell the user — never store plaintext silently.
- **No secrets in the renderer, in logs, or in git.** Signing certificates and
  `REQUIREMENTS.local.md` are git-ignored.
- Strict CSP (`default-src 'self'`). `setWindowOpenHandler` denies everything.
  `will-navigate` blocked outside the app origin. `shell.openExternal` allowlisted.
- Validate every IPC payload with zod — treat the renderer as untrusted input even though we
  wrote it.
- Run `npm audit` each sprint and resolve or explicitly accept each finding.
- Never commit a real license key, phone number, or API key — not even in a test fixture.

### 5.7 Performance budgets

Testable numbers, not aspirations:

| Budget                                 | Target                                        |
| -------------------------------------- | --------------------------------------------- |
| Cold start to activation screen        | < 3 s                                         |
| Contacts table, 50,000 rows            | Smooth scroll, no dropped frames              |
| Contact search across 50,000 rows      | < 500 ms                                      |
| CSV import, 50,000 rows                | Completes with progress, UI stays interactive |
| 20 connected devices + active campaign | < 800 MB RSS                                  |
| Campaign progress events               | Batched — max 1/second per campaign           |

Techniques: virtualized tables and message threads, cursor pagination, batched transactional
writes, SQL aggregation for counters, worker threads for CSV parsing.

### 5.8 Code quality

- TypeScript `strict`. **No `any` at an IPC boundary** — ever.
- No `TODO`, `FIXME`, or commented-out code in a commit. Unfinished work goes in the tracker's
  §9, not in the source.
- Match the surrounding style — naming, comment density, file organization.
- Comments explain _why_, not _what_. Graphify extracts `NOTE`/`WHY` comments as first-class
  graph nodes, so use those prefixes for decisions worth surfacing.
- One responsibility per file. If an IPC handler module exceeds ~300 lines, split it by domain.
- Shared types live in `shared/`, never duplicated across processes.

---

## 6. Testing

- **Playwright via `_electron.launch()`** — real Electron, not a mocked DOM.
- Isolated `userData` per run; database reset between specs.
- `MockLicenseService` and the mock transport injected by environment variable.
- Screenshot, video and trace on failure.
- Test IDs come from `SPRINTS.md` (E1.1, E2.4, …) — keep the spec and the suite in sync.
- **Every sprint re-runs every earlier suite.** A regression is a blocker, not a footnote.
- `npm run test:smoke` packages the app and verifies the packaged binary launches — run every
  sprint, because native-module and Prisma packaging regressions surface nowhere else.
- Never write a test that talks to a real WhatsApp account or the real license server.

---

## 7. Workflow

### 7.1 Starting a sprint

1. Read `SPRINT-TRACKER.md` for current status, decisions and known issues.
2. Read the sprint's section in `SPRINTS.md` in full.
3. Confirm the REQUIREMENTS sections that sprint depends on are actually filled.
4. Refresh the graph (`/graphify . --update`) and orient with `graphify explain` if the area is
   unfamiliar.
5. Mark the sprint 🟡 in the tracker.

### 7.2 During a sprint

- Follow the task order in `SPRINTS.md` — spikes and blockers are deliberately sequenced first.
- Fan out to subagents per §3 where the work is independent.
- Write the E2E test alongside the feature, not at the end.
- If you must build something differently from the spec, record it in the tracker's deviations
  log and say whether `SPRINTS.md` was updated to match. **Do not silently diverge.**

### 7.3 Finishing a sprint

Every item in `SPRINTS.md` §13 must hold. In short:

```bash
npm run typecheck && npm run lint && npm run test:e2e && npm run test:smoke
graphify . --update
```

Then update `SPRINT-TRACKER.md` — status, real test numbers including failures, decisions,
deviations, known issues — and commit everything in one commit.

### 7.4 Git

- Work on `main` (the customer's instruction in the README).
- Conventional commits: `feat(campaigns): add crash-safe resume`.
- One push per sprint completion, with the tracker updated in the same commit.
- Never force-push. Never commit secrets, `node_modules`, build output, or `graphify-out/`.

---

## 8. Dependency policy

- **Baileys is pinned exactly** — no `^`, no `~`. Upgrading is a deliberate task with a full
  regression run, never an incidental `npm update`. It is wrapped behind our transport
  interface so an upgrade touches one file.
- No Baileys forks or wrappers (`baileys-pro`, `baileys-antiban`, `mahiru-baileys`). Our
  anti-ban pacing is in `SPRINTS.md` §6.1, is auditable, and does not add supply-chain risk to
  the most security-sensitive dependency in the app.
- Prefer the dependencies already listed in `SPRINTS.md` §14. Adding one outside that list
  needs a line in the tracker's decision log explaining why.
- Native modules (`better-sqlite3`, `sharp`) must rebuild for the Windows target and be listed in
  `asarUnpack` — a `.node` binary cannot be `dlopen`'d from inside an asar. Verify in the
  packaged smoke test, not just in dev.
- **A peer dependency of a dependency does not get packaged.** npm hoists peers to the root, so
  development always finds them, but electron-builder packages by walking _our_ production
  dependency graph — where they are unreachable. If a dependency needs an optional peer at
  runtime, declare it in our own `dependencies` or it will exist in every dev run and no
  shipped build. This cost us a real bug (tracker D55): Baileys resolves `sharp` this way for
  image thumbnails, so packaged builds sent every image with no thumbnail and no dimensions.
  It was silent — Baileys logs that failure at debug level and carries on.
- **When a dependency swallows its own failures, assert the outcome in the packaged
  self-test.** Anything guarded by `import(...).catch(() => {})` or a `try/catch` that only
  logs will not fail a build, will not fail E2E, and will not appear in any log anyone reads.
  `electron/main/self-test.ts` is the right place, because it runs inside the real package.

---

## 9. Common pitfalls in this codebase

Things that will bite, listed so nobody rediscovers them the expensive way.

| Pitfall                                         | Correct approach                                          |
| ----------------------------------------------- | --------------------------------------------------------- |
| Calling `sendMessage` outside the scheduler     | Always go through `throttle.acquire()` first              |
| Incrementing campaign counters in memory        | Recompute from `CampaignRecipient` with `GROUP BY status` |
| Polling for campaign progress from the renderer | Subscribe to the `campaign:progress` event                |
| Writing to SQLite from `wa-service`             | Send a message to main and let it persist                 |
| Reconnecting in a tight loop                    | Exponential backoff + jitter + circuit breaker            |
| Treating every disconnect as fatal              | Only `DisconnectReason.loggedOut` is terminal             |
| Loading all contacts to render a table          | Cursor pagination + virtualization                        |
| Parsing a 50k CSV on the main thread            | Stream it in a worker, insert in batches of 1,000         |
| Logging a phone number or license key           | The logger redacts automatically — never bypass it        |
| Assuming `safeStorage` is available             | Check `isEncryptionAvailable()` and degrade explicitly    |
| Testing against a real WhatsApp account         | Use the mock transport — a ban is unrecoverable           |
| Copying markup out of `design/`                 | It is a wireframe reference; build clean components       |

---

## 10. Quick reference

```bash
npm run dev           # Electron + Next dev server with HMR
npm run dev:mock      # …with the mock license server and mock WhatsApp transport
npm run build         # Build all processes
npm run dist          # Package the Windows NSIS installer
npm run typecheck     # tsc --noEmit across all tsconfigs
npm run lint          # ESLint
npm run test:e2e      # Playwright against a dev build
npm run test:smoke    # Package, then verify the packaged binary launches
npm run db:migrate    # Generate a migration from schema.prisma
npm run db:studio     # Inspect the local database
graphify . --update   # Refresh the knowledge graph
```

Runtime data lives under `app.getPath('userData')` — `%APPDATA%\RapBooster` on Windows.
Layout is in `SPRINTS.md` §3.4.
