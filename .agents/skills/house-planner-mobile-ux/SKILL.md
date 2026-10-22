---
name: house-planner-mobile-ux
description: "Inspect and improve House Planner mobile or navigation UX for galleries, forms, budgets,\
  \ documents and task controls. Use when touch behavior, responsive layout, discoverability\
  \ or workspace continuity is part of the requested change."
---

# House Planner mobile UX

Read root AGENTS.md and the installed Next.js guide relevant to any framework change in node_modules/next/dist/docs. Reuse current components and route helpers before adding a parallel navigation or form system.

Follow the user's task from entry point through the action, success, failure and return path. Keep the primary action visibly labeled; completion, notification acknowledgement and deletion are distinct actions. Preserve selected project, folder/line scope and edited values across tabs, reload and errors where the feature promises persistence. Existing query state must not accidentally reopen a creation action after it has been consumed.

Use lib/workspace-navigation.ts for canonical project/section/folder URLs. Encode names/IDs through the existing helpers, preserve full folder paths and honor section access. A link to a budget line or receipt selects context; it grants no permission. Empty budgetLineId is not automatically an outside-objective expense: inspect the accounting contract before changing filters or totals.

## Verify the affected interaction

- Check narrow portrait and landscape with long synthetic titles, nested folder names, loading/empty/error states and an on-screen keyboard where it changes the flow. Representative existing coverage uses 320px, 390px and 844x390 layouts; choose dimensions appropriate to the actual bug.
- Primary touch controls need a usable target, generally at least 44px. Keep labels readable and destructive controls distinct. Preserve keyboard access, visible focus, dialog naming, Escape/close behavior and focus recovery when a control disappears.
- Inspect document scroll width and the actual scroll container. Screenshots alone cannot prove touch scrolling or overlay behavior. When authorized manual testing is available, exercise native touch scrolling and the ordinary rendered controls in both orientations.
- For document/PDF viewers, inspect iframe/container bounds and clickable overlay regions, not just a zoomed screenshot. For galleries, keep the image dominant and secondary actions discreet without hiding discoverable labels or folder context.
- Test a nearby failure: keep the task/form active after a rejected save, preserve user edits, and show an accurate success/error result. Do not add tests that merely copy implementation details.

Use focused synthetic browser coverage for the changed flow. Offer a scoped manual pass when it materially helps, and distinguish it from automated screenshots. Before an optional complete regression, a CI run containing that full suite, or a push/PR/merge that triggers it, ask for the approval required by AGENTS.md. Record what was observed and any untested interaction; do not claim a deployed touch/device check from a mocked desktop fixture.

Current CI policy: static review, unit tests and build are mandatory; bounded applicable Playwright is automatic. Full browser/emulator regression is optional and requires a user request/approval. Standard CI is authorized with ordinary work; cloud QA keeps its separate session approval.
