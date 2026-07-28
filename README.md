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
> **An unsigned macOS build will not open on a customer's machine.** That is the single item
> standing between this and a shippable product.

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
- **Windows or macOS.** macOS builds must be produced on a Mac — signing and notarization call
  Apple tooling that does not exist elsewhere.
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
To work on the app without a license server or a WhatsApp account, opt into the mocks:

```bash
LICENSE_SERVICE=mock WA_TRANSPORT=mock npm run dev
```

Both are opt-in rather than defaulted-on in development, so that nothing can ship with a mock
silently active. The E2E suite sets them itself.

## Commands

| Command              | What it does                                                           |
| -------------------- | ---------------------------------------------------------------------- |
| `npm run dev`        | Development, with hot reload                                           |
| `npm run verify`     | Format, lint, typecheck, and dependency checks — run before committing |
| `npm run build`      | Production bundles for main, preload, wa-service and the renderer      |
| `npm run pack`       | Unpacked build in `dist/`, no installer                                |
| `npm run dist`       | Installers for the current platform                                    |
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
| [REQUIREMENTS.md](./REQUIREMENTS.md)     | **Customer inputs.** §2–§4 are what currently block shipping          |
| [RELEASE.md](./RELEASE.md)               | How to build, sign, notarize and publish an update                    |
| [SPRINTS.md](./SPRINTS.md)               | Full specification: screens, schema, IPC contract, algorithms         |
| [SPRINT-TRACKER.md](./SPRINT-TRACKER.md) | Live status, decision log, known issues, test history                 |
| [CLAUDE.md](./CLAUDE.md)                 | Engineering rules for every coding session                            |
| `design/`                                | Original HTML prototypes — the feature reference, never imported from |

## Known limitations

- **Button and Interactive templates send as numbered text.** WhatsApp has withdrawn tappable
  buttons from unofficial libraries; numbered text always delivers. See REQUIREMENTS §7.9.
- **The AI escalation confidence threshold is stored but not enforced** — OpenAI returns no
  confidence score. The screen says so rather than showing a control that does nothing.
- **A message in flight during a crash may send twice**, bounded at one per device per crash.
  WhatsApp offers no deduplication primitive that would remove this.

Full list, with reasoning, in [SPRINT-TRACKER.md](./SPRINT-TRACKER.md).
