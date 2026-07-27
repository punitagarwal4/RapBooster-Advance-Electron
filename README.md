# RapBooster Advance

An Electron + Next.js desktop application for WhatsApp marketing, built on
[Baileys](https://github.com/WhiskeySockets/Baileys), with a local SQLite database created per
user in the OS application-data directory.

> **Status: planning complete, implementation not started.**
> The repository currently contains the specification and the UI prototypes. Sprint 1 begins
> once [REQUIREMENTS.md](./REQUIREMENTS.md) is filled in.

## Documents

| Document | What it is |
| --- | --- |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | **Fill this first.** Customer inputs — license API, branding, signing, defaults. Blocks Sprint 1. |
| [SPRINTS.md](./SPRINTS.md) | The full specification: screens, architecture, database schema, IPC contract, algorithms, and the four sprints in detail |
| [SPRINT-TRACKER.md](./SPRINT-TRACKER.md) | Live status, decision log, deviations, test history |
| [CLAUDE.md](./CLAUDE.md) | Engineering rules for every coding session |
| `design/` | Original HTML prototypes — the feature reference |

## What it does

Nine screens, all derived from the prototypes in `design/`:

**Dashboard** · **Inbox** · **Campaigns** · **WA Groups** · **Devices** · **Contacts** ·
**Templates** · **AI Bot** · **Settings**, behind a license activation gate.

Core capabilities:

- Connect up to 20 WhatsApp accounts concurrently, by QR code or 8-digit pairing code
- Contact lists with custom fields, CSV import/export at 50,000-row scale
- Message templates — text, media, interactive, and button — with `{{Name}}` merge tags
- Bulk campaigns with randomized delays, sleep intervals, scheduling, and crash-safe resume
- Group sync, bulk group messaging, and bulk group creation
- Unified inbox across all connected devices
- OpenAI-powered auto-replies with escalation rules

## Tech stack

Electron · Next.js (static export) · React · TypeScript · Tailwind + shadcn/ui ·
Prisma + better-sqlite3 · Baileys · OpenAI · Playwright · electron-builder

## Delivery approach

Four sprints, worked on `main`. Each ends with an automated Playwright E2E suite, a packaged
build smoke test, a tracker update, and a commit + push:

1. **Sprint 1** — Foundation, licensing, app shell
2. **Sprint 2** — Devices, contacts, templates
3. **Sprint 3** — Campaign engine, groups
4. **Sprint 4** — Inbox, AI bot, settings, dashboard, release

See [SPRINTS.md](./SPRINTS.md) for the complete breakdown.

## Getting started

Nothing to install yet — the scaffold is created in Sprint 1. Once it exists:

```bash
npm install
npm run dev
```

Setup, build and release instructions are written into this file at the end of Sprint 4.
