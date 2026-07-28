# Release guide

How to produce, sign and publish a RapBooster Advance build for **Windows**.

> **Windows is the only distribution target.** macOS packaging, Apple signing and
> notarization were removed on 2026-07-28 at the customer's instruction. Nothing
> in the app is Windows-specific — reinstating a Mac build means adding a `mac:`
> block to `electron-builder.yml` and an Apple Developer identity, not rewriting
> code.
>
> ⚠ **The release pipeline is wired but unverified.** Every step below is real
> configuration against real tooling, but no signed build has been produced and
> no update has been installed, because that requires credentials from
> [REQUIREMENTS.md](./REQUIREMENTS.md) §2–§4. Treat this document as a plan that
> should work, not as a procedure someone has walked through.

---

## What is missing, and what happens without it

| Needed                           | REQUIREMENTS | Consequence if absent                                                                                         |
| -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| App icon, publisher name         | §2           | A placeholder icon ships (`assets/branding/icon.png`), and the installer shows no verified publisher          |
| Update feed URL                  | §3           | `system:checkUpdate` reports "no update server is configured" rather than falsely claiming the app is current |
| Windows code-signing certificate | §4           | Unsigned `.exe`; Windows SmartScreen warns users the app is unrecognised                                      |

None of these block development. All of them block shipping to real users.

---

## Building

```bash
npm ci
npm run build        # typecheck, renderer export, main/preload/wa-service bundles
npm run dist         # NSIS installer for the current platform (Windows)
npm run dist:win     # the same, with the target named explicitly
```

`npm run pack` produces an unpacked build without an installer — this is what
`npm run test:smoke` drives.

---

## Signing

Signing activates from environment variables; there is nothing to switch on in
the config.

```bash
# .pfx certificate
set CSC_LINK=file:///C:/path/to/certificate.pfx
set CSC_KEY_PASSWORD=<password>
npm run dist:win
```

For an EV certificate on a hardware token, or Azure Trusted Signing, the
configuration differs — supply the details in REQUIREMENTS §4 and this section
gets rewritten against what you actually have.

---

## Publishing an update

1. Bump `version` in `package.json`.
2. Build and sign the Windows installer.
3. Upload the installer **and** the generated `latest.yml` to the feed
   configured in REQUIREMENTS §3. The metadata file is what `electron-updater`
   reads; the installer alone is not enough.
4. Verify by installing the previous version and letting it check.

Set the feed at runtime with `UPDATE_FEED_URL`, or bake it into
`electron-builder.yml` under `publish.url` once §3 is answered.

### Update behaviour, and why

- Updates **download only when the user asks**, and install on quit.
- Nothing is installed under a running campaign without an explicit choice.

This app runs long sends. Restarting under someone mid-campaign would be worse
than being a version behind.

---

## Release checklist

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm run test:e2e` fully green
- [ ] `npm run test:smoke` green against the packaged build
- [ ] Version bumped, `SPRINT-TRACKER.md` release table updated
- [ ] Windows installer signed, installs without a SmartScreen warning
- [ ] Update feed serves the new version, and a previous build upgrades to it
- [ ] A fresh install activates a license, links a device, and sends one test
      message to a number you control
