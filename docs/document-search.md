# Document search

Documents has one prominent search across the currently accessible project library, including nested folders and files that are not featured. Text search matches names, descriptions and folder paths locally, with accent-insensitive matching. It does not make a model request. Results open the existing preview or take the user to the containing folder; featured selections remain independent.

**Search by meaning** is an explicit action for queries such as “permission to build” when a document is described as a “municipal construction licence.” It uses Gemini to rank permitted metadata by meaning, rather than substituting a keyword dictionary or claiming to have inspected unseen file contents. Only names, descriptions and folder paths are supplied. Existing saved descriptions, including locally extracted descriptions, are reused; search does not download files, perform OCR or create a new document index.

## API and authorization

`POST /api/documents/search` accepts `{ "query": "…", "language": "en" }` or Spanish `"es"`. Queries must contain 3–400 characters. Successful responses contain `results: [{ id, score }]`, `searchedCount`, `totalCount` and `mode: "semantic"`. Scores are ordering values, not calibrated confidence percentages. The UI uses current authorized document records for titles, descriptions, previews and navigation; model-generated names or URLs are never used.

The endpoint requires approved Documents access. Independently permitted viewers and authenticated read links can search; anonymous links use local text search. Project, complete folder ancestry and folder grants are checked before any metadata reaches the model. Deleted records, invalid folder trees, Expenses-only Factura/Compras roots and encryption-cleanup records are excluded. Encrypted documents and every descendant of an encrypted folder are excluded from semantic search even when unlocked. Local text search can use metadata already legitimately visible after an unlock.

Identity, project, permissions and current metadata are checked again after asynchronous work. Results for deleted, moved, newly protected or changed documents are discarded. Every response is `private, no-store`. Search queries, document metadata and model output are not written to analytics or the quota store. Opening a result still passes through the existing independently authorized file endpoint.

## Model and limits

The existing authenticated Gemini adapter is reused with `gemini-3.1-flash-lite`, minimal thinking, structured JSON, one candidate, at most 1,500 output tokens and a 30-second timeout. There are no tools, automatic retries, embedding API calls or persistent vectors. The provider documents [structured output and thinking support](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite) and the SDK's [JSON schema and cancellation options](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html).

Each request covers the complete permitted metadata set, up to 250 documents and 120,000 UTF-8 bytes. Larger sets return `semantic_scope_limit` rather than silently omitting later documents. Ordinary text search remains available. Provider failures, cancellation and invalid output preserve the local search and return a safe error without logging provider request payloads.

Durable Firestore reservations enforce 20 semantic requests per user per UTC day, 100 per project per UTC day, 1,000 per project per UTC month, and a 10-second user cooldown. Failed or cancelled attempts remain counted. The dedicated store contains hashed scope keys, counters and expiry timestamps, never query text or document metadata. Expiry timestamps do not themselves provision a Firestore TTL policy. These limits are separate from the existing optional QA AI budget and do not grant access to any document.

## Verification boundary

Focused tests cover the global search, description matches, preview and folder navigation, stale responses, safe errors, mobile layouts, permission and encryption exclusions, metadata changes during requests, output validation and concurrent quota reservations. Mocked semantic results establish application behavior, not live model relevance. Standard checks keep live AI disabled. Full browser regression, authenticated emulator passes, live model probes and cloud QA retain their separate approval requirements in [testing](development/testing.md) and [QA workflow](qa-workflow.md).

Implementation: [UI](../app/components/DocumentSearch.tsx), [route](../app/api/documents/search/route.ts), [service](../lib/document-search.ts), [policy](../lib/document-search-policy.ts) and [quota](../lib/document-search-quota.ts).
