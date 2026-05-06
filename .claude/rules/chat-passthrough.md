---
description: Chat pass-through constraint for Designer
---

Chat must pass through to the user's local Claude Code by default. Do not add interception, transformation, or middleware to the chat path unless it is required by Designer's core value prop.

Approval gates are the only mandated intercept point. When in doubt about whether a chat-path change qualifies as "core value prop," default to pass-through and surface the question.

See ADR 0008 (chat pass-through) for the architectural rationale.
