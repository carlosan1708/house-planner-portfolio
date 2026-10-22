# Case: permission-aware assistant and budget proposals

**Status**: Reconstructed design, 2026-10-13. Implementation predates these artifacts.

## Problem and requirements

An assistant must help with budget/document questions without exposing another project's data,
using excluded sources, or turning an unreviewed model response into an official budget write.

| ID | Current requirement | Implementation | Test evidence |
|---|---|---|---|
| AI-01 | Use the authenticated project/user conversation | [chat route](../../../app/api/assistant/chat/route.ts), [service](../../../lib/assistant-service.ts) | [public-link denial](../../../tests/public-link-api-guards.test.ts) |
| AI-02 | Retrieve only permitted ordinary documents | [searchPermittedDocuments](../../../lib/document-index.ts) | [encrypted exclusions](../../../tests/encrypted-document-exclusions.test.ts) |
| AI-03 | Restrict proposal targets and amounts | [validateProposalChanges](../../../lib/assistant.ts) | [assistant safeguards](../../../tests/assistant.test.ts) |
| AI-04 | Confirm into an editing draft, never publish automatically | [confirmAssistantProposal](../../../lib/assistant-drafts.ts) | [draft workflow](../../../tests/budget-draft-workflow.test.tsx) |
| AI-05 | Respect project-note opt-out in subsequent context | [runAssistantTurn](../../../lib/assistant-service.ts) | [notes context tests](../../../tests/project-notes-route.test.ts) |

## Reconstructed decision: server tools plus review-only proposals

**Chosen approach**: Gemini requests declared tools; the server checks access and returns bounded
evidence. Proposed changes are validated and stored separately. Explicit confirmation creates a
private draft that follows the existing publication workflow.

**Alternative**: Give the model broad database actions or apply suggested changes immediately.
That would bypass contextual permissions and the user's review boundary.

**Trade-off**: The application must maintain tool contracts, proposal state and draft integration.
Bounded lexical retrieval is simpler to operate than a vector pipeline, but may miss relevant
content or scanned documents. Source citations aid review without proving answer correctness.

## Acceptance scenarios and limits

- An anonymous read link is denied before storing a conversation or invoking the model.
- Unsupported formula targets and negative amounts fail validation.
- An opted-out note and its prior note-based replies do not enter a new context.
- Confirmed proposals open the corresponding editing draft; confirmation does not publish.

Notes are shared project records rather than author-only content; authorized editors and
administrators can change their AI choice. The history filter revalidates note citations, but
old document/budget replies are not rechecked against later permission or vault changes. This
is a known limit distinct from correctly guarded fresh document tools.

Unit and mocked route/component tests exercise these boundaries. They do not evaluate complete
live-model turns, citation accuracy, retrieval recall or every prompt-injection scenario. No new
live model evaluation was performed during this portfolio preparation.

[Architecture detail](../../architecture/assistant.md)
