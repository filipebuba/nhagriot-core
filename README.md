# Nha Griot Core

Open-source offline-first reading, listening, and study tools extracted from the Nhagriot audiobook PWA.

Nhagriot is designed for communities where connectivity can be slow, expensive, or unreliable. This public core focuses on local-first access: storing a personal library on-device, caching generated audio, resuming playback, producing study packs, and keeping sync work durable until the network returns.

## Why This Exists

The UNICEF Venture Fund prioritizes open-source frontier technology with potential to improve the lives of vulnerable children. This repository exposes the reusable core of Nhagriot while keeping private production concerns, secrets and protected catalog access out of the public release.

## What Is Included

- IndexedDB-backed library persistence.
- Durable sync queue primitives.
- Persistent audio cache.
- Original document blob cache.
- Storage estimation and persistent-storage helpers.
- Local audio playback engines.
- Chunking and text normalization helpers.
- Local study-pack generation.
- PDF/DOCX export helpers.
- PWA auto-update helper.
- User settings, player, goals, library, and study-pack stores.

## What Is Not Included

To protect users, production operations, and monetization, this repository intentionally excludes:

- `.env` files and real environment values;
- production backend clients and project identifiers;
- checkout, subscriptions, entitlements, and webhooks;
- admin tools;
- private catalog data;
- premium download enforcement logic;
- API keys, service-role keys, signing secrets, and provider credentials.

The production Nhagriot app can build paid features around this core. For example, a commercial app may expose offline downloads only to paying users, enforce limits server-side, and revoke protected offline content when a subscription expires.

## Offline-First Principles

- The app shell should remain available without a network.
- User-imported books and progress should be stored locally first.
- Sync should be queued and retried instead of blocking the user.
- Audio bytes should be cached intentionally and measured.
- Storage usage should be visible to the user.
- Sensitive or paid content must not be blindly cached in a way that bypasses authorization.

## Suggested Product Guardrails

- Only paid users can intentionally download protected books/audio for offline use.
- Do not offer "download all" for a whole premium catalog.
- Enforce per-plan offline limits on the server, not only in the UI.
- Keep a download ledger per user/book/chapter.
- Expire or disable protected downloads after subscription loss.
- Let users delete offline data at any time.
- Never place provider secrets or service-role keys in frontend code.

## Getting Started

```bash
npm install
npm run typecheck
```

This package is currently source-first. It is meant to be studied, reused, or imported into a PWA codebase.

## License

MIT. See `LICENSE`.

