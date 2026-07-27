# RapBooster Advance — Requirements Questionnaire

> **Status:** ⬜ Not filled &nbsp;|&nbsp; **Owner:** Punit &nbsp;|&nbsp; **Blocks:** parts of Sprints 1 and 4
>
> Every blank below maps to something the application genuinely cannot be finished without.
> If an item does not apply, write `N/A` — do not leave it empty, so we can tell "not
> applicable" from "not yet answered".
>
> **Build is proceeding without waiting for these.** On instruction (2026-07-27), Sprint 1
> started before this file was filled. Anything that depends on an answer here is built
> against a documented default or behind a swappable interface, and every such choice is
> listed in [§0 Working assumptions](#section-0--working-assumptions-in-effect). When you fill
> a section in, the corresponding assumption is replaced and the affected code updated — no
> rewrite required, because the dependencies were isolated deliberately.

---

## Section 0 — Working assumptions in effect

These are the defaults the build is currently running on. **Each one is a placeholder, not a
decision.** Correct any of them by filling the linked section; nothing here is baked in.

| # | Assumption in use | Replaced by | Cost to change later |
| --- | --- | --- | --- |
| A1 | License server calls go through a `LicenseService` interface with a mock implementation; no real endpoint is wired | §1 | Low — one file (`license.service.ts`) |
| A2 | Product name "RapBooster Advance", appId `com.rapbooster.advance`, placeholder icon | §2 | Low — config + assets swap |
| A3 | No update feed configured; `electron-updater` wired but pointed at a placeholder URL read from config | §3 | Low — config value |
| A4 | Builds are unsigned; signing config present but disabled | §4 | Low — config + certs |
| A5 | OpenAI model defaults to a current general-purpose model; user must supply their own key | §5 | Low — settings default |
| A6 | Sending defaults = the prototype's values (delay 0–5s, sleep 10s after 10 msgs, group delay 2s), daily cap unlimited, 2 retries | §6 | Low — seeded settings row |
| A7 | Default country code for phone normalization: **`+91`** (India) | §7.5 | **Medium** — changes how imported numbers normalize; re-import may be needed if wrong |
| A8 | Duplicate policy on import: **skip** | §7.4 | Low — settings default |
| A9 | Campaign report exports **CSV, one row per recipient** (upgrade over the prototype's `.txt`) | §7.2 | Low |
| A10 | Inbox retention: **forever** (no cleanup job active) | §7.3 | Low |
| A11 | Dashboard stats use the suggested definitions in §7.1 | §7.1 | Low |
| A12 | Baileys pinned to the **7.x line**; exact version recorded in the tracker's decision log | §7.6 | Medium — regression run required |
| A13 | Escalation uses **keyword triggers**; the confidence-threshold control is stored but not enforced | §5 | Medium — prompt + logic change |

**A7 is the one worth checking early.** If your contact lists are not Indian numbers, tell me
the right country code before a large CSV import happens, because normalization is applied at
import time and stored.

---

## How to fill this

- Replace every `___` or `TODO` with a real value.
- **Do not put secrets in this file.** It is committed to git. For anything sensitive
  (certificate passwords, API keys, private URLs) write *where to find it* here, and put the
  actual value in `REQUIREMENTS.local.md`, which is git-ignored.
- Mark each section's checkbox when complete.

---

## Section 1 — License Server API ⬜

The prototype's activation screen validates keys client-side against a hardcoded list. The
real app must call your server. Everything below is needed to write that client.

### 1.1 Connection

| Item | Value |
| --- | --- |
| Base URL (production) | `___` |
| Base URL (staging/test, if any) | `___` |
| Auth scheme | ⬜ None ⬜ API key header ⬜ Bearer token ⬜ HMAC signature ⬜ Other: `___` |
| Header name(s) and format | `___` (e.g. `X-Api-Key: <key>`) |
| Where do I get the credential? | `___` (name it; put the value in `REQUIREMENTS.local.md`) |
| TLS / certificate pinning required? | ⬜ No ⬜ Yes — details: `___` |
| Rate limits I should respect | `___` |

### 1.2 Endpoints

Fill in the path and method for each operation. If your server combines any of these into one
endpoint, say so.

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Activate a license on this machine | `___` | `___` | |
| Validate / heartbeat an existing activation | `___` | `___` | How often should the app re-validate? `___` |
| Deactivate this machine | `___` | `___` | |
| Transfer — deactivate elsewhere + activate here | `___` | `___` | Is this a separate endpoint, or activate with a `force` flag? `___` |
| Fetch license details (plan, expiry, seats) | `___` | `___` | Optional |

### 1.3 Request and response shapes

Paste real JSON (redact any secret values).

#### Activate — request

```json
TODO
```

#### Activate — success response

```json
TODO
```

#### Activate — response when the key is already in use on another machine (the "conflict" case)

```json
TODO
```

#### Activate — response when the key is invalid / expired / revoked

```json
TODO
```

#### Validate / heartbeat — request and response

```json
TODO
```

#### Deactivate — request and response

```json
TODO
```

#### Transfer — request and response

```json
TODO
```

### 1.4 Outcome mapping

The UI has exactly three outcomes (`valid`, `invalid`, `conflict`) plus a network-error state.
Tell me how to distinguish them.

| Outcome | HTTP status | Body field + value that identifies it |
| --- | --- | --- |
| Valid / activated | `___` | `___` |
| Invalid key | `___` | `___` |
| Expired | `___` | `___` |
| Revoked / blocked | `___` | `___` |
| Conflict — active on another device | `___` | `___` |
| Seat limit reached (if different from conflict) | `___` | `___` |
| Server error / maintenance | `___` | `___` |

### 1.5 Device identity

| Question | Answer |
| --- | --- |
| What field name does your server expect for the machine fingerprint? | `___` |
| What format? (UUID, MAC hash, arbitrary string, max length) | `___` |
| Do you want a human-readable device name sent too? Field name? | `___` |
| The conflict dialog shows *"Device: Another Computer (Last used: 2 days ago)"* — which response fields supply that name and timestamp? | name: `___` last-used: `___` |
| Are OS / app-version / hostname fields expected? | `___` |
| How many devices may one key be active on at once? | `___` |

### 1.6 Policy

| Question | Answer |
| --- | --- |
| The mockup has an optional **"Remarks"** field on activation. Is it sent to the server? Under what field name? | `___` |
| Does a license expire? How is expiry communicated? | `___` |
| **Offline grace period** — how long may the app run without reaching the server before it locks? (0 = must always be online) | `___` |
| How often should the app silently re-validate? (e.g. every launch, every 24h) | `___` |
| If re-validation fails with a network error (not a rejection), what should the app do? | ⬜ Keep working until grace expires ⬜ Lock immediately ⬜ Other: `___` |
| Should the user be able to deactivate their own machine from Settings? | ⬜ Yes ⬜ No |
| Is there a trial mode? | ⬜ No ⬜ Yes — how is it obtained/limited: `___` |

### 1.7 Anything else

Link to your API docs, a Postman collection, or paste extra notes:

```text
TODO
```

---

## Section 2 — Branding and Identity ⬜

| Item | Value |
| --- | --- |
| Final product name (shown in title bar, installer, About) | `___` (mockup says "RapBooster Advance") |
| Short name / executable name | `___` |
| Company / publisher name (appears in the signed installer) | `___` |
| Copyright line | `___` |
| Application ID / bundle ID (reverse-DNS, e.g. `com.example.rapbooster`) | `___` |
| Website / support URL | `___` |
| Support email (also used in the app's error/diagnostics screen) | `___` |
| Custom protocol handler needed? (e.g. `rapbooster://`) | ⬜ No ⬜ Yes: `___` |

**Assets** — drop files into `assets/branding/` and tick when done:

- ⬜ App icon, 1024×1024 PNG with transparency (I generate `.ico` and `.icns` from it)
- ⬜ Windows installer sidebar image, 164×314 BMP *(optional — default used if absent)*
- ⬜ Windows installer header image, 150×57 BMP *(optional)*
- ⬜ macOS DMG background, 540×380 PNG *(optional)*
- ⬜ Logo for the in-app sidebar / activation screen, SVG or PNG
- ⬜ Brand colors, if you want to override the palette derived from the prototype:
  primary `___` (prototype uses `#0078d4`), danger `___` (`#c50f1f`)

---

## Section 3 — Update Feed ⬜

You chose auto-update via **your own server / S3**.

| Item | Value |
| --- | --- |
| Feed base URL | `___` (e.g. `https://updates.example.com/rapbooster/`) |
| Hosting type | ⬜ S3 ⬜ Generic HTTPS ⬜ Other: `___` |
| Is the feed publicly readable? | ⬜ Yes ⬜ No — auth method: `___` |
| Separate channels? (stable / beta) | ⬜ Just stable ⬜ Yes: `___` |
| Who uploads release artifacts — me (via CI) or you (manually)? | `___` |
| If CI: which service, and where are the upload credentials? | `___` |
| Should updates install silently or prompt the user? | ⬜ Prompt ⬜ Silent, apply on quit ⬜ Prompt then restart |
| Minimum supported version — should older versions be force-updated? | `___` |

---

## Section 4 — Code Signing and Notarization ⬜

Without these, Windows shows a SmartScreen warning and macOS refuses to open the app.

### 4.1 Windows

| Item | Value |
| --- | --- |
| Do you have a code-signing certificate? | ⬜ Yes ⬜ No — need to purchase ⬜ Skip signing for now |
| Certificate type | ⬜ OV (`.pfx` file) ⬜ EV (hardware token / cloud HSM) ⬜ Azure Trusted Signing |
| Where is the cert file, and where is its password stored? | `___` (value → `REQUIREMENTS.local.md`) |
| If Azure Trusted Signing: endpoint, account, cert profile | `___` |
| Timestamp server URL preference | `___` (default `http://timestamp.digicert.com`) |

### 4.2 macOS

| Item | Value |
| --- | --- |
| Do you have a paid Apple Developer account? | ⬜ Yes ⬜ No ⬜ Skip macOS signing for now |
| Apple Team ID | `___` |
| "Developer ID Application" certificate installed on the build machine? | ⬜ Yes ⬜ No |
| Notarization credential | ⬜ App-specific password ⬜ App Store Connect API key (`.p8` + key ID + issuer ID) |
| Where are those stored? | `___` (values → `REQUIREMENTS.local.md`) |
| Which Macs must be supported? | ⬜ Apple Silicon only ⬜ Intel only ⬜ Universal build (both) |
| Minimum macOS version | `___` (default: macOS 11 Big Sur) |

### 4.3 Build machine

macOS artifacts can only be signed and notarized on a Mac.

| Question | Answer |
| --- | --- |
| Do you have a Mac available for builds? | ⬜ Yes ⬜ No — use CI (GitHub Actions macOS runner) ⬜ Ship Windows only for now |

---

## Section 5 — OpenAI / AI Bot ⬜

You chose OpenAI, with the end user pasting their own key.

| Item | Value |
| --- | --- |
| Default model to preselect in Settings | `___` |
| Models to offer in the dropdown | `___` |
| Does a key ever ship with the app, or must every user supply one? | ⬜ User always supplies ⬜ Bundled fallback key (⚠ extractable from the app — not recommended) |
| Max tokens per reply | `___` (suggest 500) |
| Temperature default | `___` (suggest 0.7) |
| Should the app cap spend? (e.g. max AI replies per day per device) | `___` |
| Should conversation history be sent for context? How many prior messages? | `___` (suggest last 10) |
| What happens when the key is missing/invalid — silently skip auto-reply, or notify the user? | `___` |
| Should AI replies be logged for the user to audit? | ⬜ Yes ⬜ No |

The prototype's escalation section sets a **confidence threshold (%)**. OpenAI does not return a
confidence score directly, so tell me which you want:

- ⬜ Ask the model to self-rate its confidence and compare against the threshold
- ⬜ Escalate on keyword triggers only, and drop the threshold control
- ⬜ Other: `___`

---

## Section 6 — Default Sending Policy ⬜

The prototype's create-campaign modal defaults to delay 0–5s, sleep 10s, sleep after 10
messages. Confirm or override these as the app-wide factory defaults (users can still change
them per campaign in Settings → Sending Defaults).

| Setting | Prototype default | Your default |
| --- | --- | --- |
| Random delay from (sec) | 0 | `___` |
| Random delay to (sec) | 5 | `___` |
| Sleep duration (sec) | 10 | `___` |
| Sleep after N messages | 10 | `___` |
| Delay between group messages (sec) | 2 | `___` |
| Delay between group creations (sec) | 2 | `___` |
| **Daily send cap per device** | *(not in prototype)* | `___` (0 = unlimited) |
| Max concurrent devices sending at once | *(not in prototype)* | `___` |
| Should sending pause outside business hours? | *(not in prototype)* | ⬜ No ⬜ Yes: `___` to `___` |
| Retry attempts per failed recipient | *(not in prototype)* | `___` (suggest 2) |

---

## Section 7 — Product Decisions ⬜

Small things the prototype leaves ambiguous. Each has a suggested default — tick it or write
your own.

**7.1 Dashboard stat cards.** The mockup shows Total Contacts / Active Devices / Running
Campaigns / Templates with hardcoded numbers. Confirm what each should actually count:

| Card | Suggested definition | OK? |
| --- | --- | --- |
| Total Contacts | Unique contacts across all lists | ⬜ / `___` |
| Active Devices | Devices currently `connected` | ⬜ / `___` |
| Running Campaigns | Campaigns with status `running` or `paused` | ⬜ / `___` |
| Templates | Total templates saved | ⬜ / `___` |

Want a fifth/sixth card (messages sent today, failure rate)? `___`

**7.2 Campaign report.** The mockup exports a plain `.txt` summary.

- ⬜ Keep plain `.txt` summary
- ⬜ CSV with one row per recipient (number, status, sent time, error) — *recommended*
- ⬜ Both
- ⬜ PDF

**7.3 Inbox retention.** How long should received messages be kept in the local DB?

- ⬜ Forever ⬜ 90 days ⬜ 30 days ⬜ Other: `___`
- Should media files received be downloaded and stored, or only referenced? `___`

**7.4 Contact deduplication.** On CSV import, when a phone number already exists in the list:

- ⬜ Skip the duplicate ⬜ Overwrite existing ⬜ Import anyway ⬜ Ask each time

**7.5 Phone number format.** What default country code should bare numbers be assumed to have?
`___` (e.g. `+91`). Should numbers failing validation be rejected at import or flagged? `___`

**7.6 Baileys version.** ⚠ Needs your call.

`baileys` on npm currently publishes `7.0.0-rc13` as `latest` and `6.7.23` under the `legacy`
tag — so "the latest Baileys" is presently a **release candidate**.

- ⬜ Use `baileys@7.0.0-rc13`, pinned exactly (newest features; RC risk) — *recommended, matches your instruction*
- ⬜ Use `baileys@6.7.23` (proven stable, older API)
- ⬜ Whatever is `latest` at the time Sprint 2 starts, pinned exactly then

Either way the version is pinned exactly (no `^`) and upgrades are a deliberate, tested task.

**7.7 Language.** The chatbot config offers reply languages, but should the **app UI** itself be
translatable?

- ⬜ English only ⬜ Prepare for i18n (adds scope) ⬜ Other: `___`

**7.8 Telemetry / crash reporting.** Should the app phone home with anonymous crash reports?

- ⬜ No, local logs only — *default* ⬜ Yes, to: `___`

---

## Section 8 — Anything I have not asked about ⬜

Constraints, integrations, deadlines, or existing systems this must fit into:

```text
TODO
```

---

## Sign-off

| | |
| --- | --- |
| Filled by | `___` |
| Date | `___` |
| Ready to start Sprint 1? | ⬜ Yes |
