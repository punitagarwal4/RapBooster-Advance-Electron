# RapBooster Advance — Sprint Plan

Complete production plan for the Electron + Next.js + Baileys WhatsApp marketing desktop
application.

| Document | Purpose |
| --- | --- |
| `SPRINTS.md` (this file) | Full technical specification and sprint breakdown |
| [SPRINT-TRACKER.md](./SPRINT-TRACKER.md) | Live status, decision log, deviations |
| [CLAUDE.md](./CLAUDE.md) | Engineering rules for every coding session |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | Customer inputs — **blocks Sprint 1 until filled** |
| `design/` | Original HTML prototypes (reference only, never imported) |

## Table of contents

1. [Product definition](#1-product-definition)
2. [Screen inventory](#2-screen-inventory)
3. [Architecture](#3-architecture)
4. [Database schema](#4-database-schema)
5. [IPC contract](#5-ipc-contract)
6. [Core algorithms](#6-core-algorithms)
7. [Design system](#7-design-system)
8. [Sprint 0 — Documentation](#8-sprint-0--documentation)
9. [Sprint 1 — Foundation, licensing, app shell](#9-sprint-1--foundation-licensing-app-shell)
10. [Sprint 2 — Devices, contacts, templates](#10-sprint-2--devices-contacts-templates)
11. [Sprint 3 — Campaign engine and groups](#11-sprint-3--campaign-engine-and-groups)
12. [Sprint 4 — Inbox, AI bot, settings, dashboard, release](#12-sprint-4--inbox-ai-bot-settings-dashboard-release)
13. [Cross-sprint definition of done](#13-cross-sprint-definition-of-done)
14. [Dependency manifest](#14-dependency-manifest)

---

## 1. Product definition

RapBooster Advance is a licensed Windows + macOS desktop application for WhatsApp marketing.
It connects multiple WhatsApp accounts through Baileys, stores everything in a local SQLite
database scoped to the OS user, and runs bulk campaigns, group operations, a unified inbox, and
an OpenAI-powered auto-responder.

### 1.1 Locked decisions

| Topic | Decision |
| --- | --- |
| Shell | Electron — main + preload + renderer + `wa-service` utility process |
| UI | Next.js App Router, `output: 'export'`, client-only, Tailwind + shadcn/ui |
| WhatsApp | Baileys, version per [REQUIREMENTS §7.6](./REQUIREMENTS.md) — pinned exactly, no `^` |
| Concurrency | Up to **20 simultaneously connected devices** |
| Database | SQLite via **Prisma + better-sqlite3**, one DB per OS user under `app.getPath('userData')` |
| Licensing | Remote license server (customer-owned): activation gate, conflict transfer, revalidation |
| AI | OpenAI; the end user supplies their own API key in Settings |
| Personalization | `{{Field}}` merge tags resolved from contact-list columns |
| Campaign durability | Per-recipient queue rows; crash-safe resume; bounded duplicate guarantee |
| Pairing | QR code **and** 8-digit pairing code |
| Platforms | Windows (NSIS) + macOS (DMG), signed and notarized |
| Updates | `electron-updater` against a customer-hosted feed |
| Scale target | 50,000 contacts · 20 devices · 100,000 queued recipients |
| Testing | Playwright E2E through `_electron`, run at the end of every sprint |
| Branching | Work directly on `main`; commit and push at each sprint completion |

### 1.2 Explicitly out of scope

Confirmed with the customer: **Number Filter / WhatsApp validity checker, Group Grabber /
member extractor, Account Warmup, and Spintax are not being built** — none appear in the
prototype. Also out: proxy support, tags/segments, unsubscribe handling, delivery-analytics
dashboards, app UI translation, telemetry.

Anything outside §2 requires an explicit scope change recorded in the tracker's deviations log.

---

## 2. Screen inventory

Extracted from `design/Application Prototype.dc.html`, `Screen 1 - License Activation.dc.html`
and `Screen 2 - License Conflict.dc.html`. **This table is the completeness contract** — every
field listed here must exist in the shipped app.

### 2.0 License Activation — Sprint 1

| Element | Detail |
| --- | --- |
| License Key | Text, required, placeholder "Enter your license key here", Enter submits |
| Remarks | Textarea, optional, placeholder "Add any remarks or notes…" |
| Activate | Primary button |
| Error states | "License key is required." · "Invalid license key. Please check and try again." |
| Success state | "✓ Valid license key" |
| Conflict state | "⚠ License conflict detected (key in use elsewhere)" |

### 2.0b License Conflict dialog — Sprint 1

| Element | Detail |
| --- | --- |
| Title | "License Already Active" |
| Body | "This license key is already activated on another system." |
| Device line | "Device: `{name}` (Last used: `{relative time}`)" — both from the server response |
| Question | "Would you like to deactivate the license on the other system and activate it here?" |
| Actions | "Cancel" · "Deactivate & Activate Here" |

### 2.1 Dashboard — Sprint 4

Four stat cards: **Total Contacts · Active Devices · Running Campaigns · Templates**.
Definitions per [REQUIREMENTS §7.1](./REQUIREMENTS.md). No charts in the prototype.

### 2.2 Inbox — Sprint 4

| Pane | Elements |
| --- | --- |
| Left (300px) | Header "Messages" · search "Search chats…" · device filter "-- All Devices --" · chat rows (name, phone, truncated last message, timestamp) |
| Right | Chat header (name + status) · message thread · composer |
| Message types | `text` · `media` (thumbnail tile) · `attachment` (file name + size, teal left border) · `buttons` (prompt + stacked pills) |
| Composer | "📷 Media" · "😊 Emoji" · "🔘 Buttons" · "📎 Attach" · input "Type a message…" · "Send" (Enter sends) |
| Emoji set | 😊 😂 ❤️ 👍 🎉 🔥 💯 ✨ 😍 🤔 😢 😡 |

### 2.3 Campaigns — Sprint 3

Card fields: name · created date · status pill · "📱 Devices" · "👥 Contacts" · "📋 Template" ·
"✓ Sent: N | ✗ Failed: N" · "⏱️ Delay: {from}-{to}s | 💤 Sleep: {duration}s/{after}msg" ·
"⏰ Scheduled" when set.

Buttons by status: `running` → Pause, Stop · `paused` → Resume, Stop · always → Report, Delete.

Create-campaign modal:

| Field | Control | Default |
| --- | --- | --- |
| Campaign Name | text | placeholder "e.g., Spring Sale 2024" |
| Select Devices | checkbox list | — |
| Select Contact Lists | checkbox list showing `Name (count)` | — |
| Select Template | select | "-- Choose a template --" |
| Template Preview | read-only | "(Select a template to preview)" |
| Schedule Send (optional) | `datetime-local` | — |
| Random Delay From (sec) | number 0–300 | 0 |
| Random Delay To (sec) | number 0–300 | 5 |
| Sleep Duration (sec) | number 0–600 | 10 |
| Sleep After N Messages | number 1–100 | 10 |

Validation: "Fill all required fields" · "Select at least one device and contact list".

### 2.4 WA Groups — Sprint 3

| Pane | Elements |
| --- | --- |
| Left | "WhatsApp Groups" · "+ Create Bulk" · "Filter by Device" · "Select All" · group rows with "👥 {n} members" |
| Right | "Send Messages to Groups" · "Selected Groups (N)" · template select · message preview · "Delay Between Messages (seconds)" default 2 · "Send to Selected Groups" |

Create-groups-in-bulk modal:

| Field | Control | Default |
| --- | --- | --- |
| Select Device | select | "-- Choose device --" |
| Group Name Prefix | text | placeholder "e.g., Sales Team" |
| Suffix Rule | select | Sequential Numbers (001…) · Alphabet (A, B, C…) · Timestamp · No Suffix |
| Number of Groups to Create | number 1–100 | 5 |
| Delay Between Groups (seconds) | number 0–60 | 2 |
| Add Contacts from Lists | checkbox list | — |
| Contacts per Group | number 0–500 | 10 |
| Preview | live text | `Sales Team 001, Sales Team 002, …` |

### 2.5 Devices — Sprint 2

Card fields: name · phone · "Added: {date}" · status pill · "Last active: {relative}".
Buttons: Reconnect · Logout (confirm).

Add-device modal: numbered instructions ("Open WhatsApp on your phone" → "Go to **Settings** →
**Linked Devices**" → "Tap **Link a Device**" → "Point your phone at the QR code below to scan"
→ "Confirm the device name and allow access"), **Device Name** input, QR area, and — added
beyond the prototype per customer decision — a **Pairing code** tab.

### 2.6 Contacts — Sprint 2

List tabs · search "Search contacts…" · "+ Add Contact" · "📥 Import" · "📤 Export" · dynamic
table whose columns come from the list's `fields` array plus an Actions column.

| Modal | Fields |
| --- | --- |
| Create New List | List Name · Custom Fields (comma-separated) |
| Add Contact | one input per field of the active list |

Default list "All Contacts" has fields `['Name', 'Mobile']`; every new list starts with those
two plus its custom fields.

### 2.7 Templates — Sprint 2

Card: name · type chip · WhatsApp-style preview bubble · Delete.

Create-template modal:

| Field | Control |
| --- | --- |
| Template Name | text |
| Template Type | Text Only · With Media (Image/Video) · Interactive Message · Button Message |
| Message Content | textarea (monospace) |
| Media Type *(type=media)* | Image · Video |
| Options, one per line *(type=interactive)* | textarea |
| Buttons, one per line, max 3 *(type=button)* | textarea, hard-capped at 3 |

### 2.8 AI Bot — Sprint 4

| Panel | Fields |
| --- | --- |
| System Instructions | monospace textarea — "Define bot personality, behavior rules, communication goals, and response patterns…" |
| Business Information | Business Name · Email · Phone |
| Auto-Reply Settings | Enable Auto-Replies (checked) · Response Delay preset (Instant 0 · Very Quick 1 · Quick 2 ✓ · Normal 3 · Thoughtful 5) + custom number 0–30 · Tone (Professional · Friendly & Approachable · Formal & Official · Casual & Conversational) · Industry (E-Commerce · SaaS · Healthcare · Hospitality · Real Estate · Customer Support · Education · Finance + free text) |
| Bot Personality & Goals | Primary Goal (Customer Support · Sales & Lead Generation · Inquiry Handling · Appointment Booking · Feedback Collection) · Response Style (Conversational · Bullet Points · Detailed/Long Form · Concise/Short) · Language (English · Spanish · French · German · Portuguese · Hindi) |
| Escalation & Handling | Escalation Trigger (Keywords · Low Confidence Threshold · After N Messages · After Time Elapsed) · Escalation Message (3 presets + free text) · Confidence Threshold % default 75 |
| Products & Services | bulk textarea, format `Name \| Description` |
| Knowledge Base | bulk textarea, format `Q: Question \| A: Answer` |
| Action | "Save Configuration" |

### 2.9 Settings — Sprint 1 (license) → Sprint 4 (rest)

Empty stub in the prototype. Sections: License · AI · Sending Defaults · Data & Backup ·
About & Updates.

---

## 3. Architecture

### 3.1 Process model

```text
┌──────────────────────────────────────────────────────────────┐
│ MAIN PROCESS (Node)                                          │
│  app lifecycle · BrowserWindow · single-instance lock        │
│  IPC router (zod-validated) · Prisma client (SOLE DB WRITER) │
│  LicenseService · SettingsService · safeStorage · updater    │
│  logger · wa-service supervisor                              │
└──────────┬───────────────────────────────┬───────────────────┘
           │ contextBridge via preload     │ MessagePort
           ▼                               ▼
┌────────────────────────────┐  ┌──────────────────────────────┐
│ RENDERER (sandboxed)       │  │ WA-SERVICE (utilityProcess)  │
│ Next.js static export      │  │ Baileys session manager ×20  │
│ React 19 · Tailwind        │  │ throttle scheduler           │
│ no Node · no fs · no DB    │  │ campaign worker pool         │
│ all data via window.api    │  │ group job runner             │
└────────────────────────────┘  │ OpenAI auto-reply worker     │
                                └──────────────────────────────┘
```

**Why `wa-service` is a separate process.** Twenty concurrent Baileys sockets perform
continuous Signal-protocol crypto and emit a high volume of events. In the main process that
would stall window management and IPC, making the UI stutter. Isolation also means a Baileys
crash restarts one process instead of killing the app.

**`wa-service` never touches SQLite.** It requests and reports state over MessagePort; main
performs every write. One writer means no SQLite lock contention, one place to enforce
transactions, and one place to audit.

### 3.2 Security baseline

Non-negotiable `BrowserWindow` configuration:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  preload: path.join(__dirname, 'preload.js'),
}
```

Plus: strict CSP (`default-src 'self'`), `setWindowOpenHandler` returning `{ action: 'deny' }`,
`will-navigate` blocked for anything but the app origin, `shell.openExternal` restricted to an
allowlist, and no remote module.

### 3.3 Repository layout

```text
RapBooster-Advance-Electron/
├── electron/
│   ├── main/
│   │   ├── index.ts                  # lifecycle, single-instance lock, boot sequence
│   │   ├── window.ts                 # BrowserWindow factory + security policy
│   │   ├── ipc/
│   │   │   ├── router.ts             # central registration + zod validation + error mapping
│   │   │   ├── license.ipc.ts
│   │   │   ├── device.ipc.ts
│   │   │   ├── contact.ipc.ts
│   │   │   ├── template.ipc.ts
│   │   │   ├── campaign.ipc.ts
│   │   │   ├── group.ipc.ts
│   │   │   ├── chat.ipc.ts
│   │   │   ├── chatbot.ipc.ts
│   │   │   ├── settings.ipc.ts
│   │   │   └── system.ipc.ts
│   │   ├── db/
│   │   │   ├── client.ts             # Prisma singleton, WAL, pragmas
│   │   │   ├── migrator.ts           # applies prisma/migrations/*.sql at boot
│   │   │   ├── backup.ts             # pre-migration + manual backups
│   │   │   └── integrity.ts          # PRAGMA integrity_check + recovery
│   │   ├── services/
│   │   │   ├── license.service.ts    # LicenseService interface + Http/Mock impls
│   │   │   ├── fingerprint.ts        # stable machine ID
│   │   │   ├── secure-store.ts       # safeStorage wrapper
│   │   │   ├── settings.service.ts
│   │   │   ├── updater.service.ts
│   │   │   ├── logger.ts             # electron-log + redaction
│   │   │   └── diagnostics.ts
│   │   └── wa-bridge.ts              # spawn/supervise wa-service, MessagePort plumbing
│   ├── preload/index.ts              # contextBridge, channel allowlist
│   └── wa-service/
│       ├── index.ts                  # entry + MessagePort protocol
│       ├── session-manager.ts        # multi-account Baileys lifecycle
│       ├── connection-state.ts       # per-device state machine + backoff
│       ├── throttle.ts               # token bucket / pacing scheduler
│       ├── campaign-worker.ts        # CampaignRecipient queue consumer
│       ├── group-runner.ts           # group send + bulk create jobs
│       ├── autoreply-worker.ts       # OpenAI responder
│       ├── message-builder.ts        # template + merge tags → Baileys payload
│       └── transport/
│           ├── index.ts              # interface + factory (real | mock by env)
│           ├── baileys.transport.ts
│           └── mock.transport.ts
├── renderer/
│   ├── app/
│   │   ├── layout.tsx · providers.tsx
│   │   ├── activation/page.tsx
│   │   ├── page.tsx                  # dashboard
│   │   ├── inbox/page.tsx
│   │   ├── campaigns/page.tsx · campaigns/[id]/page.tsx
│   │   ├── groups/page.tsx
│   │   ├── devices/page.tsx
│   │   ├── contacts/page.tsx
│   │   ├── templates/page.tsx
│   │   ├── chatbot/page.tsx
│   │   └── settings/page.tsx
│   ├── components/
│   │   ├── ui/                       # shadcn primitives
│   │   ├── layout/                   # Sidebar, TitleBar, PageHeader, EmptyState
│   │   └── <feature>/                # devices/, contacts/, campaigns/, groups/, inbox/…
│   ├── hooks/                        # useIpc, useLiveEvent, useDevices, useCampaigns…
│   └── lib/                          # formatters, merge-tag preview, csv helpers
├── shared/
│   ├── ipc.ts                        # THE contract — channels + zod schemas
│   ├── types.ts
│   ├── errors.ts                     # typed error taxonomy
│   └── constants.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/e2e/
│   ├── fixtures/                     # electron launch, db reset, mock services
│   └── specs/                        # sprint-1.spec.ts … sprint-4.spec.ts
├── assets/branding/
├── design/
└── CLAUDE.md · SPRINTS.md · SPRINT-TRACKER.md · REQUIREMENTS.md · README.md
```

### 3.4 Filesystem layout at runtime

```text
{app.getPath('userData')}/            # per OS user — Windows: %APPDATA%\RapBooster
├── rapbooster.db                     # macOS: ~/Library/Application Support/RapBooster
├── rapbooster.db-wal
├── rapbooster.db-shm
├── backups/rapbooster-{iso}.db
├── sessions/{deviceId}/              # Baileys useMultiFileAuthState
│   ├── creds.json
│   └── keys/…
├── media/
│   ├── templates/{templateId}/
│   └── inbox/{chatId}/
├── exports/
└── logs/main.log · renderer.log · wa-service.log
```

---

## 4. Database schema

The complete `prisma/schema.prisma`. Sprint 1 creates all of it — later sprints add data, not
tables, so there is exactly one baseline migration plus any deliberate later changes.

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")   // set at runtime to userData/rapbooster.db
}

// ─────────────────────────────── Licensing ───────────────────────────────

model License {
  id                String        @id @default("singleton")
  keyEncrypted      String                              // safeStorage ciphertext
  keyMasked         String                              // e.g. "VALID-****-001" for display
  status            String                              // LicenseStatus
  remarks           String?
  deviceFingerprint String
  deviceName        String?
  activatedAt       DateTime?
  expiresAt         DateTime?
  lastValidatedAt   DateTime?
  graceUntil        DateTime?
  serverPayload     String?                             // raw last response, redacted
  signature         String?                             // tamper detection over the record
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
}

// ──────────────────────────────── Devices ────────────────────────────────

model Device {
  id                 String   @id @default(cuid())
  name               String
  phone              String?                            // read from the socket once connected
  jid                String?                            // full WhatsApp JID
  status             String   @default("disconnected")  // DeviceStatus
  authFolder         String                             // relative to userData/sessions
  lastActiveAt       DateTime?
  lastError          String?
  consecutiveFailures Int     @default(0)
  dailySentCount     Int      @default(0)
  dailyCountResetAt  DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  campaignLinks      CampaignDevice[]
  recipients         CampaignRecipient[]
  groups             Group[]
  chats              Chat[]
  groupCreateJobs    GroupCreateJob[]

  @@index([status])
}

// ──────────────────────────────── Contacts ───────────────────────────────

model ContactList {
  id           String    @id @default(cuid())
  name         String    @unique
  fields       String                                  // JSON string[] — always starts ["Name","Mobile"]
  contactCount Int       @default(0)                   // denormalized, maintained in the same tx
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  contacts     Contact[]
  campaigns    CampaignList[]
}

model Contact {
  id        String      @id @default(cuid())
  listId    String
  name      String                                      // promoted from data for indexing
  phone     String                                      // normalized E.164, promoted for indexing
  data      String      @default("{}")                  // JSON of all fields incl. custom columns
  isValid   Boolean     @default(true)                  // failed phone normalization → false
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  list      ContactList @relation(fields: [listId], references: [id], onDelete: Cascade)
  recipients CampaignRecipient[]

  @@unique([listId, phone])
  @@index([listId, name])
  @@index([phone])
}

// ─────────────────────────────── Templates ───────────────────────────────

model Template {
  id        String     @id @default(cuid())
  name      String
  type      String                                      // TemplateType
  content   String
  mediaType String?                                     // "image" | "video"
  mediaPath String?                                     // relative to userData/media/templates
  options   String?                                     // JSON string[] — interactive
  buttons   String?                                     // JSON string[] max 3 — button
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  campaigns Campaign[]
  groupJobs GroupSendJob[]
}

// ─────────────────────────────── Campaigns ───────────────────────────────

model Campaign {
  id            String   @id @default(cuid())
  name          String
  status        String   @default("draft")              // CampaignStatus
  templateId    String
  scheduledAt   DateTime?
  startedAt     DateTime?
  completedAt   DateTime?
  delayFrom     Int      @default(0)
  delayTo       Int      @default(5)
  sleepDuration Int      @default(10)
  sleepAfter    Int      @default(10)
  retryAttempts Int      @default(2)
  totalCount    Int      @default(0)
  sentCount     Int      @default(0)
  failedCount   Int      @default(0)
  lastError     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  template   Template            @relation(fields: [templateId], references: [id])
  devices    CampaignDevice[]
  lists      CampaignList[]
  recipients CampaignRecipient[]

  @@index([status, scheduledAt])
}

model CampaignDevice {
  campaignId String
  deviceId   String
  campaign   Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  device     Device   @relation(fields: [deviceId], references: [id], onDelete: Cascade)

  @@id([campaignId, deviceId])
}

model CampaignList {
  campaignId String
  listId     String
  campaign   Campaign    @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  list       ContactList @relation(fields: [listId], references: [id], onDelete: Cascade)

  @@id([campaignId, listId])
}

/// The durable send queue. One row per recipient — this is what makes campaigns resumable.
model CampaignRecipient {
  id         String    @id @default(cuid())
  campaignId String
  contactId  String
  deviceId   String
  phone      String                                     // snapshot, so contact edits can't corrupt a run
  status     String    @default("pending")              // RecipientStatus
  attempts   Int       @default(0)
  messageId  String?                                    // WhatsApp message id once sent
  error      String?
  claimedAt  DateTime?                                  // set when flipped to "sending"
  sentAt     DateTime?
  createdAt  DateTime  @default(now())

  campaign   Campaign  @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  contact    Contact   @relation(fields: [contactId], references: [id], onDelete: Cascade)
  device     Device    @relation(fields: [deviceId], references: [id])

  @@unique([campaignId, contactId])                     // hard guarantee: no contact twice per campaign
  @@index([campaignId, status])
  @@index([deviceId, status])
}

// ───────────────────────────────── Groups ────────────────────────────────

model Group {
  id          String   @id                              // WhatsApp group JID
  deviceId    String
  name        String
  memberCount Int      @default(0)
  isAdmin     Boolean  @default(false)
  syncedAt    DateTime @default(now())

  device      Device   @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  targets     GroupSendTarget[]

  @@index([deviceId])
}

model GroupSendJob {
  id           String   @id @default(cuid())
  templateId   String
  status       String   @default("pending")
  delaySeconds Int      @default(2)
  totalCount   Int      @default(0)
  sentCount    Int      @default(0)
  failedCount  Int      @default(0)
  createdAt    DateTime @default(now())
  completedAt  DateTime?

  template     Template          @relation(fields: [templateId], references: [id])
  targets      GroupSendTarget[]
}

model GroupSendTarget {
  id        String       @id @default(cuid())
  jobId     String
  groupId   String
  status    String       @default("pending")
  error     String?
  sentAt    DateTime?

  job       GroupSendJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  group     Group        @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@index([jobId, status])
}

model GroupCreateJob {
  id              String   @id @default(cuid())
  deviceId        String
  prefix          String
  suffixRule      String                                // "number" | "alphabet" | "timestamp" | "none"
  count           Int
  delaySeconds    Int      @default(2)
  listIds         String   @default("[]")               // JSON string[]
  contactsPerGroup Int     @default(0)
  status          String   @default("pending")
  createdCount    Int      @default(0)
  failedCount     Int      @default(0)
  resultLog       String?                               // JSON — per-group outcome incl. participant failures
  createdAt       DateTime @default(now())
  completedAt     DateTime?

  device          Device   @relation(fields: [deviceId], references: [id], onDelete: Cascade)
}

// ───────────────────────────── Inbox / chatbot ───────────────────────────

model Chat {
  id             String    @id                          // WhatsApp JID
  deviceId       String
  name           String
  phone          String
  isGroup        Boolean   @default(false)
  lastMessageAt  DateTime?
  lastMessage    String?
  unreadCount    Int       @default(0)
  isEscalated    Boolean   @default(false)
  autoReplyOptOut Boolean  @default(false)
  createdAt      DateTime  @default(now())

  device         Device    @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  messages       Message[]

  @@index([deviceId, lastMessageAt])
}

model Message {
  id         String   @id                               // WhatsApp message id
  chatId     String
  direction  String                                     // "in" | "out"
  type       String                                     // MessageType
  body       String?
  mediaPath  String?
  mediaType  String?
  fileName   String?
  fileSize   Int?
  buttons    String?                                    // JSON string[]
  status     String   @default("sent")                  // pending|sent|delivered|read|failed
  isAiReply  Boolean  @default(false)
  timestamp  DateTime

  chat       Chat     @relation(fields: [chatId], references: [id], onDelete: Cascade)

  @@index([chatId, timestamp])
}

model ChatbotConfig {
  id                  String   @id @default("singleton")
  enabled             Boolean  @default(true)
  systemInstructions  String   @default("")
  businessName        String?
  businessEmail       String?
  businessPhone       String?
  responseDelay       Int      @default(2)
  tone                String   @default("professional")
  industry            String?
  primaryGoal         String   @default("support")
  responseStyle       String   @default("conversational")
  language            String   @default("english")
  escalationTrigger   String   @default("keywords")
  escalationKeywords  String   @default("[]")           // JSON string[]
  escalationMessage   String?
  confidenceThreshold Int      @default(75)
  products            String   @default("")             // raw bulk text, "Name | Description"
  knowledgeBase       String   @default("")             // raw bulk text, "Q: … | A: …"
  updatedAt           DateTime @updatedAt
}

// ──────────────────────────────── Settings ───────────────────────────────

model Setting {
  key         String   @id
  value       String
  isEncrypted Boolean  @default(false)
  updatedAt   DateTime @updatedAt
}
```

### 4.1 Enumerations

SQLite has no native enums; these are string unions defined once in `shared/types.ts` and
validated by zod at every boundary.

| Enum | Values |
| --- | --- |
| `LicenseStatus` | `unlicensed` · `valid` · `invalid` · `expired` · `revoked` · `conflict` · `grace` |
| `DeviceStatus` | `disconnected` · `connecting` · `qr_pending` · `pairing_pending` · `connected` · `logged_out` · `banned` |
| `CampaignStatus` | `draft` · `scheduled` · `running` · `paused` · `completed` · `failed` |
| `RecipientStatus` | `pending` · `sending` · `sent` · `failed` · `skipped` |
| `TemplateType` | `text` · `media` · `interactive` · `button` |
| `MessageDirection` | `in` · `out` |
| `MessageType` | `text` · `media` · `attachment` · `buttons` · `interactive` |
| `MessageStatus` | `pending` · `sent` · `delivered` · `read` · `failed` |
| `JobStatus` | `pending` · `running` · `paused` · `completed` · `failed` |
| `SuffixRule` | `number` · `alphabet` · `timestamp` · `none` |

### 4.2 Settings keys

| Key | Type | Default | Encrypted |
| --- | --- | --- | --- |
| `sending.delayFrom` | int | 0 | no |
| `sending.delayTo` | int | 5 | no |
| `sending.sleepDuration` | int | 10 | no |
| `sending.sleepAfter` | int | 10 | no |
| `sending.groupMessageDelay` | int | 2 | no |
| `sending.groupCreateDelay` | int | 2 | no |
| `sending.dailyCapPerDevice` | int | 0 (unlimited) | no |
| `sending.retryAttempts` | int | 2 | no |
| `sending.maxConcurrentDevices` | int | 20 | no |
| `ai.apiKey` | string | — | **yes** |
| `ai.model` | string | per REQUIREMENTS §5 | no |
| `ai.maxTokens` | int | 500 | no |
| `ai.temperature` | float | 0.7 | no |
| `ai.historyDepth` | int | 10 | no |
| `ai.dailyReplyCap` | int | 0 | no |
| `contacts.defaultCountryCode` | string | per REQUIREMENTS §7.5 | no |
| `contacts.duplicatePolicy` | string | `skip` | no |
| `inbox.retentionDays` | int | per REQUIREMENTS §7.3 | no |
| `updates.channel` | string | `stable` | no |
| `app.lastMigration` | string | — | no |

### 4.3 Why `Contact.data` is a JSON blob

Lists define arbitrary columns (`Company`, `Status`, `Notes`), so a fixed column set cannot
work and an EAV table would need a join per field at 50k rows. A JSON blob plus **promoted,
indexed `name` and `phone` columns** keeps the schema stable, gives fast lookup on the only two
fields ever queried, and lets merge tags resolve against the blob in memory at send time. The
trade-off — no SQL filtering on custom fields — is acceptable because no screen offers it.

---

## 5. IPC contract

`shared/ipc.ts` is the single source of truth, imported by main, preload and renderer. Each
channel declares a zod request schema and a zod response schema; the router validates **both
directions**, so a malformed payload fails at the boundary rather than deep inside a service.

### 5.1 Shape

```ts
export const ipcContract = {
  'contacts:list': {
    request: z.object({
      listId: z.string(),
      search: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }),
    response: z.object({
      items: z.array(contactSchema),
      nextCursor: z.string().nullable(),
      total: z.number(),
    }),
  },
  // …
} as const

export type IpcContract = typeof ipcContract
export type IpcChannel = keyof IpcContract
```

The preload exposes exactly:

```ts
window.api = {
  invoke<C extends IpcChannel>(channel: C, req: Req<C>): Promise<Res<C>>
  on<E extends IpcEvent>(event: E, cb: (payload: EventPayload<E>) => void): () => void
}
```

### 5.2 Invoke channels

| Domain | Channels |
| --- | --- |
| License | `license:status` · `license:activate` · `license:transfer` · `license:deactivate` · `license:revalidate` |
| Devices | `device:list` · `device:create` · `device:rename` · `device:connect` · `device:requestPairingCode` · `device:reconnect` · `device:logout` · `device:delete` |
| Contacts | `contactList:list` · `contactList:create` · `contactList:update` · `contactList:delete` · `contacts:list` · `contacts:create` · `contacts:update` · `contacts:delete` · `contacts:bulkDelete` · `contacts:import` · `contacts:importPreview` · `contacts:export` |
| Templates | `template:list` · `template:create` · `template:update` · `template:delete` · `template:usage` · `template:preview` |
| Campaigns | `campaign:list` · `campaign:get` · `campaign:create` · `campaign:start` · `campaign:pause` · `campaign:resume` · `campaign:stop` · `campaign:delete` · `campaign:recipients` · `campaign:report` |
| Groups | `group:list` · `group:sync` · `groupSend:create` · `groupSend:status` · `groupCreate:create` · `groupCreate:status` |
| Inbox | `chat:list` · `chat:get` · `chat:messages` · `chat:send` · `chat:markRead` · `chat:setOptOut` |
| Chatbot | `chatbot:get` · `chatbot:save` · `chatbot:testKey` |
| Settings | `settings:get` · `settings:set` · `settings:getAll` |
| System | `system:dashboard` · `system:openPath` · `system:exportDiagnostics` · `system:backup` · `system:restore` · `system:clearData` · `system:checkUpdate` · `system:version` |

### 5.3 Event channels (main → renderer, push only)

| Event | Payload | Emitted when |
| --- | --- | --- |
| `device:status` | `{ deviceId, status, phone?, error? }` | Any device state transition |
| `device:qr` | `{ deviceId, qr }` | Baileys emits a new QR (rotates ~every 20s) |
| `device:pairingCode` | `{ deviceId, code }` | Pairing code issued |
| `campaign:progress` | `{ campaignId, sent, failed, total, status }` | Batched every 1s or 25 messages |
| `groupJob:progress` | `{ jobId, kind, done, total, status }` | Batched, same policy |
| `message:received` | `{ chatId, message }` | Incoming WhatsApp message persisted |
| `message:status` | `{ messageId, status }` | Delivery/read receipt |
| `license:changed` | `{ status, expiresAt? }` | Revalidation changes state |
| `wa:serviceState` | `{ state, restartCount }` | wa-service up/down/restarting |
| `toast` | `{ level, message }` | Background operation needs to tell the user something |

**Nothing polls.** Progress and status always arrive as events; the renderer keeps no timers.

### 5.4 Error taxonomy

`shared/errors.ts` defines the codes every IPC handler must map failures onto. Each carries a
`userMessage` (safe to display) and `detail` (logged, never shown raw).

| Code | Meaning |
| --- | --- |
| `VALIDATION_FAILED` | zod rejected the request or response |
| `NOT_FOUND` | Entity missing |
| `CONFLICT` | Unique constraint / duplicate |
| `LICENSE_REQUIRED` · `LICENSE_INVALID` · `LICENSE_CONFLICT` · `LICENSE_EXPIRED` | Licensing |
| `DEVICE_NOT_CONNECTED` · `DEVICE_LOGGED_OUT` · `DEVICE_LIMIT_REACHED` | Devices |
| `WA_SERVICE_DOWN` | wa-service unavailable |
| `SEND_FAILED` · `RATE_LIMITED` · `DAILY_CAP_REACHED` | Sending |
| `AI_KEY_MISSING` · `AI_KEY_INVALID` · `AI_RATE_LIMITED` · `AI_TIMEOUT` | OpenAI |
| `IMPORT_FAILED` · `EXPORT_FAILED` | CSV |
| `DB_ERROR` · `MIGRATION_FAILED` · `INTEGRITY_FAILED` | Database |
| `NETWORK_ERROR` · `UNKNOWN` | Catch-alls |

---

## 6. Core algorithms

### 6.1 Throttle scheduler — the anti-ban core

Every outbound WhatsApp action passes through one scheduler. **No code path may call
`sock.sendMessage` directly.** Per device it enforces:

```text
acquire(deviceId):
  if device.dailySentCount >= dailyCap and dailyCap > 0:
      park device until next local midnight  →  DAILY_CAP_REACHED
  if messagesSinceSleep >= sleepAfter:
      wait sleepDuration seconds
      messagesSinceSleep = 0
  wait random(delayFrom, delayTo) seconds        // uniform, re-drawn each send
  ensure inFlight[deviceId] == 0                 // strictly one message at a time per device
  inFlight[deviceId] = 1
  messagesSinceSleep += 1
  device.dailySentCount += 1
```

Parallelism comes from running multiple devices, never from concurrent sends on one account —
concurrent sends on a single WhatsApp account are the fastest route to a ban.

### 6.2 Campaign worker loop

One worker per device assigned to a running campaign.

```text
loop while campaign.status == 'running' and device connected:
  recipient = atomicClaim(campaignId, deviceId)      // §6.3
  if none: mark campaign complete if no pending rows remain anywhere; exit
  await throttle.acquire(deviceId)
  payload = messageBuilder(template, contact)        // merge tags resolved here
  try:
      result = transport.send(deviceId, recipient.phone, payload)
      mark recipient sent, store result.messageId
  catch err:
      recipient.attempts += 1
      if attempts <= campaign.retryAttempts and isRetryable(err):
          reset recipient to 'pending'
          backoff(attempts)
      else:
          mark recipient failed with err
  emit batched campaign:progress
```

Counters shown in the UI are always recomputed from `CampaignRecipient` with a `GROUP BY
status`, never incremented in memory — a crash can then never desynchronize them.

### 6.3 Atomic claim

```sql
UPDATE CampaignRecipient
   SET status = 'sending', claimedAt = CURRENT_TIMESTAMP
 WHERE id = (
   SELECT id FROM CampaignRecipient
    WHERE campaignId = ? AND deviceId = ? AND status = 'pending'
    ORDER BY rowid LIMIT 1
 )
RETURNING *;
```

Single-statement claim under SQLite's write lock — two workers can never take the same row.

### 6.4 Crash recovery

On every `wa-service` boot, before any worker starts:

1. `UPDATE CampaignRecipient SET status='pending' WHERE status='sending'` — anything claimed
   when the process died is retried.
2. For each campaign with `status='running'`, restart workers from the first `pending` row.
3. Recompute `sentCount` / `failedCount` / `totalCount` from the recipient rows.
4. Any campaign with `status='scheduled'` and `scheduledAt <= now` starts immediately.

**Duplicate guarantee, stated honestly:** a message that was in flight at the exact moment of a
crash may be sent twice, because WhatsApp acknowledged it but the app never recorded the ack.
The worst case is bounded at **one duplicate per device per crash**. Eliminating it entirely
would require a pre-write of intent plus WhatsApp-side deduplication, which the protocol does
not offer. `@@unique([campaignId, contactId])` guarantees there is never more than one queue
row per contact, so no other duplication path exists.

### 6.5 Device connection state machine

```text
disconnected ──connect()──► connecting ──qr event──► qr_pending ──scanned──► connected
     ▲                          │                         │                      │
     │                          └──pairing requested──► pairing_pending ─────────┘
     │                                                                           │
     └──────── backoff retry ◄── connection.close (reason ≠ loggedOut) ◄──────────┤
                                                                                 │
     logged_out ◄────────────── connection.close (reason == loggedOut) ◄──────────┘
```

Backoff: `min(60s, 1s × 2^attempts)` with ±20% jitter. After 10 consecutive failures the
circuit breaker opens, the device stops retrying, `lastError` is recorded, and the UI shows a
manual **Reconnect** action. `logged_out` is terminal: the auth folder is purged and re-linking
is required.

### 6.6 Merge tags

Syntax `{{FieldName}}`, case-insensitive, matched against `Contact.data` keys plus `name` and
`phone`. Unknown tags are flagged at campaign creation, listing exactly which selected lists
lack the field. Missing values at send time resolve to an empty string by default, or skip the
recipient if the campaign is configured strictly. A literal `{{` is escaped as `\{\{`.

### 6.7 CSV import pipeline

```text
file → stream parse (papaparse, worker) → detect header
     → column-mapping UI (CSV header → list field)
     → per row: normalize phone to E.164 with default country code
              → validate; invalid → error report, isValid = false
              → duplicate check per settings policy (skip | overwrite | allow)
     → batch INSERT in transactions of 1,000
     → progress event every batch
     → summary: imported / skipped / invalid + downloadable error CSV
```

Streaming plus batching is what keeps a 50,000-row import from blocking the UI or ballooning
memory. The prototype's blind positional mapping is deliberately replaced by an explicit
mapping step.

### 6.8 License state machine

```text
unlicensed ──activate(valid)──► valid ──revalidate ok──► valid
     │                            │
     │                            ├──revalidate: network error──► grace (until graceUntil)
     │                            │                                  │
     │                            │                    grace expires ▼
     │                            └──revalidate: rejected──────────► invalid / expired / revoked
     │
     └──activate(conflict)──► conflict dialog ──transfer──► valid
```

The main window is created only when the status is `valid` or `grace`. The cached record is
signed; a tampered cache is treated as `unlicensed`.

---

## 7. Design system

Tokens derived from the prototype, modernized (the prototype is a low-fidelity Windows
wireframe; the customer confirmed it is a rough guide, not a pixel target).

| Token | Value | Prototype origin |
| --- | --- | --- |
| `--primary` | `#0078d4` | buttons, active nav border, active list tab |
| `--primary-hover` | `#106ebe` | button hover |
| `--danger` | `#c50f1f` | destructive buttons, error text |
| `--danger-hover` | `#a4081f` | |
| `--success` | `#107c10` | license success text |
| `--wa-bubble-out` | `#dcf8c6` | outgoing chat bubble |
| `--wa-bubble-in` | `#f0f0f0` | incoming chat bubble |
| `--wa-teal` | `#128c7e` | attachment left border |
| `--status-ok-bg` / `-fg` | `#d4edda` / `#155724` | connected, running |
| `--status-warn-bg` / `-fg` | `#fff3cd` / `#856404` | paused |
| `--status-idle-bg` / `-fg` | `#e2e3e5` / `#383d41` | draft |
| `--selected` | `#28a745` | selected group, active chat border |
| `--bg` / `--surface` / `--sidebar` | `#f5f5f5` / `#ffffff` / `#f9f9f9` | |
| `--border` | `#e5e7eb` | modernized from `#ddd`/`#eee` |
| `--text` / `--muted` / `--subtle` | `#333` / `#666` / `#999` | |

Typography: Inter with a system fallback (replacing Segoe UI), `ui-monospace` for template and
bulk-config textareas. Radius: 6px controls, 8px cards, 12px chat bubbles — replacing the
prototype's inconsistent 0/4/8/12 mix. Spacing on a 4px scale. Icons: **Lucide**, replacing the
prototype's emoji. Light theme only. Sidebar 200px fixed, matching the prototype.

---

## 8. Sprint 0 — Documentation

**Goal.** Produce the planning artifacts and freeze scope before any code exists.

**Deliverables:** `REQUIREMENTS.md`, `SPRINTS.md`, `SPRINT-TRACKER.md`, `CLAUDE.md`, updated
`README.md`.

**Definition of done**

- All five documents committed and pushed to `main`.
- Every prototype screen and modal field in §2 is assigned to exactly one sprint.
- **Sprint 1 does not begin until `REQUIREMENTS.md` is filled and the customer says go.**

---

## 9. Sprint 1 — Foundation, licensing, app shell

**Goal.** A navigable, license-gated, empty application: the license gate works against the
real server, the database exists and migrates, the IPC contract is established, the design
system is in place, and packaging is proven. No WhatsApp yet.

**Depends on:** REQUIREMENTS §1 (license API), §2 (branding), §6 (sending defaults).

### 9.1 Tasks

#### T1.1 — Prisma/Electron packaging spike *(do this first, timebox 1 day)*

Prove Prisma Client works inside a packaged, `asar`-packed Electron build on **both** Windows
and macOS, using the `better-sqlite3` driver adapter so no Rust query-engine binary needs
shipping. Deliverable: a throwaway packaged build that opens a DB at `userData`, migrates,
writes and reads.

If it fails, fall back to **Drizzle ORM** on the same `better-sqlite3` driver — identical
schema and query surface, no other layer changes. Record the outcome in the tracker's decision
log either way. Do not switch silently.

#### T1.2 — Project scaffold

`package.json`; TypeScript strict with path aliases (`@main/*`, `@renderer/*`, `@shared/*`);
`electron-vite` for main/preload/wa-service bundling; Next.js with `output: 'export'`,
`images.unoptimized`, `trailingSlash`; ESLint + Prettier; `.editorconfig`.

Scripts: `dev` · `build` · `dist` · `dist:win` · `dist:mac` · `typecheck` · `lint` ·
`test:e2e` · `test:smoke` · `db:generate` · `db:migrate` · `db:studio` · `graph`.

`.gitignore`: `node_modules`, `out`, `dist`, `.next`, `graphify-out/`, `REQUIREMENTS.local.md`,
`*.pfx`, `*.p8`, `.env*`, `test-results/`.

#### T1.3 — Electron shell and security baseline

`BrowserWindow` per §3.2. Strict CSP. `setWindowOpenHandler` deny-all, `will-navigate` blocked,
`shell.openExternal` allowlisted. Single-instance lock focusing the existing window. Frameless
custom title bar reading the product name, with working minimize/maximize/close on both
platforms. Dev loads `localhost:3000`, prod loads the exported `file://`. Graceful shutdown
that stops workers, closes sockets, checkpoints WAL and flushes logs. Boot sequence:
logger → integrity check → backup → migrate → settings → license gate → window.

#### T1.4 — Database layer

Complete `schema.prisma` from §4 — **all tables created in this sprint**, so there is one
baseline migration. Migrations emitted as raw SQL and applied at boot by `db/migrator.ts`,
which tracks applied versions in a `_migrations` table; the Prisma CLI must not be needed at
runtime. `DATABASE_URL` resolved at runtime to `app.getPath('userData')/rapbooster.db`.
Pragmas: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`,
`synchronous=NORMAL`. `PRAGMA integrity_check` on boot with a documented recovery path.
Timestamped backup before every migration, retaining the last 5. Seed + reset helpers used by
E2E.

#### T1.5 — IPC contract and router

`shared/ipc.ts` with zod schemas for **every** channel in §5.2 and §5.3 — later sprints fill in
handlers, but the contract is written once, now, so it never has to be renegotiated. Preload
with a channel allowlist. `ipc/router.ts` validating both directions, mapping thrown errors to
the §5.4 taxonomy, and logging every call with duration. Renderer hooks: `useIpc` (typed,
with loading/error state) and `useLiveEvent` (subscribe with automatic cleanup).

#### T1.6 — Design system

Tailwind configured with the §7 tokens as CSS variables. shadcn/ui installed with the
components needed across all sprints: button, input, textarea, select, checkbox, radio, dialog,
sheet, tabs, table, card, badge, toast, tooltip, dropdown-menu, scroll-area, skeleton, alert,
progress, separator, switch, label. Lucide icons. Shared layout primitives: `PageHeader`,
`EmptyState`, `StatCard`, `StatusPill`, `ConfirmDialog`, `DataTable`.

#### T1.7 — App shell

Sidebar in prototype order — Dashboard · Inbox · Campaigns · WA Groups · Devices · Contacts ·
Templates · AI Bot — with Settings pinned to the bottom behind a separator, active state via
left border + fill, and Lucide icons replacing emoji. Routes for all nine screens with
intentional empty states. Global toast provider. Per-route error boundary with a retry action.
Loading skeletons. A `wa:serviceState` banner for degraded states.

#### T1.8 — Licensing

- `LicenseService` interface: `activate(key, remarks)` · `validate()` · `deactivate()` ·
  `transfer(key, remarks)`. Two implementations: `HttpLicenseService` against the customer's
  server (REQUIREMENTS §1) and `MockLicenseService` (deterministic, env-selected, used by E2E).
- `fingerprint.ts`: stable machine ID = SHA-256 of machine GUID + primary MAC + OS user SID,
  computed once and cached, with the inputs documented so drift is explainable.
- Activation screen per §2.0, including Enter-to-submit and all four inline states.
- Conflict dialog per §2.0b, populated from the server response fields named in
  REQUIREMENTS §1.5.
- License cache encrypted with `safeStorage` and signed; tampering → `unlicensed`.
- Background revalidation on the schedule from REQUIREMENTS §1.6, with offline grace per the
  §6.8 state machine.
- Hard gate: the main window is never created unless status is `valid` or `grace`.

#### T1.9 — Settings, license panel

Masked key, bound device name, status pill, expiry, last validated, and *Deactivate this
device* with confirmation. Remaining sections are Sprint 4.

#### T1.10 — Logging and diagnostics

`electron-log` in all three processes, rotating under `userData/logs` (5 MB × 5 files),
structured entries with process tag and correlation id. **Automatic redaction** of license
keys, API keys, and phone numbers (last 4 digits kept). Global `uncaughtException`,
`unhandledRejection`, renderer `render-process-gone` and `unresponsive` handlers.
*Export diagnostics* producing a zip of logs + app/OS versions + non-sensitive settings.

#### T1.11 — Playwright harness

`_electron.launch()` fixture with an isolated `userData` per run, DB reset between specs,
`MockLicenseService` and the mock transport injected by env, screenshot + video + trace on
failure, and a `test:smoke` script that packages the app and verifies the packaged binary
launches.

### 9.2 Acceptance criteria

- A fresh install shows the activation screen; the main window is unreachable without a
  license.
- A valid key activates, persists across restart, and does not re-prompt.
- An invalid key shows the mapped error and stores nothing.
- A conflicting key opens the conflict dialog showing the other device's name and last-used
  time; *Deactivate & Activate Here* completes the transfer; *Cancel* returns to the form.
- With the network unplugged after activation, the app opens within the grace period and locks
  after it expires.
- The DB is created at the per-OS-user path, migrates from empty, and survives restart.
- The sidebar navigates to all nine screens, each with an intentional empty state.
- `npm run dist` produces Windows and macOS installers that launch to the activation screen.

### 9.3 E2E tests

| ID | Test |
| --- | --- |
| E1.1 | Fresh launch shows activation; no main window |
| E1.2 | Valid key → app opens; relaunch stays open without re-prompt |
| E1.3 | Invalid key → mapped error, still gated |
| E1.4 | Empty key → "License key is required." |
| E1.5 | Conflict key → dialog shows other device + last used; transfer succeeds |
| E1.6 | Conflict dialog → Cancel returns to form, nothing stored |
| E1.7 | Remarks text is submitted with the activation request |
| E1.8 | Offline after activation → opens in grace; past grace → locked |
| E1.9 | Settings → Deactivate → returns to activation screen |
| E1.10 | Navigate all nine screens with zero console errors |
| E1.11 | Tampered license cache is rejected and re-gates the app |
| E1.12 | DB file exists at the userData path after first launch |
| E1.13 | Migration runs from empty and is idempotent on second launch |
| E1.14 | IPC rejects a malformed payload with `VALIDATION_FAILED` |
| E1.15 | Logs contain no raw license key or full phone number |
| E1.16 | Packaged build smoke test — launches, reaches activation, exits cleanly |

### 9.4 Risks

| Risk | Mitigation |
| --- | --- |
| Prisma fails to package in Electron | T1.1 spike first; Drizzle fallback pre-agreed |
| License API differs from what REQUIREMENTS captured | `LicenseService` interface isolates it; one file changes |
| Fingerprint unstable across hardware changes | Composite hash with documented inputs; server-side transfer covers drift |
| `safeStorage` unavailable (keychain locked) | Detect, fall back to an obfuscated store, log a warning, surface reduced security in Settings |

---

## 10. Sprint 2 — Devices, contacts, templates

**Goal.** Real WhatsApp accounts connect and stay connected; contacts and templates are fully
managed. Everything a campaign needs, except the campaign engine.

**Depends on:** Sprint 1 · REQUIREMENTS §7.4 (duplicates), §7.5 (phone format), §7.6 (Baileys
version).

### 10.1 Tasks

#### T2.1 — `wa-service` utility process

`utilityProcess.fork` with a MessagePort channel and a typed request/response + event protocol
mirroring §5. Supervisor in `wa-bridge.ts`: health ping every 10s, crash detection, automatic
restart with exponential backoff, state rebuilt **from SQLite, never from memory**, and a
`wa:serviceState` event so the UI reports degradation honestly instead of appearing frozen.

#### T2.2 — Baileys session manager

Wrapped behind our own `transport` interface so a Baileys upgrade touches one file.

- One socket per device, up to 20 concurrent, each with
  `useMultiFileAuthState(userData/sessions/<deviceId>)`.
- `creds.update` → `saveCreds()` immediately, always.
- `connection.update` drives the §6.5 state machine and streams `qr` to the renderer as the
  code rotates.
- Pairing code: when `!sock.authState.creds.registered`, call
  `sock.requestPairingCode(number)` and surface the 8-digit code.
- Reconnect on any `lastDisconnect` reason **except** `DisconnectReason.loggedOut`, with the
  §6.5 backoff and circuit breaker.
- `loggedOut` is terminal: mark the device, purge its auth folder, require re-linking.
- Read the real phone number and JID from the socket once connected and persist them.
- Clean teardown of every socket on quit.
- Baileys logger wired into our logger at `warn` level to avoid noise.

#### T2.3 — Devices screen

Card grid per §2.5. *Add Device* modal with the prototype's numbered instructions, a **Device
Name** input, and two tabs: **QR** (live-refreshing canvas via `qrcode`, with an expiry
countdown) and **Pairing code** (phone input with country code → 8-digit code with a copy
button). Per-card *Reconnect* and *Logout* with confirmation. Rename. Live status via
`device:status`. Empty state guiding a first connection. A visible cap at 20 devices with a
clear message.

#### T2.4 — Contacts

- Multiple lists, each with its own field set; list tabs; create-list modal taking a name plus
  comma-separated custom fields on top of mandatory `Name` and `Mobile`; rename and delete
  (cascade with confirmation showing the contact count).
- **Virtualized table** (`@tanstack/react-virtual`) with cursor pagination and server-side
  search over IPC — must stay responsive at 50,000 rows.
- Add / edit / delete contact with fields generated from the active list.
- Bulk select and bulk delete.
- **CSV import** per §6.7: worker-thread streamed parse, explicit column-mapping step, E.164
  normalization using the default country code, duplicate policy from settings, batched
  transactional inserts, progress events, and a summary with a downloadable error report.
- **CSV export** of the active list, quoted, honoring the current search filter, written to
  `userData/exports` and revealed in the file manager.

#### T2.5 — Templates

All four prototype types with their conditional fields per §2.7. Media files copied into
`userData/media/templates/<templateId>/` with size and type validation (images ≤5 MB,
videos ≤16 MB — WhatsApp's practical limits). WhatsApp-style live preview. Edit and delete,
with a usage check (`template:usage`) that warns before deleting a template referenced by a
campaign or group job. Button count hard-capped at 3.

#### T2.6 — Merge tags

`{{Field}}` resolution per §6.6. An insert-token dropdown populated from the selected list's
fields. Live preview rendered against the first real contact. Validation at both template save
and campaign creation, naming exactly which lists lack a referenced field.

#### T2.7 — Mock transport

`mock.transport.ts` satisfying the same interface as the Baileys transport but fully
deterministic: instant fake QR and pairing code, scriptable connect/disconnect/logout,
configurable send success/failure rates and latency, synthetic incoming messages, fake group
lists. Selected by `WA_TRANSPORT=mock`. **This is what makes Sprints 3 and 4 testable in CI
without a real WhatsApp account or ban risk.**

### 10.2 Acceptance criteria

- A device links by QR and by pairing code, and reconnects automatically after app restart.
- Pulling the network mid-session triggers backoff reconnect, not a busy loop; the UI shows
  `connecting`.
- Logging out marks the device `logged_out` and clears its auth folder.
- Twenty mock devices connect simultaneously and the UI stays interactive.
- A 50,000-row CSV imports with visible progress, correct E.164 normalization, and an accurate
  imported/skipped/invalid summary.
- Export re-imports to an identical list.
- All four template types save, preview correctly, and enforce the 3-button cap.
- `Hi {{Name}} from {{Company}}` previews with real contact values.

### 10.3 E2E tests

| ID | Test |
| --- | --- |
| E2.1 | Add device via QR (mock) → status reaches `connected`, phone persisted |
| E2.2 | Add device via pairing code → 8-digit code shown → connects |
| E2.3 | Sessions restore on relaunch without re-scanning |
| E2.4 | Simulated disconnect → reconnects with backoff, not a tight loop |
| E2.5 | `loggedOut` reason → terminal state, auth folder purged |
| E2.6 | Circuit breaker opens after N failures; manual Reconnect recovers |
| E2.7 | Logout → confirmation → device removed from the active list |
| E2.8 | 20 mock devices connect concurrently; UI stays responsive |
| E2.9 | 21st device blocked with a clear message |
| E2.10 | wa-service killed → supervisor restarts it → devices reconnect |
| E2.11 | Create list with custom fields; add/edit/delete a contact |
| E2.12 | Import 50k-row CSV with column mapping; counts reconcile exactly |
| E2.13 | Import with duplicates honors skip/overwrite/allow policy |
| E2.14 | Import with malformed numbers produces a downloadable error report |
| E2.15 | Export → re-import round-trips identically |
| E2.16 | Search across 50k rows returns correct results under 500 ms |
| E2.17 | Virtualized table scrolls 50k rows without frame drops |
| E2.18 | Create each of the four template types; button cap enforced at 3 |
| E2.19 | Oversized media rejected with a clear message |
| E2.20 | Merge-tag preview substitutes real contact values |
| E2.21 | Template referencing an unknown field is flagged at save |
| E2.22 | Deleting a template used by a campaign warns first |

### 10.4 Risks

| Risk | Mitigation |
| --- | --- |
| Baileys 7 RC API drift | Version pinned exactly; transport interface confines the blast radius to one file |
| WhatsApp bans test numbers | Every automated test uses the mock transport; real-device testing is manual and deliberate |
| 20 sockets exhaust memory | Measure during T2.1; configurable concurrency cap; idle sessions disconnect |
| Auth-folder corruption | Atomic writes, per-device folders, detect and force re-link rather than crash-loop |
| 50k-row import blocks the UI | Worker-thread parse + batched transactions, verified by E2.12 |

---

## 11. Sprint 3 — Campaign engine and groups

**Goal.** Bulk sending that survives crashes, respects anti-ban pacing, and never double-sends
beyond the documented bound. Plus the full group feature set.

**Depends on:** Sprint 2 · REQUIREMENTS §6 (sending defaults), §7.2 (report format).

### 11.1 Tasks

#### T3.1 — Campaign creation and expansion

Create-campaign modal exactly as §2.3, defaulted from Settings. On start, expand the selected
lists into `CampaignRecipient` rows in batched transactions of 1,000, assigning each recipient
to a device round-robin, and store `totalCount`. Numbers appearing in more than one selected
list are deduplicated — the `@@unique([campaignId, contactId])` constraint enforces it at the
database level as well.

#### T3.2 — Send engine

Per-device worker per §6.2, using the atomic claim of §6.3 and the throttle of §6.1. Retries
with backoff up to `retryAttempts`, distinguishing retryable errors (network, timeout, rate
limit) from terminal ones (invalid number, blocked). Progress emitted as a batched
`campaign:progress` event — every 1 second or 25 messages — so a 100k-recipient run cannot
flood the renderer.

#### T3.3 — Crash-safe resume

Exactly the §6.4 recovery sequence, executed before any worker starts. Killing the app mid-run
and relaunching must continue cleanly with counters recomputed from the queue rows.

#### T3.4 — Campaign controls and scheduling

Pause (workers finish the in-flight message, then stop), Resume, Stop (terminal → `completed`),
Delete (confirmation + queue cleanup). A scheduler tick in main starts `scheduled` campaigns
when their time arrives, **including campaigns whose time passed while the app was closed**.
Device disconnection mid-campaign parks that device's slice and reassigns it to remaining
connected devices; if none remain, the campaign pauses with a clear reason.

#### T3.5 — Campaigns UI

Card grid per §2.3 with live counters, status-conditional buttons, and the delay/sleep summary
line. Plus a campaign detail route (`/campaigns/[id]`) listing per-recipient status with
filtering — not in the prototype, but the queue makes it nearly free and it is the first thing
anyone asks for when a campaign underperforms.

#### T3.6 — Campaign report

Export per REQUIREMENTS §7.2. Recommended default: CSV with one row per recipient (phone, name,
device, status, attempts, sent time, error) preceded by a summary block — replacing the
prototype's plain-text summary.

#### T3.7 — Groups: sync and list

Fetch groups per connected device with participant counts and admin flag, persist to `Group`,
refresh on demand with a visible `syncedAt`. Left rail with device filter, select-all over the
filtered set, multi-select with the prototype's green selected state, and a live counter.

#### T3.8 — Groups: bulk messaging

Right pane per §2.4. Runs as a `GroupSendJob` with per-group `GroupSendTarget` rows, so it is
observable, resumable and reportable exactly like a campaign, and it uses the same throttle
scheduler. Validation mirrors the prototype ("Select at least one group", "Select a template").

#### T3.9 — Groups: bulk creation

Create-in-bulk modal per §2.4 with the live name preview. Executes as a `GroupCreateJob` with
per-group progress, partial-failure tolerance, and a result summary written to `resultLog`.
Suffix rules: `number` → zero-padded to 3 digits; `alphabet` → A–Z then AA, AB…; `timestamp` →
epoch seconds; `none`. Participant addition reports per-contact outcomes and explains that
WhatsApp privacy settings can silently prevent adding a contact — a platform behavior, not a
bug.

### 11.2 Acceptance criteria

- A 10,000-recipient campaign across 5 devices completes with counters exactly matching the
  recipient rows.
- Measured inter-send gaps fall inside the configured random delay range, and a sleep pause
  appears after every N messages.
- Force-killing the app at 30% and relaunching resumes from the first pending recipient, with
  no duplicates beyond the documented one-per-device-per-crash bound.
- Pause stops sending within one message; Resume continues from the same position.
- A campaign scheduled for a time while the app was closed starts on the next launch.
- Disconnecting a device mid-campaign does not fail the campaign; its share is reassigned.
- Bulk group creation with prefix `Sales Team` and sequential suffix yields `Sales Team 001…005`
  with the configured delay observed.
- Bulk group messaging reaches every selected group and records per-group outcomes.

### 11.3 E2E tests

| ID | Test |
| --- | --- |
| E3.1 | Create campaign; every prototype field persists correctly |
| E3.2 | Validation: no device or no list → blocked with the prototype's message |
| E3.3 | Run a 1,000-recipient campaign on the mock transport → counters reconcile |
| E3.4 | Delay range respected (send timestamps sampled and asserted) |
| E3.5 | Sleep-after-N pause observed |
| E3.6 | Pause → no further sends; Resume → continues from the same index |
| E3.7 | Stop → status `completed`, workers idle |
| E3.8 | **Kill mid-campaign → relaunch → resumes; duplicates ≤ bound** |
| E3.9 | Stuck `sending` rows are reset to `pending` on boot |
| E3.10 | Counters recomputed from rows after a crash, not carried in memory |
| E3.11 | Scheduled campaign fires at its time |
| E3.12 | Scheduled campaign whose time passed while closed fires on launch |
| E3.13 | Device disconnect mid-run → slice reassigned, campaign continues |
| E3.14 | All devices disconnect → campaign pauses with a reason |
| E3.15 | Send failures retry then mark `failed`; failed count matches |
| E3.16 | Contact in two selected lists is queued exactly once |
| E3.17 | Merge tags resolve per recipient in the actual sent payload |
| E3.18 | Report export contains every recipient with correct statuses |
| E3.19 | Daily per-device cap parks a device once reached |
| E3.20 | Group sync lists mock groups with member counts |
| E3.21 | Select-all + bulk group send reaches every selected group |
| E3.22 | Group send delay respected |
| E3.23 | Bulk create 5 groups with each of the four suffix rules |
| E3.24 | Bulk create partial failure → summary reports it, job completes |
| E3.25 | Participant-add failures are reported per contact, not swallowed |

### 11.4 Risks

| Risk | Mitigation |
| --- | --- |
| Double sends after a crash | Atomic claim, `messageId` recorded, unique constraint, bounded and documented worst case, asserted by E3.8 |
| 100k queue rows slow the UI | Counters aggregated in SQL, progress events batched, recipient list paginated |
| WhatsApp rate-limits or bans accounts | Conservative defaults, mandatory throttle path, daily caps, strictly one in-flight message per device |
| Group participant-add silently fails | Per-participant results surfaced with the privacy-setting explanation |
| Scheduler drift while the app sleeps | Compare against wall clock on wake, not a monotonic timer |

---

## 12. Sprint 4 — Inbox, AI bot, settings, dashboard, release

**Goal.** Close the remaining screens and ship a signed, auto-updating, installable product.

**Depends on:** Sprint 3 · REQUIREMENTS §2, §3, §4, §5, §7.1, §7.3.

### 12.1 Tasks

#### T4.1 — Inbox

Two-pane layout per §2.2. Left: search, device filter, chat list with unread badges ordered by
recency. Right: chat header, **virtualized** message thread with backwards paging on scroll,
and the composer. Live ingestion from `messages.upsert` persisted to `Message` and pushed as
`message:received`. Renders all four prototype message shapes. Composer supports text, the
prototype's emoji set, media attachment, document attachment, and quick-reply buttons —
**sending through the throttle scheduler like everything else**. Read receipts via
`message:status`, unread clearing on open. Retention cleanup job per REQUIREMENTS §7.3.

#### T4.2 — AI Bot

Every prototype control from §2.8, persisted to `ChatbotConfig`.

Runtime: an incoming message on a device with auto-reply enabled builds a prompt from the
system instructions, business info, tone, goal, style, language, parsed products and parsed
knowledge base, plus the last N messages of history; calls OpenAI with the user's key; waits
the configured human-like delay; and replies through the throttle scheduler. Escalation per
REQUIREMENTS §5 sets `Chat.isEscalated` and surfaces the chat in the inbox instead of replying.

Failure modes are explicit and distinct — `AI_KEY_MISSING`, `AI_KEY_INVALID`, `AI_RATE_LIMITED`,
`AI_TIMEOUT` — each logged and surfaced; **never a silent no-op**. Hard rules: the bot never
replies in groups, never replies to itself, never replies to a chat with `autoReplyOptOut`, and
respects the optional daily reply cap.

#### T4.3 — Settings, remaining sections

- **License** — from Sprint 1.
- **AI** — OpenAI key via `safeStorage`, model dropdown, max tokens, temperature, history
  depth, daily cap, and a *Test key* button making one cheap call and reporting the result.
- **Sending defaults** — delay range, sleep duration, sleep-after-N, group delays, daily cap per
  device, retry attempts, max concurrent devices; applied as defaults to new campaigns.
- **Data & backup** — DB path with *Open folder*, database size, full backup export,
  restore-from-backup with confirmation, clear-all-data behind a typed confirmation, and
  retention controls.
- **About & updates** — version, *Check for updates*, changelog, *Export diagnostics*.

#### T4.4 — Dashboard

Replace the prototype's hardcoded numbers with real aggregates per REQUIREMENTS §7.1, computed
in SQL: Total Contacts, Active Devices, Running Campaigns, Templates — plus today's
sent/failed totals and recent campaign activity. Cards link to their screens.

#### T4.5 — Packaging and release

`electron-builder` producing NSIS (Windows, per-user install, no admin required) and DMG
(macOS, architecture per REQUIREMENTS §4). Native module rebuild wired for both platforms.
Windows signing per §4; macOS signing, notarization and stapling with hardened runtime and the
minimum necessary entitlements. Icons and installer artwork from `assets/branding/`.
`electron-updater` against the customer feed from §3, with update-available and
update-downloaded UI, safe handling of a failed update, and a documented version-bump and
changelog process.

#### T4.6 — Hardening pass

Full regression across Sprints 1–4. `npm audit` reviewed and resolved. Memory profile under 20
devices plus an active campaign. Startup-time measurement and optimization. Every error path
confirmed to produce a user-facing message. README rewritten with setup, dev, build and release
instructions. Final packaged smoke test on both platforms.

### 12.2 Acceptance criteria

- Incoming messages appear live, persist, and survive restart.
- Outgoing composer messages arrive on the recipient's phone (manual real-device verification)
  and appear in the thread.
- All four message types render correctly.
- With a valid OpenAI key and auto-reply on, an incoming message produces a contextual reply
  after the configured delay, respecting the throttle.
- With no key configured, auto-reply is skipped and the user is told why.
- An escalation trigger flags the chat instead of replying.
- Dashboard numbers match direct database queries.
- Backup export and restore round-trip a populated database.
- Signed installers install on clean Windows and macOS machines without security warnings.
- The app detects and installs an update from the configured feed.

### 12.3 E2E tests

| ID | Test |
| --- | --- |
| E4.1 | Incoming mock message appears in the chat list and thread |
| E4.2 | Device filter narrows chats correctly |
| E4.3 | Chat search matches name and phone |
| E4.4 | Send text from composer → outgoing bubble, throttle respected |
| E4.5 | All four message types render with correct styling |
| E4.6 | Unread badge increments and clears on open |
| E4.7 | Message history pages backwards on scroll |
| E4.8 | Retention cleanup removes messages past the configured age |
| E4.9 | Save full AI Bot config → persists across restart |
| E4.10 | Auto-reply fires with a mocked OpenAI client after the configured delay |
| E4.11 | Auto-reply disabled → no reply |
| E4.12 | Missing key → `AI_KEY_MISSING` surfaced, no silent failure |
| E4.13 | Invalid key → `AI_KEY_INVALID` surfaced distinctly |
| E4.14 | Escalation trigger flags the chat instead of replying |
| E4.15 | Bot never replies in groups or to itself |
| E4.16 | Per-chat opt-out suppresses auto-reply |
| E4.17 | AI key round-trips through `safeStorage` and never appears in logs |
| E4.18 | *Test key* reports success and failure correctly |
| E4.19 | Sending defaults are applied to a newly created campaign |
| E4.20 | Backup → clear data → restore reproduces the original state |
| E4.21 | Clear-all-data requires typed confirmation |
| E4.22 | Dashboard aggregates match direct SQL |
| E4.23 | Update check against a mock feed reports the available version |
| E4.24 | Packaged build smoke test on Windows and macOS |
| E4.25 | Full Sprint 1–3 regression suite green |

### 12.4 Risks

| Risk | Mitigation |
| --- | --- |
| Apple notarization rejects the build | Attempt notarization in the first days of the sprint, not the last; hardened runtime and entitlements planned up front |
| Certificates unavailable at release | REQUIREMENTS §4 asks early; unsigned interim builds possible with a documented warning |
| OpenAI cost surprises for end users | Token caps, optional daily reply limits, visible usage in Settings |
| Inbox history bloats the DB | Retention policy enforced by a scheduled cleanup job, asserted by E4.8 |
| AI replies to the wrong chat | Hard rules (no groups, no self, opt-out) asserted by E4.15/E4.16 |

---

## 13. Cross-sprint definition of done

A sprint is complete only when **all** of the following hold:

1. Every task in the sprint is implemented — no partial features silently deferred.
2. All new E2E tests pass, **and every previous sprint's suite still passes**.
3. `npm run typecheck` and `npm run lint` are clean.
4. `npm run dist` produces a packaged build that launches and passes the smoke test — run every
   sprint, because native-module and Prisma packaging regressions surface nowhere else.
5. No `TODO`, `FIXME`, `any` at an IPC boundary, or commented-out code in the diff.
6. Every new error path is typed, logged, and surfaced to the user.
7. Graph refreshed (`graphify . --update`) and `GRAPH_REPORT.md` committed.
8. `SPRINT-TRACKER.md` updated with status, test results, decisions and deviations.
9. Committed and pushed to `main`.

---

## 14. Dependency manifest

Planned dependencies with the reason each exists. Versions are resolved and pinned at install
time in Sprint 1; nothing floats on `^`.

| Package | Role | Sprint |
| --- | --- | --- |
| `electron` | Desktop shell | 1 |
| `electron-vite` | Main/preload/wa-service bundling with HMR | 1 |
| `electron-builder` | NSIS + DMG packaging, signing, notarization | 1 (config) / 4 (release) |
| `electron-updater` | Auto-update against the customer feed | 4 |
| `electron-log` | Rotating structured logs in all processes | 1 |
| `next` · `react` · `react-dom` | Renderer | 1 |
| `tailwindcss` · `class-variance-authority` · `tailwind-merge` | Styling | 1 |
| `shadcn/ui` primitives (`@radix-ui/*`) | Accessible components | 1 |
| `lucide-react` | Icons, replacing the prototype's emoji | 1 |
| `zod` | IPC validation, both directions | 1 |
| `@prisma/client` · `prisma` · `@prisma/adapter-better-sqlite3` | ORM + driver adapter | 1 |
| `better-sqlite3` | Synchronous SQLite driver | 1 |
| `baileys` | WhatsApp Web protocol — **pinned exactly**, version per REQUIREMENTS §7.6 | 2 |
| `qrcode` | Render the QR the socket emits | 2 |
| `libphonenumber-js` | E.164 normalization and validation | 2 |
| `papaparse` | Streaming CSV parse in a worker | 2 |
| `@tanstack/react-virtual` | Virtualized 50k-row tables and message threads | 2 |
| `@tanstack/react-query` | Renderer cache over IPC invokes | 1 |
| `date-fns` | Relative timestamps ("2 min ago") | 1 |
| `openai` | AI Bot | 4 |
| `@playwright/test` | E2E through `_electron` | 1 |
| `typescript` · `eslint` · `prettier` | Toolchain | 1 |

Deliberately **not** used: any Baileys fork or wrapper (`baileys-pro`, `baileys-antiban`,
`mahiru-baileys`) — the anti-ban pacing in §6.1 is ours and auditable, and forks add supply-chain
risk to the most security-sensitive dependency in the app.
