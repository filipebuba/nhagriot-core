# Security and Monetization Notes

This public repository contains reusable offline-first core code. It does not contain the production payment infrastructure or any private credentials.

## Secrets Policy

Never commit API keys, service-role keys, webhook secrets, private keys, or production `.env` files.

## Commercial Offline Downloads

The core includes local storage and audio cache primitives, but entitlement enforcement belongs in the product layer.

Recommended safeguards:

- gate intentional offline downloads behind paid plans;
- enforce plan checks server-side;
- maintain a per-user download ledger;
- limit downloads by plan;
- do not expose a "download all catalog" action;
- revalidate protected content after a grace period;
- let users delete offline content;
- avoid caching private API responses without authorization controls.

