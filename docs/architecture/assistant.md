# Permission-aware AI assistant

The private assistant uses Gemini on Vertex AI through [the model adapter](../../lib/gemini.ts).
It is not enabled in the public demo. Live model access requires the operator's own authorized
cloud configuration; local regression tests do not establish model accuracy.

The adapter authenticates with Google Application Default Credentials (ADC). In Cloud Run,
ADC uses the service account attached to the running service, with short-lived credentials.
No Gemini API key or downloaded service-account JSON key is required. These credentials
remain server-side and are not included in browser code or model prompts.

## Request and context flow

1. [The chat route](../../app/api/assistant/chat/route.ts) checks the account and project context;
   anonymous read links cannot invoke it. Conversations belong to a project and user.
2. [runAssistantTurn](../../lib/assistant-service.ts) loads bounded conversation history and sends
   the model declared tools. Tools execute on the server and recheck applicable permissions.
3. Budget tools search official lines. The optional [project document index](../../lib/rag-search.ts)
   uses Firestore vector search, Gemini embeddings and OCR for scanned pages. Projects outside the
   index use [lexical retrieval](../../lib/document-index.ts). Both paths enforce project access.
4. Notes are shared within a project and protected by Notes permission. Authorized editors and
   administrators can opt individual notes into AI context; opt-out removes prior note-based
   replies from subsequent model context. Notes are not author-only records.
5. Responses can cite returned evidence. A proposed budget change is stored separately for review.
   Explicit confirmation creates a draft; publication follows normal project rules.

```mermaid
sequenceDiagram
  participant User
  participant Server
  participant Model as Gemini
  participant Draft as Private draft
  User->>Server: Ask within an authorized project
  Server->>Model: Bounded history and tool definitions
  Model->>Server: Request a tool
  Server->>Server: Check permissions and retrieve permitted evidence
  Server->>Model: Bounded tool result
  Model->>Server: Answer or propose changes
  Server->>User: Evidence and reviewable proposal
  User->>Server: Explicitly confirm proposal
  Server->>Draft: Create validated editing draft
```

## Safeguards and limits

[Proposal validation](../../lib/assistant.ts) accepts known rows and whitelisted editable fields,
checks amounts and text bounds, and rejects unsupported targets. [Draft confirmation](../../lib/assistant-drafts.ts)
checks context and base revisions. Confirmation is not official publication.

Encrypted documents remain excluded from search and other plaintext integrations even after an
administrator unlocks them. Folder moves, access changes and note opt-out change what fresh tools can retrieve.

The conversation-history filter rechecks recorded document and note dependencies before reuse.
New budget and expense replies record their section requirements. Older replies with fewer stored
dependencies have corresponding limits on what can be revalidated.

The service currently bounds tool rounds and output size. Grounding instructions and citations
help review; they do not guarantee correct reasoning, complete retrieval or resistance to every
instruction embedded in a source. SSE delivery chunks a completed application response and should
not be described as provider-token streaming.

## Persistent actions and plan images

Firestore stores messages, pending choices, workflow state and the last confirmed plan per user and
project. The [run coordinator](../../lib/assistant-run.ts) resumes interrupted actions and routes
financial writes through the existing review and expense operations.

The [model router](../../lib/model-router.ts) selects models for tasks such as receipt extraction,
document ranking, quote analysis, plan analysis and image generation. An image request begins with a
plan choice. The [image workflow](../../lib/assistant-image-run.ts) analyzes relevant sheets, reports
progress, and saves a private Cloud Storage image with its model and source references. The user
can reuse a suggested plan after confirming it. Source access is checked again before rendering
or delivering an image.

Live AI and plan image generation require separate opt-ins in an independently configured workspace.
The synthetic demo uses scripted examples. See [the public snapshot boundary](../portfolio/snapshot.md).

## Evidence

[Assistant unit tests](../../tests/assistant.test.ts) exercise matching, language and proposal validation.
[Public-link guards](../../tests/public-link-api-guards.test.ts) exercise API denial before model calls
or draft writes. [Notes tests](../../tests/project-notes-route.test.ts) cover context opt-out.
[Draft UI tests](../../tests/budget-draft-workflow.test.tsx) verify opening an assistant-created draft.
These checks use deterministic/mocked boundaries, not a measured live-model evaluation.

See the [reconstructed design case](../development/cases/assistant.md).
