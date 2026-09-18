---
description: Claim memory/inbox/{slug}.md into a registered Apps.md project memory file.
---
Claim inbox memory into a registered app.

1. List `memory/inbox/` (ignore README.md) and confirm the **inboxSlug**.
2. Resolve **targetWorkspaceSlug** from `Apps.md` (must already be registered — do not invent Apps rows).
3. Call `claim_inbox_memory` with `inboxSlug`, `targetWorkspaceSlug`, and optional `dryRun: true` first.
4. Report what was merged and archived under `memory/_archive/`.