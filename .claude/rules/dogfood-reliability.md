---
description: Enforce dogfood reliability standard (P2)
---

Do not ship partially-implemented features. If a feature is not fully functional, disable it behind a flag or remove it from the build entirely. Never leave half-baked UI or logic in a production path.

This is dogfood priority P2 — Designer must be reliable in the user's own daily use; partial states erode trust faster than missing features do.

This tightens CLAUDE.md §"Quality Bar" — the **Functional** criterion is satisfied by either "fully working" *or* "removed/flagged off"; never by "shipped but broken."
