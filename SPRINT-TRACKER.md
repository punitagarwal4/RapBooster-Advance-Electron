# RapBooster Advance — Sprint Tracker

Living status document. **Update this in the same commit as the work it describes** — a tracker
that lags the code is worse than no tracker.

Specification: [SPRINTS.md](./SPRINTS.md) · Rules: [CLAUDE.md](./CLAUDE.md) ·
Inputs: [REQUIREMENTS.md](./REQUIREMENTS.md)

Last updated: **2026-07-27**

---

## 1. Overview

| Sprint | Scope | Status | Started | Completed | Tasks | E2E | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Documentation | 🟡 In progress | 2026-07-27 | — | 4/5 | n/a | — |
| 1 | Foundation · Licensing · Shell | ⬜ Blocked | — | — | 0/11 | 0/16 | — |
| 2 | Devices · Contacts · Templates | ⬜ Not started | — | — | 0/7 | 0/22 | — |
| 3 | Campaign engine · Groups | ⬜ Not started | — | — | 0/9 | 0/25 | — |
| 4 | Inbox · AI Bot · Settings · Release | ⬜ Not started | — | — | 0/6 | 0/25 | — |

**Legend:** ⬜ Not started · 🟡 In progress · 🟢 Complete · 🔴 Blocked · ⚪ Deferred

### Current blocker

> 🔴 **Sprint 1 cannot start until [REQUIREMENTS.md](./REQUIREMENTS.md) is filled.**
> Specifically §1 (license server API), §2 (branding), §6 (sending defaults) are required
> before the first line of Sprint 1 code. §3, §4, §5 and §7 are needed by Sprint 4 but should
> be answered at the same time.

---

## 2. Sprint 0 — Documentation

**Goal:** Freeze scope and produce planning artifacts before any code exists.

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T0.1 | Extract complete feature inventory from `design/` prototypes | 🟢 | 9 screens, 6 modals, full field list captured in SPRINTS.md §2 |
| T0.2 | `REQUIREMENTS.md` | 🟢 | 8 sections, awaiting customer input |
| T0.3 | `SPRINTS.md` | 🟢 | Includes full Prisma schema, IPC contract, algorithms |
| T0.4 | `SPRINT-TRACKER.md` | 🟢 | This file |
| T0.5 | `CLAUDE.md` | 🟡 | In progress |
| T0.6 | Rewrite `README.md` | ⬜ | |
| T0.7 | Commit + push to `main` | ⬜ | |

**Definition of done:** all documents committed; every prototype field assigned to a sprint;
customer has the questionnaire.

---

## 3. Sprint 1 — Foundation, licensing, app shell

**Blocked on REQUIREMENTS §1, §2, §6.**

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T1.1 | Prisma/Electron packaging spike (timebox 1 day) | ⬜ | **Do first.** Fallback: Drizzle — record the decision below |
| T1.2 | Project scaffold, tooling, scripts | ⬜ | |
| T1.3 | Electron shell + security baseline | ⬜ | |
| T1.4 | Database layer, full schema, boot migrator | ⬜ | All tables created here |
| T1.5 | IPC contract + router + renderer hooks | ⬜ | Full channel list written now |
| T1.6 | Design system (Tailwind + shadcn + tokens) | ⬜ | |
| T1.7 | App shell, sidebar, nine routes | ⬜ | |
| T1.8 | Licensing: service, fingerprint, activation, conflict, gate | ⬜ | |
| T1.9 | Settings — license panel | ⬜ | |
| T1.10 | Logging, redaction, crash handlers, diagnostics | ⬜ | |
| T1.11 | Playwright harness + packaged smoke test | ⬜ | |

**E2E:** E1.1 – E1.16 — 0/16 passing.

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
| D8 | ⬜ pending | Prisma vs Drizzle | Decided by the T1.1 packaging spike — record the outcome here |
| D9 | ⬜ pending | Baileys 7.x RC vs 6.7.23 | Customer decision in REQUIREMENTS §7.6 — record the pinned version here |

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

---

## 10. Test results history

One row per sprint completion. Regression counts are cumulative — a later sprint must re-run
every earlier suite.

| Date | Sprint | New | Regression | Total | Typecheck | Lint | Packaged smoke | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — | — | *(no runs yet)* |

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
