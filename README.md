# RapBooster Advance

An Electron + Next.js desktop application for WhatsApp marketing, built on
[Baileys](https://github.com/WhiskeySockets/Baileys), with a local SQLite database created per
user in the OS application-data directory.

> **Status: feature-complete, not yet shippable.**
> All four sprints are built and the full test suite passes against a packaged build. What is
> missing is the release itself — no build has been signed and no update has ever been
> installed, because that needs branding, an update feed URL and code-signing certificates.
> See [REQUIREMENTS.md §2–§4](./REQUIREMENTS.md) and [RELEASE.md](./RELEASE.md).
>
> **An unsigned Windows installer triggers a SmartScreen warning most people will not click
> through.** A code-signing certificate is the single item standing between this and a
> shippable product.
>
> **Windows is the only distribution target** — macOS packaging and Apple signing were removed
> on 2026-07-28 at the customer's instruction.

## What it does

Nine screens, all derived from the prototypes in `design/`:

**Dashboard** · **Inbox** · **Campaigns** · **WA Groups** · **Devices** · **Contacts** ·
**Templates** · **AI Bot** · **Settings**, behind a license activation gate.

- Connect up to 20 WhatsApp accounts concurrently, by QR code or 8-digit pairing code
- Contact lists with custom fields, CSV import/export at 50,000-row scale
- Message templates — text, media, interactive, and button — with `{{Name}}` merge tags
- Bulk campaigns with randomized delays, sleep intervals, scheduling, and crash-safe resume
- Group sync, bulk group messaging, and bulk group creation
- Unified inbox across all connected devices
- OpenAI-powered auto-replies with escalation rules

## Requirements

- **Node.js 20 or newer**
- **Windows.** It is the only distribution target; installers are produced on Windows.
- No Python or C++ toolchain needed. Electron is pinned to 42.7.1 so the `better-sqlite3`
  prebuilt binaries match its ABI; upgrading Electron without checking that forces a source
  build on every machine.

## Getting started

```bash
npm install          # also runs prisma generate + electron-builder install-app-deps
npm run dev          # Next dev server + Electron, with hot reload
```

The app creates its database at `app.getPath('userData')` on first launch and applies
migrations automatically. Nothing to set up by hand.

By default the app uses the **real** Baileys transport and the **real** license HTTP client —
and since no license server is configured yet (REQUIREMENTS §1), it will gate at activation.

## Running without a license server

Use mock mode. It is the supported way to exercise the whole product before REQUIREMENTS §1 is
answered:

```bash
npm run dev:mock
```

That is `npm run dev` with `LICENSE_SERVICE=mock` and `WA_TRANSPORT=mock` — a deterministic
license server and a fake WhatsApp transport, so **no license server and no real WhatsApp
account are involved**. Set either variable yourself if you want only one of them mocked:

```bash
LICENSE_SERVICE=mock npm run dev     # mock licensing, real WhatsApp
WA_TRANSPORT=mock npm run dev        # real licensing, fake WhatsApp
```

Mocks are opt-in rather than defaulted-on, so nothing can ship with one silently active. The
E2E suite sets them itself.

### Test license keys

The mock decides from the key's **prefix**, so any suffix works — the branch is what matters:

| Key                 | What happens                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `VALID-DEMO-001`    | Activates. This is the one to use for normal testing               |
| `CONFLICT-DEMO-001` | Reports the license is on another machine, then transfers on retry |
| `EXPIRED-DEMO-001`  | Rejected as expired                                                |
| `REVOKED-DEMO-001`  | Rejected as revoked                                                |
| `OFFLINE-DEMO-001`  | Server unreachable — drives the offline grace-period path          |
| anything else       | Rejected as invalid                                                |

Defined in `electron/main/services/license/mock.ts`.

### Driving the fake WhatsApp transport

Devices link instantly and sends succeed by default. These variables let you make it behave
like a bad day, which is where the interesting bugs are:

| Variable             | Default | Effect                                         |
| -------------------- | ------- | ---------------------------------------------- |
| `WA_MOCK_LATENCY_MS` | `0`     | Artificial delay per send                      |
| `WA_MOCK_FAIL_RATE`  | `0`     | Fraction of sends that fail, `0`–`1`           |
| `WA_MOCK_CONNECT_MS` | `50`    | Delay before a linked device reports connected |
| `WA_MOCK_INCOMING`   | `0`     | Inbound messages synthesised per linked device |

```bash
WA_MOCK_FAIL_RATE=0.2 WA_MOCK_LATENCY_MS=400 npm run dev:mock
```

Runtime data lives under `%APPDATA%\RapBooster`. Delete that folder to start from a clean
database and an unactivated app.

## Commands

| Command              | What it does                                                           |
| -------------------- | ---------------------------------------------------------------------- |
| `npm run dev`        | Development, with hot reload                                           |
| `npm run dev:mock`   | Development with the mock license server and mock WhatsApp transport   |
| `npm run verify`     | Format, lint, typecheck, and dependency checks — run before committing |
| `npm run build`      | Production bundles for main, preload, wa-service and the renderer      |
| `npm run pack`       | Unpacked build in `dist/`, no installer                                |
| `npm run dist`       | Windows NSIS installer in `dist/`                                      |
| `npm run test:e2e`   | Full Playwright suite against a real Electron instance (81 specs)      |
| `npm run test:smoke` | Packages the app and runs its self-test — catches asar/native issues   |
| `npm run db:studio`  | Browse the local database                                              |

Before committing, the gate is `npm run verify && npm run test:e2e && npm run test:smoke`.

## Architecture

Four processes, and the boundaries between them are enforced rules rather than conventions
(see [CLAUDE.md §2](./CLAUDE.md)):

| Process        | Responsibility                                                   |
| -------------- | ---------------------------------------------------------------- |
| **main**       | Owns the database. The only writer. Runs the campaign scheduler  |
| **preload**    | Sandboxed bridge. Exposes one validated `window.api.invoke`      |
| **renderer**   | Next.js static export. No Node access at all                     |
| **wa-service** | Utility process. Owns every Baileys socket and the send throttle |

The rules that matter most:

- **Nothing calls `sock.sendMessage` directly.** Every outbound message goes through the
  throttle scheduler — this is the anti-ban core, and bypassing it risks the user's accounts.
- **Campaign state lives in SQLite, never in memory.** A crash mid-campaign resumes from the
  first pending recipient without re-sending anything already delivered.
- **`wa-service` never writes to the database.** One writer, no lock contention.

## Measured behaviour

Against the packaged Windows build, on the mock transport:

| Metric                                         | Value                                 |
| ---------------------------------------------- | ------------------------------------- |
| Startup (process start → app + database ready) | ~950 ms                               |
| Idle memory, all processes                     | ~530 MB                               |
| Cost of 20 connected devices                   | +13 MB                                |
| Memory drift over a running campaign           | none — falls as the heap is reclaimed |

Reproduce with `npm run pack && node scripts/perf.mjs`, and
`PERF=1 npx playwright test perf-load` for the 20-device profile.

## Documents

| Document                                 | What it is                                                            |
| ---------------------------------------- | --------------------------------------------------------------------- |
| [REQUIREMENTS.md](./REQUIREMENTS.md)     | **Open questions only.** §1–§5 are what still block shipping          |
| [RELEASE.md](./RELEASE.md)               | How to build, sign and publish a Windows update                       |
| [SPRINTS.md](./SPRINTS.md)               | Full specification: screens, schema, IPC contract, algorithms         |
| [SPRINT-TRACKER.md](./SPRINT-TRACKER.md) | Live status, decision log, known issues, test history                 |
| [CLAUDE.md](./CLAUDE.md)                 | Engineering rules for every coding session                            |
| `design/`                                | Original HTML prototypes — the feature reference, never imported from |

## Known limitations

- **Whether buttons render is WhatsApp's decision, not ours.** Templates send real quick-reply,
  link, call and copy buttons, and interactive templates send a single-select list — but
  WhatsApp can refuse them per recipient without notice, so every interactive send falls back
  to a numbered list automatically. The message always arrives. See REQUIREMENTS §7.9.
- **The AI escalation confidence threshold is stored but not enforced** — OpenAI returns no
  confidence score. The screen says so rather than showing a control that does nothing.
- **A message in flight during a crash may send twice**, bounded at one per device per crash.
  WhatsApp offers no deduplication primitive that would remove this.

Full list, with reasoning, in [SPRINT-TRACKER.md](./SPRINT-TRACKER.md).
