# RapBooster Advance — What I still need from you

> **Owner:** Punit &nbsp;|&nbsp; **Last trimmed:** 2026-07-28
>
> This file holds **only open questions**. Anything you have already decided has been built and
> moved to the decision log in [SPRINT-TRACKER.md](./SPRINT-TRACKER.md) §7 — it is recorded
> there with the reasoning, not repeated here.
>
> If an item does not apply, write `N/A` rather than leaving it blank, so "not applicable" is
> distinguishable from "not yet answered".

## The short version

| #   | What I need                                      | Where | If you skip it                                                |
| --- | ------------------------------------------------ | ----- | ------------------------------------------------------------- |
| 1   | **License server API** (URL + request/reply)     | §1    | Nobody but you can activate the app                           |
| 2   | **Windows code-signing certificate**             | §4    | SmartScreen warns on install; most users stop there           |
| 3   | **Branding** — icon, publisher name, support URL | §2    | A placeholder icon ships and the installer shows no publisher |
| 4   | **Update feed URL**                              | §3    | No way to ship a fix after release                            |
| 5   | **AI defaults** — model, caps                    | §5    | Sensible defaults stay; spend is uncapped                     |

**You can run and test everything today without any of these.** `npm run dev:mock` starts the
app against a mock license server and a fake WhatsApp transport — activate with
`VALID-DEMO-001`. See the README's "Running without a license server".

Everything in §6 already has a working default. Read it only if you want to change one.

---

## Section 1 — License Server API ⬜

The prototype's activation screen validates keys client-side against a hardcoded list. The
real app must call your server. Everything below is needed to write that client.

> **You can run and test the whole app before answering this section.** `npm run dev:mock`
> starts it against a deterministic mock license server and a fake WhatsApp transport — no
> license server, no real WhatsApp account. Activate with `VALID-DEMO-001`; the other test key
> prefixes (`CONFLICT-`, `EXPIRED-`, `REVOKED-`, `OFFLINE-`) exercise every rejection and the
> offline grace path. See the README's "Running without a license server".

### 1.1 Connection

| Item                                | Value                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Base URL (production)               | `___`                                                                       |
| Base URL (staging/test, if any)     | `___`                                                                       |
| Auth scheme                         | ⬜ None ⬜ API key header ⬜ Bearer token ⬜ HMAC signature ⬜ Other: `___` |
| Header name(s) and format           | `___` (e.g. `X-Api-Key: <key>`)                                             |
| Where do I get the credential?      | `___` (name it; put the value in `REQUIREMENTS.local.md`)                   |
| TLS / certificate pinning required? | ⬜ No ⬜ Yes — details: `___`                                               |
| Rate limits I should respect        | `___`                                                                       |

### 1.2 Endpoints

Fill in the path and method for each operation. If your server combines any of these into one
endpoint, say so.

| Operation                                       | Method | Path  | Notes                                                               |
| ----------------------------------------------- | ------ | ----- | ------------------------------------------------------------------- |
| Activate a license on this machine              | `___`  | `___` |                                                                     |
| Validate / heartbeat an existing activation     | `___`  | `___` | How often should the app re-validate? `___`                         |
| Deactivate this machine                         | `___`  | `___` |                                                                     |
| Transfer — deactivate elsewhere + activate here | `___`  | `___` | Is this a separate endpoint, or activate with a `force` flag? `___` |
| Fetch license details (plan, expiry, seats)     | `___`  | `___` | Optional                                                            |

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

| Outcome                                         | HTTP status | Body field + value that identifies it |
| ----------------------------------------------- | ----------- | ------------------------------------- |
| Valid / activated                               | `___`       | `___`                                 |
| Invalid key                                     | `___`       | `___`                                 |
| Expired                                         | `___`       | `___`                                 |
| Revoked / blocked                               | `___`       | `___`                                 |
| Conflict — active on another device             | `___`       | `___`                                 |
| Seat limit reached (if different from conflict) | `___`       | `___`                                 |
| Server error / maintenance                      | `___`       | `___`                                 |

### 1.5 Device identity

| Question                                                                                                                               | Answer                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| What field name does your server expect for the machine fingerprint?                                                                   | `___`                        |
| What format? (UUID, MAC hash, arbitrary string, max length)                                                                            | `___`                        |
| Do you want a human-readable device name sent too? Field name?                                                                         | `___`                        |
| The conflict dialog shows _"Device: Another Computer (Last used: 2 days ago)"_ — which response fields supply that name and timestamp? | name: `___` last-used: `___` |
| Are OS / app-version / hostname fields expected?                                                                                       | `___`                        |
| How many devices may one key be active on at once?                                                                                     | `___`                        |

### 1.6 Policy

| Question                                                                                                                     | Answer                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The mockup has an optional **"Remarks"** field on activation. Is it sent to the server? Under what field name?               | `___`                                                                   |
| Does a license expire? How is expiry communicated?                                                                           | `___`                                                                   |
| **Offline grace period** — how long may the app run without reaching the server before it locks? (0 = must always be online) | `___`                                                                   |
| How often should the app silently re-validate? (e.g. every launch, every 24h)                                                | `___`                                                                   |
| If re-validation fails with a network error (not a rejection), what should the app do?                                       | ⬜ Keep working until grace expires ⬜ Lock immediately ⬜ Other: `___` |
| Should the user be able to deactivate their own machine from Settings?                                                       | ⬜ Yes ⬜ No                                                            |
| Is there a trial mode?                                                                                                       | ⬜ No ⬜ Yes — how is it obtained/limited: `___`                        |

### 1.7 Anything else

Link to your API docs, a Postman collection, or paste extra notes:

```text
TODO
```

---

## Section 2 — Branding and Identity ⬜

| Item                                                                    | Value                                    |
| ----------------------------------------------------------------------- | ---------------------------------------- |
| Final product name (shown in title bar, installer, About)               | `___` (mockup says "RapBooster Advance") |
| Short name / executable name                                            | `___`                                    |
| Company / publisher name (appears in the signed installer)              | `___`                                    |
| Copyright line                                                          | `___`                                    |
| Application ID / bundle ID (reverse-DNS, e.g. `com.example.rapbooster`) | `___`                                    |
| Website / support URL                                                   | `___`                                    |
| Support email (also used in the app's error/diagnostics screen)         | `___`                                    |
| Custom protocol handler needed? (e.g. `rapbooster://`)                  | ⬜ No ⬜ Yes: `___`                      |

**Assets** — drop files into `assets/branding/` and tick when done:

- ⬜ App icon, 1024×1024 PNG with transparency (I generate the `.ico` from it)
- ⬜ Windows installer sidebar image, 164×314 BMP _(optional — default used if absent)_
- ⬜ Windows installer header image, 150×57 BMP _(optional)_
- ⬜ Logo for the in-app sidebar / activation screen, SVG or PNG
- ⬜ Brand colors, if you want to override the palette derived from the prototype:
  primary `___` (prototype uses `#0078d4`), danger `___` (`#c50f1f`)

---

## Section 3 — Update Feed ⬜

You chose auto-update via **your own server / S3**.

| Item                                                                | Value                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| Feed base URL                                                       | `___` (e.g. `https://updates.example.com/rapbooster/`)    |
| Hosting type                                                        | ⬜ S3 ⬜ Generic HTTPS ⬜ Other: `___`                    |
| Is the feed publicly readable?                                      | ⬜ Yes ⬜ No — auth method: `___`                         |
| Separate channels? (stable / beta)                                  | ⬜ Just stable ⬜ Yes: `___`                              |
| Who uploads release artifacts — me (via CI) or you (manually)?      | `___`                                                     |
| If CI: which service, and where are the upload credentials?         | `___`                                                     |
| Should updates install silently or prompt the user?                 | ⬜ Prompt ⬜ Silent, apply on quit ⬜ Prompt then restart |
| Minimum supported version — should older versions be force-updated? | `___`                                                     |

---

## Section 4 — Code Signing ⬜

Without this, Windows shows a SmartScreen warning when someone runs the installer.

**Windows is the only distribution target** (decided 2026-07-28), so there is nothing to answer
about Apple Developer accounts, notarization or a Mac build machine.

| Item                                                      | Value                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Do you have a code-signing certificate?                   | ⬜ Yes ⬜ No — need to purchase ⬜ Skip signing for now                         |
| Certificate type                                          | ⬜ OV (`.pfx` file) ⬜ EV (hardware token / cloud HSM) ⬜ Azure Trusted Signing |
| Where is the cert file, and where is its password stored? | `___` (value → `REQUIREMENTS.local.md`)                                         |
| If Azure Trusted Signing: endpoint, account, cert profile | `___`                                                                           |
| Timestamp server URL preference                           | `___` (default `http://timestamp.digicert.com`)                                 |

---

## Section 5 — OpenAI / AI Bot ⬜

You chose OpenAI, with the end user pasting their own key.

| Item                                                                                         | Value                                                                                          |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Default model to preselect in Settings                                                       | `___`                                                                                          |
| Models to offer in the dropdown                                                              | `___`                                                                                          |
| Does a key ever ship with the app, or must every user supply one?                            | ⬜ User always supplies ⬜ Bundled fallback key (⚠ extractable from the app — not recommended) |
| Max tokens per reply                                                                         | `___` (suggest 500)                                                                            |
| Temperature default                                                                          | `___` (suggest 0.7)                                                                            |
| Should the app cap spend? (e.g. max AI replies per day per device)                           | `___`                                                                                          |
| Should conversation history be sent for context? How many prior messages?                    | `___` (suggest last 10)                                                                        |
| What happens when the key is missing/invalid — silently skip auto-reply, or notify the user? | `___`                                                                                          |
| Should AI replies be logged for the user to audit?                                           | ⬜ Yes ⬜ No                                                                                   |

---

## Section 6 — Defaults already in effect ⬜

Each of these is running now with the value shown. Nothing here blocks anything; change one by
writing over its value.

| Setting                             | Running as                                                          | Change to |
| ----------------------------------- | ------------------------------------------------------------------- | --------- |
| Random delay between messages       | 0–5 seconds                                                         | `___`     |
| Sleep duration / after N messages   | 10 seconds after every 10                                           | `___`     |
| Delay between group messages        | 2 seconds                                                           | `___`     |
| Delay between group creations       | 2 seconds                                                           | `___`     |
| Daily send cap per device           | Unlimited                                                           | `___`     |
| Max devices sending at once         | 20                                                                  | `___`     |
| Retry attempts per failed recipient | 2                                                                   | `___`     |
| Pause outside business hours        | No                                                                  | `___`     |
| Duplicate handling on import        | Skip the duplicate                                                  | `___`     |
| Inbox retention                     | Forever, media referenced on disk                                   | `___`     |
| Campaign report format              | CSV, one row per recipient                                          | `___`     |
| Dashboard cards                     | Contacts · connected devices · running+paused campaigns · templates | `___`     |
| App UI language                     | English only                                                        | `___`     |
| Crash reporting                     | Local logs only, nothing phones home                                | `___`     |
| Baileys version                     | `7.0.0-rc13`, pinned exactly (npm's `latest`)                       | `___`     |
| WhatsApp Business API integration   | Out of scope — Baileys only                                         | `___`     |

---

## Section 7 — Anything I have not asked about ⬜

Constraints, integrations, deadlines, or existing systems this must fit into:

```text
TODO
```

---

## Already decided — no action needed

Recorded in [SPRINT-TRACKER.md](./SPRINT-TRACKER.md) §7 with the full reasoning:

| Decision                                                                     | Tracker  |
| ---------------------------------------------------------------------------- | -------- |
| Windows-only distribution; Apple packaging and notarization removed          | D66      |
| No default country code — every import asks, per file                        | D67      |
| Link previews always on, fetched once per URL rather than once per message   | D68, D69 |
| Real WhatsApp buttons and single-select lists, with a numbered-text fallback | D70–D72  |

---

## Sign-off

|           |       |
| --------- | ----- |
| Filled by | `___` |
| Date      | `___` |
